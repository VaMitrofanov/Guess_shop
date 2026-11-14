import { NextRequest, NextResponse } from "next/server";
import { buildReferralCookie, isReferralCodeShape, REFERRAL_COOKIE, REFERRAL_COOKIE_MAX_AGE_S } from "@/lib/codes/referral";

export const dynamic = "force-dynamic";

/**
 * Реферальная ссылка `/r/<код>`: подписанная кука на 30 дней и переход к
 * покупке кодов. Существующую привязку кука не меняет — это решает сервер
 * при первом входе нового аккаунта.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const target = new URL("/?ref=1#codes", req.nextUrl.origin);
  const response = NextResponse.redirect(target, 302);
  response.headers.set("Referrer-Policy", "no-referrer");
  const normalized = code.toLowerCase();
  if (isReferralCodeShape(normalized) && !req.cookies.get(REFERRAL_COOKIE)) {
    response.cookies.set(REFERRAL_COOKIE, buildReferralCookie(normalized), {
      httpOnly: true,
      secure: req.nextUrl.protocol === "https:",
      sameSite: "lax",
      path: "/",
      maxAge: REFERRAL_COOKIE_MAX_AGE_S,
    });
  }
  return response;
}
