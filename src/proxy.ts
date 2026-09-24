import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

/**
 * Maintenance gate for the public storefront (Web container only).
 *
 * When MAINTENANCE_MODE=on, every visitor on a storefront path gets a 503
 * rewrite to /maintenance — except the owner, who passes through either with
 * a NextAuth ADMIN session or a signed `site_unlock` cookie obtained via
 * `?unlock=<SITE_UNLOCK_SECRET>`.
 *
 * The WB corridor (/guide — separate Guide container), TWA (/twa), all
 * /api/* routes and static assets are never matched, so bots, the corridor
 * and the admin TWA keep working regardless of the flag.
 */

const UNLOCK_COOKIE = "site_unlock";

// Storefront paths only — everything else bypasses the proxy entirely.
// Matcher values must be static constants (analyzed at build time).
export const config = {
  matcher: [
    "/",
    "/admin/:path*",
    "/checkout/:path*",
    "/dashboard/:path*",
    "/faq/:path*",
    "/forgot-password/:path*",
    "/guarantees/:path*",
    "/legal/:path*",
    "/login/:path*",
    "/email/:path*",
    "/payment/:path*",
    "/privacy/:path*",
    "/register/:path*",
    "/reset-password/:path*",
    "/reviews/:path*",
  ],
};

// Deterministic per-deployment cookie value: HMAC(unlock+auth secrets).
// Knowing the cookie name alone is useless without both secrets.
async function expectedUnlockCookie(): Promise<string | null> {
  const unlockSecret = process.env.SITE_UNLOCK_SECRET;
  const authSecret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!unlockSecret || !authSecret) return null;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`${unlockSecret}:${authSecret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode("site_unlock:v1")
  );
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function proxy(request: NextRequest) {
  if (process.env.MAINTENANCE_MODE !== "on") return NextResponse.next();

  const expected = await expectedUnlockCookie();

  // ?unlock=<secret> → set the signed cookie, then redirect to the same URL
  // without the parameter so the secret doesn't stay in the address bar.
  const attempt = request.nextUrl.searchParams.get("unlock");
  if (attempt !== null) {
    if (expected && attempt === process.env.SITE_UNLOCK_SECRET) {
      const clean = request.nextUrl.clone();
      clean.searchParams.delete("unlock");
      const response = NextResponse.redirect(clean);
      response.cookies.set(UNLOCK_COOKIE, expected, {
        httpOnly: true,
        secure: request.nextUrl.protocol === "https:",
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 30, // 30 days
      });
      return response;
    }
  }

  if (expected && request.cookies.get(UNLOCK_COOKIE)?.value === expected) {
    return NextResponse.next();
  }

  // Owner bypass — valid NextAuth session with role ADMIN.
  const authSecret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (authSecret) {
    // getToken defaults secureCookie to false, which would miss the
    // __Secure-authjs.session-token cookie in production — derive it from
    // the canonical app URL instead.
    const secureCookie = (
      process.env.AUTH_URL ??
      process.env.NEXTAUTH_URL ??
      ""
    ).startsWith("https://");
    const token = await getToken({
      req: request,
      secret: authSecret,
      secureCookie,
    }).catch(() => null);
    if (token?.role === "ADMIN") return NextResponse.next();
  }

  // The /maintenance route handler owns the response (503 + Retry-After):
  // a custom status passed to rewrite() here is ignored by the production
  // server — the destination's own status wins.
  const url = request.nextUrl.clone();
  url.pathname = "/maintenance";
  url.search = "";
  return NextResponse.rewrite(url);
}
