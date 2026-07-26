import { NextRequest, NextResponse } from "next/server";
import {
  extractTwaUser,
  signTwaToken,
  TWA_TOKEN_RENEW_BEFORE_SEC,
} from "@/lib/twa-auth";

/**
 * Lightweight token-verify endpoint used during TWA startup.
 *
 * Replaces a former /api/twa/dashboard probe which pulled stats + DB counts
 * just to check that the stored JWT was still valid (~500-1500 ms cold).
 * This endpoint does no DB / WB API work — verifyTwaToken is in-memory HMAC.
 *
 * U1: TTL пропуска сокращён с 12 ч до 2 ч, поэтому здесь же живёт тихое
 * продление — если токену осталось меньше `TWA_TOKEN_RENEW_BEFORE_SEC`,
 * отдаём свежий, и активная работа в админке не прерывается логином.
 */
export async function GET(req: NextRequest) {
  const user = await extractTwaUser(req);
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });

  const secondsLeft = user.expiresAt - Math.floor(Date.now() / 1000);
  if (secondsLeft > 0 && secondsLeft < TWA_TOKEN_RENEW_BEFORE_SEC) {
    const token = await signTwaToken(user.userId, user.firstName);
    return NextResponse.json({ ok: true, userId: user.userId, token });
  }

  return NextResponse.json({ ok: true, userId: user.userId });
}
