/* ─────────────────────────────────────────────────────────────────────────────
   vk-reach.ts — «может ли сообщество написать этому VK-юзеру?» (PLAN +5.I.1).

   VK-логин на сайте создаёт юзера БЕЗ диалога с сообществом → бот и менеджер
   от имени сообщества писать не могут (VK error 901). Менеджер должен видеть
   это прямо в карточке заказа и писать с личного аккаунта.

   messages.isMessagesFromGroupAllowed — 1 юзер за вызов, групповой токен
   ~3 rps → кэш на 1 час + лимит свежих проверок за один запрос. Недостающие
   ответы доедут со следующими enrich-батчами (кэш прогревается).
   ───────────────────────────────────────────────────────────────────────── */

const TTL_MS = 60 * 60 * 1000;
const MAX_FRESH_PER_CALL = 12;
const CONCURRENCY = 3;

const cache = new Map<string, { allowed: boolean; ts: number }>();

async function checkOne(vkId: string): Promise<boolean | null> {
  const token = process.env.VK_TOKEN;
  const groupId = process.env.VK_GROUP_ID;
  if (!token || !groupId) return null;
  try {
    const qs = new URLSearchParams({
      group_id: groupId,
      user_id: vkId,
      access_token: token,
      v: "5.131",
    });
    const r = await fetch(`https://api.vk.com/method/messages.isMessagesFromGroupAllowed?${qs}`);
    const j: any = await r.json().catch(() => null);
    if (j?.error) return null; // rate-limit/приватность — не кэшируем, попробуем позже
    return !!j?.response?.is_allowed;
  } catch {
    return null;
  }
}

/**
 * Батч-проверка. Возвращает vkId → allowed только для известных ответов
 * (кэш или свежая проверка); неизвестные просто отсутствуют в результате.
 */
export async function checkVkReachable(vkIds: string[]): Promise<Map<string, boolean>> {
  const result = new Map<string, boolean>();
  const now = Date.now();
  const fresh: string[] = [];

  for (const id of [...new Set(vkIds)]) {
    const hit = cache.get(id);
    if (hit && now - hit.ts < TTL_MS) result.set(id, hit.allowed);
    else if (fresh.length < MAX_FRESH_PER_CALL) fresh.push(id);
  }

  for (let i = 0; i < fresh.length; i += CONCURRENCY) {
    const chunk = fresh.slice(i, i + CONCURRENCY);
    const answers = await Promise.all(chunk.map(checkOne));
    chunk.forEach((id, idx) => {
      const allowed = answers[idx];
      if (allowed === null) return;
      cache.set(id, { allowed, ts: Date.now() });
      result.set(id, allowed);
    });
    if (i + CONCURRENCY < fresh.length) await new Promise(r => setTimeout(r, 350));
  }

  return result;
}
