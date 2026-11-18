import crypto from "crypto";

export type TelegramWebLoginMode = "login" | "link";

type TelegramWebLoginUser = {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
};

export function parseTelegramWebLoginStart(payload: string) {
  const match = /^web_(login|link)_([A-Za-z0-9_-]{32})$/.exec(payload);
  if (!match) return null;
  return { mode: match[1] as TelegramWebLoginMode, state: match[2] };
}

export function buildTelegramWebLoginUrl(
  user: TelegramWebLoginUser,
  mode: TelegramWebLoginMode,
  state: string,
  options: { botToken: string; baseUrl?: string; now?: Date },
) {
  const payload: Record<string, string> = {
    id: String(user.id),
    first_name: user.first_name,
    ...(user.last_name ? { last_name: user.last_name } : {}),
    ...(user.username ? { username: user.username } : {}),
    auth_date: String(Math.floor((options.now ?? new Date()).getTime() / 1000)),
  };
  const check = Object.entries(payload).map(([key, value]) => `${key}=${value}`).sort().join("\n");
  const secret = crypto.createHash("sha256").update(options.botToken).digest();
  const hash = crypto.createHmac("sha256", secret).update(check).digest("hex");
  const query = new URLSearchParams({ mode, state, ...payload, hash });
  const baseUrl = (options.baseUrl ?? "https://robloxbank.ru").replace(/\/$/, "");
  return `${baseUrl}/auth/telegram/callback?${query.toString()}`;
}

/* ── Вход «вернитесь в браузер» (18.11.2026) ────────────────────────────────
   Баг «выбивает после регистрации»: кнопка-ссылка бота открывалась во
   встроенном браузере Telegram, сессия рождалась ТАМ, а вкладка Safari/Chrome,
   где человек начинал, оставалась без входа. Теперь бот спрашивает «Это вы?»,
   по «✅ Да, войти» помечает вызов одобренным (`mode = login-approved`,
   `targetUserId = tg:<id>`), а исходная вкладка, которая ждёт, сама входит
   (`/api/auth/telegram/poll` + провайдер `telegram-handoff`). Одноразово,
   5 минут, только тот Telegram, что нажал кнопку. ──────────────────────── */

export const LOGIN_APPROVED_MODE = "login-approved";
export const WEB_LOGIN_APPROVE_CB = "wla";

export const webLoginStateHash = (state: string) => crypto.createHash("sha256").update(state).digest("hex");

/** `wla:<state>` → state; иначе null. 4 + 32 знака — влезает в 64 байта callback_data. */
export function parseWebLoginApprove(data: string | null | undefined): string | null {
  const m = /^wla:([A-Za-z0-9_-]{32})$/.exec(String(data ?? ""));
  return m ? m[1] : null;
}

export const WEB_LOGIN_ASK_TEXT =
  "🔐 <b>Это вы входите на сайт RobloxBank?</b>\n\n" +
  "Нажмите «Да, войти» и вернитесь в браузер — вход выполнится сам.\n\n" +
  "<i>Если ссылку на этот вход вам прислал кто-то другой — не нажимайте: так он получит доступ к вашему кабинету.</i>";
export const WEB_LOGIN_DONE_TEXT = "✅ <b>Готово!</b> Вернитесь в браузер — вы уже вошли в кабинет RobloxBank.";
export const WEB_LOGIN_STALE_TEXT = "Этот вход уже использован или устарел. Нажмите «Telegram» на сайте ещё раз.";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ChallengeDb = any;

/** Бот: одобрить вход этим Telegram. false — вызова нет, он истёк или уже использован. */
export async function approveWebLogin(db: ChallengeDb, state: string, tgId: string, now = new Date()): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{32}$/.test(state) || !/^\d{3,20}$/.test(tgId)) return false;
  const res = await db.telegramWebLoginChallenge.updateMany({
    where: { stateHash: webLoginStateHash(state), mode: "login", consumedAt: null, expiresAt: { gt: now } },
    data: { mode: LOGIN_APPROVED_MODE, targetUserId: `tg:${tgId}` },
  });
  return res.count === 1;
}

/** `tg:<id>` из одобренного вызова. */
export function approvedTelegramId(targetUserId: string | null | undefined): string | null {
  const m = /^tg:(\d{3,20})$/.exec(String(targetUserId ?? ""));
  return m ? m[1] : null;
}
