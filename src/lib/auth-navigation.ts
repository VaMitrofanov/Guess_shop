export function normalizeLoginEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function postLoginPath(role: string | null | undefined): "/admin" | "/dashboard" {
  return role === "ADMIN" ? "/admin" : "/dashboard";
}
