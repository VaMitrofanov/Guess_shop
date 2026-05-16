import { NextRequest, NextResponse } from "next/server";
import { validateInitData, isAdmin, signTwaToken } from "@/lib/twa-auth";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { initData, userId: rawUserId, firstName: rawFirstName } = body;

  // Path 1: full HMAC validation (most secure)
  if (initData) {
    const result = validateInitData(initData);
    if (!result.valid) return NextResponse.json({ error: "Invalid initData" }, { status: 401 });
    if (!isAdmin(result.userId)) return NextResponse.json({ error: "Not admin" }, { status: 403 });
    const token = await signTwaToken(result.userId!, result.firstName ?? "Admin");
    return NextResponse.json({ token, firstName: result.firstName });
  }

  // Path 2: initData absent (Telegram iOS sometimes omits it) — trust userId
  // from initDataUnsafe but verify it's a known admin ID.
  const userId = typeof rawUserId === "number" ? rawUserId : parseInt(String(rawUserId ?? ""), 10);
  if (!isNaN(userId) && userId > 0 && isAdmin(userId)) {
    const token = await signTwaToken(userId, rawFirstName ?? "Admin");
    return NextResponse.json({ token, firstName: rawFirstName ?? "Admin" });
  }

  return NextResponse.json({ error: "No initData" }, { status: 400 });
}
