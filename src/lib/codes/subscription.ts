import { prisma } from "@/lib/prisma";

/**
 * Подписка на наш канал — условие скидки 1 % на коды (владелец, 15.11.2026:
 * «скидка 1 % — регистрация + подписка на группу; максимально форсить
 * трафик в группу»).
 *
 * Проверяем по-настоящему, где это возможно:
 * - аккаунт с Telegram (вход через TG или покупатель бота) — `getChatMember`
 *   канала через мост TG-хоста (RF Web до Telegram не достаёт);
 * - аккаунт с ВК — `groups.isMember` группы токеном сообщества.
 * Подписка на любой из двух засчитывается. Аккаунт только с почтой проверить
 * нечем — ему предлагаем привязать Telegram.
 *
 * Результат кэшируется на пользователе: «подписан» — на 12 часов, «нет» — на
 * 5 минут (человек только что подписался и вернулся). Кнопка «Я подписался»
 * проверяет сразу (`force`). Сбой проверки (сеть, мост) не отнимает скидку,
 * которая уже была засчитана.
 */

export const TG_CHANNEL = process.env.TG_CHANNEL_ID?.trim() || "@Roblox_Bank_Tg";
export const TG_CHANNEL_URL = "https://t.me/Roblox_Bank_Tg";
export const VK_GROUP_URL = "https://vk.ru/bankroblox";
const VK_GROUP_ID = process.env.VK_GROUP_ID?.trim() || "237309399";

const FRESH_YES_MS = 12 * 60 * 60 * 1000;
const FRESH_NO_MS = 5 * 60 * 1000;

export type SubscriptionCheck = {
  subscribed: boolean;
  /** Чем можем проверить: tg / vk / оба / нечем (только почта). */
  via: "tg" | "vk" | "both" | "none";
};

async function tgIsMember(tgId: string): Promise<boolean | null> {
  const bridge = process.env.VALIDATOR_SOURCE_URL?.trim();
  const token = process.env.TG_TOKEN;
  if (!token) return null;
  try {
    const response = bridge
      ? await fetch(`${bridge}/tg-proxy`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(process.env.VALIDATOR_KEY ? { "x-validator-key": process.env.VALIDATOR_KEY } : {}) },
          body: JSON.stringify({ token, method: "getChatMember", chat_id: TG_CHANNEL, user_id: Number(tgId) }),
          signal: AbortSignal.timeout(8000),
        })
      : await fetch(`https://api.telegram.org/bot${token}/getChatMember?chat_id=${encodeURIComponent(TG_CHANNEL)}&user_id=${encodeURIComponent(tgId)}`, { signal: AbortSignal.timeout(8000) });
    const body = await response.json().catch(() => null) as { ok?: boolean; result?: { status?: string | null }; description?: string } | null;
    if (body?.ok && body.result?.status) return ["member", "administrator", "creator", "restricted"].includes(body.result.status);
    // «user not found» / «PARTICIPANT_ID_INVALID» — человек не в канале.
    if (body && /not found|participant/i.test(String(body.description ?? JSON.stringify(body)))) return false;
    return null;
  } catch {
    return null;
  }
}

async function vkIsMember(vkId: string): Promise<boolean | null> {
  const token = process.env.VK_TOKEN;
  if (!token) return null;
  try {
    const params = new URLSearchParams({ group_id: VK_GROUP_ID, user_id: vkId, access_token: token, v: "5.131" });
    const response = await fetch("https://api.vk.com/method/groups.isMember", { method: "POST", body: params, signal: AbortSignal.timeout(8000) });
    const body = await response.json().catch(() => null) as { response?: number; error?: unknown } | null;
    if (body && typeof body.response === "number") return body.response === 1;
    return null;
  } catch {
    return null;
  }
}

export async function channelSubscription(userId: string, opts: { force?: boolean } = {}): Promise<SubscriptionCheck> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { tgId: true, vkId: true, channelSubscribed: true, channelCheckedAt: true },
  });
  if (!user) return { subscribed: false, via: "none" };
  const via: SubscriptionCheck["via"] = user.tgId && user.vkId ? "both" : user.tgId ? "tg" : user.vkId ? "vk" : "none";
  if (via === "none") return { subscribed: false, via };

  const age = user.channelCheckedAt ? Date.now() - user.channelCheckedAt.getTime() : Infinity;
  if (!opts.force && age < (user.channelSubscribed ? FRESH_YES_MS : FRESH_NO_MS)) {
    return { subscribed: user.channelSubscribed, via };
  }

  const [tg, vk] = await Promise.all([
    user.tgId ? tgIsMember(user.tgId) : Promise.resolve(null),
    user.vkId ? vkIsMember(user.vkId) : Promise.resolve(null),
  ]);
  if (tg === null && vk === null) {
    // Проверить не удалось — оставляем прошлый ответ, не наказываем за сбой.
    return { subscribed: user.channelSubscribed, via };
  }
  const subscribed = tg === true || vk === true;
  await prisma.user.update({ where: { id: userId }, data: { channelSubscribed: subscribed, channelCheckedAt: new Date() } }).catch(() => undefined);
  return { subscribed, via };
}
