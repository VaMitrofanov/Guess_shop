import crypto from "crypto";

export type TelegramWebLoginMode = "login" | "link";

export type TelegramWebLoginUser = {
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
