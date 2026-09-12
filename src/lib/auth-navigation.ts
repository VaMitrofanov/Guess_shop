export function normalizeLoginEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function safeReturnPath(value: string | null | undefined, fallback = "/dashboard") {
  if (
    !value ||
    value.length > 2_048 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) return fallback;

  try {
    const base = "https://return.robloxbank.local";
    const parsed = new URL(value, base);
    if (parsed.origin !== base || parsed.pathname.startsWith("/admin")) return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

export function postLoginPath(role: string | null | undefined, returnTo?: string | null) {
  return role === "ADMIN" ? "/admin" : safeReturnPath(returnTo);
}
