import { NextRequest, NextResponse } from "next/server";
import { getUserGames, getUniverseGamepasses } from "@/lib/roblox";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { ok, retryAfter } = rateLimit(`roblox-games:${clientIp(req)}`, 20, 0.5);
  if (!ok) {
    return NextResponse.json(
      { error: "Слишком много запросов. Попробуйте через минуту." },
      { status: 429, headers: { "retry-after": String(retryAfter) } },
    );
  }

  const { searchParams } = new URL(req.url);
  const username   = searchParams.get("username")?.trim() ?? "";
  const universeId = searchParams.get("universeId")?.trim() ?? "";

  // ── Return gamepasses for a specific universe ──────────────────────────────
  if (universeId) {
    try {
      const passes = await getUniverseGamepasses(universeId);
      return NextResponse.json({ success: true, gamepasses: passes });
    } catch (error) {
      console.error("[Games API] getUniverseGamepasses error:", error);
      return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
  }

  // ── Return list of games for a username ────────────────────────────────────
  if (!username) {
    return NextResponse.json({ error: "username is required" }, { status: 400 });
  }

  try {
    const games = await getUserGames(username);
    return NextResponse.json({ success: true, games });
  } catch (error) {
    console.error("[Games API] getUserGames error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
