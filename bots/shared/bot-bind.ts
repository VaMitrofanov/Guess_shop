import crypto from "crypto";

/* ─────────────────────────────────────────────────────────────────────────────
   🔗 Связка в один тап (Э1, 18.11.2026): профиль сайта или ВК → Telegram.

   Владелец: «основной интерес — тг… переманивать аккуратно из ВК в тг».
   Раньше привязать Telegram можно было только с сайта и в три шага: открыть
   бота, нажать «Старт», вернуться по кнопке в браузер (`web_link_…`, ссылка на
   5 минут). Теперь одна ссылка `t.me/RobloxBankBot?start=ln_<токен>`: бот сам
   склеивает Telegram с профилем, для которого выпущен токен, и сразу
   показывает заказы.

   Почему это доказательство (`linkOrMergeVerifiedIdentity`, метод
   `bot-bind-token`): токен выпускается ТОЛЬКО владельцу профиля — на сайте
   под его сессией, во ВК в его же диалоге с сообществом. Telegram-аккаунт
   доказывает сам Telegram: `/start` пришёл от него. Токен одноразовый и
   живёт 7 дней, хранится только sha256.

   Хранилище — та же `TelegramWebLoginChallenge`, что у входа через бота, с
   режимом `bind`: новая таблица ради третьего режима не нужна.
   ───────────────────────────────────────────────────────────────────────── */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export const BIND_MODE = "bind";
export const BIND_START_PREFIX = "ln_";
export const BIND_TTL_MS = 7 * 24 * 3600_000;
const TG_BOT_URL = "https://t.me/RobloxBankBot";

const hashState = (state: string) => crypto.createHash("sha256").update(state).digest("hex");

/** `ln_<32 знака>` из `/start` → токен; всё прочее — null. */
export function parseBindStart(payload: string | null | undefined): string | null {
  const m = /^ln_([A-Za-z0-9_-]{32})$/.exec(String(payload ?? "").trim());
  return m ? m[1] : null;
}

export const tgBindHref = (state: string) => `${TG_BOT_URL}?start=${BIND_START_PREFIX}${state}`;

/** Выпустить токен для профиля. Старые неиспользованные токены этого профиля гасим: живёт один. */
export async function issueBindToken(db: Db, userId: string, now = new Date()): Promise<{ state: string; url: string; expiresAt: Date }> {
  const state = crypto.randomBytes(24).toString("base64url");
  const expiresAt = new Date(now.getTime() + BIND_TTL_MS);
  await db.telegramWebLoginChallenge.updateMany({
    where: { targetUserId: userId, mode: BIND_MODE, consumedAt: null },
    data: { consumedAt: now },
  }).catch(() => undefined);
  await db.telegramWebLoginChallenge.create({
    data: { stateHash: hashState(state), mode: BIND_MODE, targetUserId: userId, expiresAt },
  });
  return { state, url: tgBindHref(state), expiresAt };
}

/** Погасить токен. Возвращает профиль, к которому привязывать, или null (нет / истёк / уже использован). */
export async function consumeBindToken(db: Db, state: string, now = new Date()): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{32}$/.test(state)) return null;
  const stateHash = hashState(state);
  const row = await db.telegramWebLoginChallenge.findUnique({ where: { stateHash } });
  if (!row || row.mode !== BIND_MODE || row.consumedAt || row.expiresAt <= now || !row.targetUserId) return null;
  const taken = await db.telegramWebLoginChallenge.updateMany({
    where: { stateHash, consumedAt: null },
    data: { consumedAt: now },
  });
  return taken.count === 1 ? row.targetUserId : null;
}

/** Что ответить в боте, если склейка не прошла (`linkOrMergeVerifiedIdentity` бросает текстом). */
export function bindFailureText(message: string): string {
  if (/already linked to another subject/i.test(message)) {
    return "К этому профилю уже привязан другой Telegram. Если это тоже вы — напишите нам @RobloxBank_PA, объединим вручную.";
  }
  if (/Both profiles already have/i.test(message)) {
    return "Этот Telegram уже связан с другим профилем. Напишите нам @RobloxBank_PA — проверим и объединим вручную.";
  }
  return "Не получилось привязать автоматически — напишите нам @RobloxBank_PA, сделаем вручную.";
}

export const BIND_STALE_TEXT =
  "Эта ссылка уже использована или устарела. Откройте кабинет на сайте и нажмите «Получать статус в Telegram» ещё раз.";

/* ── Приглашение из ВК в Telegram (Э6) ─────────────────────────────────────
   Аккуратно: не чаще раза в 14 дней одному человеку, только тому, у кого
   Telegram ещё не привязан, и с понятной выгодой. Отметка — `User.tgInviteAt`.
   ───────────────────────────────────────────────────────────────────────── */

export const TG_INVITE_QUIET_MS = 14 * 24 * 3600_000;

export function tgInviteDue(user: { tgId?: string | null; vkId?: string | null; tgInviteAt?: Date | string | null } | null, now = Date.now()): boolean {
  if (!user || user.tgId || !user.vkId) return false;
  if (!user.tgInviteAt) return true;
  return now - new Date(user.tgInviteAt).getTime() >= TG_INVITE_QUIET_MS;
}

export const TG_INVITE_TEXT =
  "Кстати, в Telegram с нами удобнее: статус заказа приходит сразу, поддержка отвечает быстрее, а все заказы — в одном месте.\n\n" +
  "Подключить можно в одно нажатие — ВКонтакте тоже останется.";
export const TG_INVITE_LABEL = "Подключить Telegram";

/** Выпустить токен и отметить приглашение. null — звать рано или некого. */
export async function prepareTgInvite(db: Db, userId: string, now = new Date()): Promise<string | null> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { tgId: true, vkId: true, tgInviteAt: true } }).catch(() => null);
  if (!tgInviteDue(user, now.getTime())) return null;
  // Отметку ставим ДО отправки и атомарно: два параллельных события не позовут дважды.
  const since = new Date(now.getTime() - TG_INVITE_QUIET_MS);
  const marked = await db.user.updateMany({
    where: { id: userId, tgId: null, OR: [{ tgInviteAt: null }, { tgInviteAt: { lt: since } }] },
    data: { tgInviteAt: now },
  }).catch(() => ({ count: 0 }));
  if (marked.count !== 1) return null;
  const { url } = await issueBindToken(db, userId, now);
  return url;
}
