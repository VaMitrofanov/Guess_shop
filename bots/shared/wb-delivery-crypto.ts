import crypto from "node:crypto";

const ENVELOPE_VERSION = "v1";
const DELIVERY_CODE_RE = /(?<!\d)(\d(?:[\s-]?\d){4,5})(?!\d)/g;
const ACTIVATION_CODE_RE = /(код(?:\s+активации)?\s*[:—-]?\s*)([A-Z0-9]{7})(?![A-Z0-9])/gi;

function decodeKey(raw = process.env.WB_DELIVERY_ENCRYPTION_KEY ?? ""): Buffer {
  const value = raw.trim().replace(/^['"`]|['"`]$/g, "");
  if (/^[a-f0-9]{64}$/i.test(value)) return Buffer.from(value, "hex");
  if (value) {
    try {
      const decoded = Buffer.from(value, "base64");
      if (decoded.length === 32) return decoded;
    } catch {
      // Fall through to the explicit configuration error below.
    }
  }
  throw new Error("WB_DELIVERY_ENCRYPTION_KEY must be 32 bytes (base64) or 64 hex chars");
}

export function wbDeliveryCryptoReady(): boolean {
  try {
    return decodeKey().length === 32;
  } catch {
    return false;
  }
}

export function encryptWbSecret(value: string, purpose: "delivery-code" | "reply-sign"): string {
  const key = decodeKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`${ENVELOPE_VERSION}:${purpose}`, "utf8"));
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    ENVELOPE_VERSION,
    purpose,
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(":");
}

export function decryptWbSecret(envelope: string, purpose: "delivery-code" | "reply-sign"): string {
  const [version, actualPurpose, ivRaw, tagRaw, ciphertextRaw, ...tail] = envelope.split(":");
  if (tail.length || version !== ENVELOPE_VERSION || actualPurpose !== purpose || !ivRaw || !tagRaw || !ciphertextRaw) {
    throw new Error("Invalid WB secret envelope");
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", decodeKey(), Buffer.from(ivRaw, "base64url"));
  decipher.setAAD(Buffer.from(`${version}:${purpose}`, "utf8"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextRaw, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function wbSecretHmac(value: string, purpose: "delivery-code" | "reply-sign"): string {
  return crypto
    .createHmac("sha256", decodeKey())
    .update(`${ENVELOPE_VERSION}:${purpose}:${value}`, "utf8")
    .digest("hex");
}

/** WB prints a five- or six-digit delivery code next to the buyer's QR. Six
 * digits are specific enough to read out of any sentence; five digits collide
 * with order numbers and prices, so they only count when the buyer sent nothing
 * but the code. */
export function extractDeliveryCode(text: string): string | null {
  DELIVERY_CODE_RE.lastIndex = 0;
  const candidates = [...text.matchAll(DELIVERY_CODE_RE)].map((match) => match[1].replace(/\D/g, ""));
  const sixDigit = candidates.find((code) => code.length === 6);
  if (sixDigit) return sixDigit;
  const fiveDigit = candidates.find((code) => code.length === 5);
  if (fiveDigit && text.replace(/[\s\-.,!?:;()]/g, "") === fiveDigit) return fiveDigit;
  return null;
}

/** Redact before DB persistence. Our seven-character activation code must not
 * survive in chat history — delivery codes are stored encrypted separately. */
export function redactWbChatText(text: string): string {
  return text
    .replace(ACTIVATION_CODE_RE, (_whole, prefix: string) => `${prefix}•••••••`)
    .slice(0, 2_000);
}

export function maskWbCode(code: string | null | undefined): string | null {
  if (!code) return null;
  return `•••••${code.slice(-2)}`;
}
