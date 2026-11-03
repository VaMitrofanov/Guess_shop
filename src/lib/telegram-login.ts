import crypto from "crypto";

export type TelegramLoginPayload = {
  id: string | number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: string | number;
  hash: string;
};

export type VerifiedTelegramLogin = {
  subject: string;
  name: string;
  username?: string;
  image?: string;
  authenticatedAt: Date;
};

export function verifyTelegramLogin(
  payload: TelegramLoginPayload,
  options: { maxAgeSeconds?: number; now?: Date; botToken?: string } = {},
): VerifiedTelegramLogin | null {
  const token = options.botToken ?? process.env.TG_TOKEN;
  if (!token || !payload?.hash) return null;
  const authSeconds = Number(payload.auth_date);
  const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1000);
  const maxAge = options.maxAgeSeconds ?? 300;
  if (!Number.isSafeInteger(authSeconds) || authSeconds > nowSeconds + 30 || nowSeconds - authSeconds > maxAge) return null;

  const entries = Object.entries(payload)
    .filter(([key, value]) => key !== "hash" && value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}=${String(value)}`)
    .sort();
  const secret = crypto.createHash("sha256").update(token).digest();
  const expected = crypto.createHmac("sha256", secret).update(entries.join("\n")).digest("hex");
  try {
    const actualBuffer = Buffer.from(payload.hash, "hex");
    const expectedBuffer = Buffer.from(expected, "hex");
    if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) return null;
  } catch { return null; }

  const subject = String(payload.id);
  if (!/^\d+$/.test(subject) || !payload.first_name?.trim()) return null;
  return {
    subject,
    name: [payload.first_name, payload.last_name].filter(Boolean).join(" ").trim(),
    username: payload.username?.trim() || undefined,
    image: payload.photo_url?.startsWith("https://") ? payload.photo_url : undefined,
    authenticatedAt: new Date(authSeconds * 1000),
  };
}
