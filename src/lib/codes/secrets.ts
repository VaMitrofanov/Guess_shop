import crypto from "node:crypto";

/**
 * Секреты контура кодов активации.
 *
 * Код активации — предъявительский инструмент: кто прочитал, тот и потратил.
 * Поэтому значение кода живёт в базе только в конверте AES-256-GCM с отдельным
 * ключом `ACTIVATION_CODE_ENCRYPTION_KEY` (не ключ доставки WB: компрометация
 * одного не открывает другое), дубли ловит HMAC, а ни одна функция этого модуля
 * не пишет значение в лог.
 */

const ENVELOPE_VERSION = "v1";
const PURPOSE = "activation-code";

function decodeKey(raw = process.env.ACTIVATION_CODE_ENCRYPTION_KEY ?? ""): Buffer {
  const value = raw.trim().replace(/^['"`]|['"`]$/g, "");
  if (/^[a-f0-9]{64}$/i.test(value)) return Buffer.from(value, "hex");
  if (value) {
    const decoded = Buffer.from(value, "base64");
    if (decoded.length === 32) return decoded;
  }
  throw new Error("ACTIVATION_CODE_ENCRYPTION_KEY must be 32 bytes (base64) or 64 hex chars");
}

export function activationCryptoReady(): boolean {
  try {
    return decodeKey().length === 32;
  } catch {
    return false;
  }
}

/** Нормализация перед HMAC: регистр и пробелы/дефисы не делают код другим. */
export function normalizeActivationCode(value: string): string {
  return value.trim().toUpperCase().replace(/[\s-]+/g, "");
}

export function encryptActivationCode(value: string): string {
  const key = decodeKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`${ENVELOPE_VERSION}:${PURPOSE}`, "utf8"));
  const encrypted = Buffer.concat([cipher.update(value.trim(), "utf8"), cipher.final()]);
  return [ENVELOPE_VERSION, PURPOSE, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(":");
}

export function decryptActivationCode(envelope: string): string {
  const [version, purpose, ivRaw, tagRaw, dataRaw, ...tail] = envelope.split(":");
  if (tail.length || version !== ENVELOPE_VERSION || purpose !== PURPOSE || !ivRaw || !tagRaw || !dataRaw) {
    throw new Error("Invalid activation code envelope");
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", decodeKey(), Buffer.from(ivRaw, "base64url"));
  decipher.setAAD(Buffer.from(`${version}:${purpose}`, "utf8"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(dataRaw, "base64url")), decipher.final()]).toString("utf8");
}

export function activationCodeHmac(value: string): string {
  return crypto
    .createHmac("sha256", decodeKey())
    .update(`${ENVELOPE_VERSION}:${PURPOSE}:${normalizeActivationCode(value)}`, "utf8")
    .digest("hex");
}

// ─── Токен платёжной ссылки ──────────────────────────────────────────────────

/** 32 случайных байта (256 бит) — неперебираемо. В базе лежит только sha256. */
export function newPayToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashPayToken(token: string): string {
  return crypto.createHash("sha256").update(`code-pay:${token}`, "utf8").digest("hex");
}

/** Форма токена до похода в базу: мусор отбрасываем, не нагружая БД. */
export function isPayTokenShape(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);
}

/** Номер заказа для людей: `CODE-7K2M9QXP` (без 0/O/1/I). */
export function newCodeOrderPublicId(): string {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const bytes = crypto.randomBytes(8);
  let id = "";
  for (const byte of bytes) id += alphabet[byte % alphabet.length];
  return `CODE-${id}`;
}

/** `ma***@gmail.com` — родителю видно, куда уйдёт код, но не весь адрес. */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const [local, domain] = email.split("@");
  if (!local || !domain) return null;
  const head = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
  return `${head}***@${domain}`;
}
