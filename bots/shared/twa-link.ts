/**
 * Подписанный токен запуска TWA (ultra-review U1).
 *
 * Зеркало серверной проверки в `src/lib/twa-auth.ts` (`bots/` и `src/` не
 * импортируют друг друга — см. bots/shared/completed-messages.ts). Формат и
 * секрет обязаны совпадать.
 *
 * Зачем: раньше web_app-ссылка несла `?uid=<telegramId>`, и роут `/api/twa/auth`
 * выдавал по нему полноценный admin-JWT. Telegram ID не секретен. Теперь бот
 * подписывает `v1.<userId>.<exp>` секретом `TWA_LINK_SECRET`, который живёт
 * только в env бота и Web и никогда не попадает в клиентский бандл.
 */

import crypto from "crypto";

const LINK_TOKEN_VERSION = "v1";

/** Ссылка живёт 30 дней: Menu Button ставится один раз на старте бота. */
export const TWA_LINK_TTL_SEC = 30 * 24 * 60 * 60;

function linkSecret(): Buffer | null {
  const raw = process.env.TWA_LINK_SECRET?.trim();
  if (!raw) return null;
  return Buffer.from(raw, "utf8");
}

export function twaLinkAuthEnabled(): boolean {
  return linkSecret() !== null;
}

export function signTwaLinkToken(
  userId: number | string,
  ttlSec: number = TWA_LINK_TTL_SEC,
  now: number = Date.now(),
): string | null {
  const secret = linkSecret();
  if (!secret) return null;
  const exp = Math.floor(now / 1000) + ttlSec;
  const payload = `${LINK_TOKEN_VERSION}.${userId}.${exp}`;
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

/**
 * URL мини-приложения для конкретного админа. Без секрета в env возвращает
 * голый `/twa` — вход останется только через initData, но «тихого» отката к
 * публичному идентификатору не будет ни при каких условиях.
 */
export function twaLaunchUrl(uid?: string | number, extraQuery?: Record<string, string>): string {
  const base = `${process.env.NEXT_PUBLIC_APP_URL ?? "https://robloxbank.ru"}/twa`;
  const params = new URLSearchParams(extraQuery ?? {});
  const token = uid != null ? signTwaLinkToken(uid) : null;
  if (token) params.set("k", token);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}
