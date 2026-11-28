/**
 * Accept either the raw .ROBLOSECURITY value or a copied Cookie header.
 * The returned value never contains the cookie name or unrelated cookies.
 */
export function normalizeRobloxSecurityCookie(input: unknown): string {
  const raw = String(input ?? "").trim();
  const fromHeader = raw.match(/(?:^|;\s*|cookie:\s*)\.ROBLOSECURITY=([^;]+)/i)?.[1];
  const value = (fromHeader ?? raw).trim();
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).trim();
  }
  return value;
}
