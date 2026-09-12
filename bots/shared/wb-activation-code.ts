import crypto from "node:crypto";

/** No I/O/0/1 — the code is read off a screen and typed by hand. */
const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGITS = "23456789";
const ALPHABET = `${LETTERS}${DIGITS}`;

export const WB_ACTIVATION_CODE_LENGTH = 7;

/** Both bots gate WB codes behind `/^[A-Za-z0-9]{7}$/ && /[A-Za-z]/`, so an
 * all-digit code would be silently ignored in chat even though the site accepts
 * it. Uniform sampling hits that once in 16 384 codes, so the letter is placed
 * explicitly rather than left to chance. */
export function generateWbActivationCode(): string {
  const chars = Array.from(
    { length: WB_ACTIVATION_CODE_LENGTH },
    () => ALPHABET[crypto.randomInt(ALPHABET.length)],
  );
  const letterAt = crypto.randomInt(WB_ACTIVATION_CODE_LENGTH);
  chars[letterAt] = LETTERS[crypto.randomInt(LETTERS.length)];
  return chars.join("");
}

/** Mirrors what the site route and both bots will accept. */
export function isDeliverableWbActivationCode(code: string): boolean {
  return new RegExp(`^[A-Za-z0-9]{${WB_ACTIVATION_CODE_LENGTH}}$`).test(code) && /[A-Za-z]/.test(code);
}
