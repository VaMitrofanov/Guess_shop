import { NextRequest, NextResponse } from "next/server";
import { extractTwaUser } from "@/lib/twa-auth";

/**
 * Lightweight token-verify endpoint used during TWA startup.
 *
 * Replaces a former /api/twa/dashboard probe which pulled stats + DB counts
 * just to check that the stored JWT was still valid (~500-1500 ms cold).
 * This endpoint does no DB / WB API work — verifyTwaToken is in-memory HMAC.
 */
export async function GET(req: NextRequest) {
  const user = await extractTwaUser(req);
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  return NextResponse.json({ ok: true, userId: user.userId });
}
