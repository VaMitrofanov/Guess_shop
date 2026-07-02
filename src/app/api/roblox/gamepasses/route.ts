import { NextRequest, NextResponse } from "next/server";
import { getUserGamepasses, getRobloxUser } from "@/lib/roblox";

export const dynamic = "force-dynamic";

/**
 * Extracts gamepass ID from any Roblox URL format or plain ID.
 * Supports:
 *   https://www.roblox.com/game-pass/1784555857/name
 *   https://www.roblox.com/game-pass/1784555857
 *   roblox.com/game-pass/1784555857
 *   1784555857  (plain numeric ID)
 */
function extractGamepassId(input: string): string | null {
  const trimmed = input.trim();

  // Plain numeric ID
  if (/^\d+$/.test(trimmed)) return trimmed;

  // URL — strip query string and hash first
  const cleanUrl = trimmed.split("?")[0].split("#")[0];

  // Match any of the known URL patterns (case-insensitive)
  const patterns = [
    /game-pass(?:es)?\/(\d+)/i,
    /game_pass(?:es)?\/(\d+)/i,
    /catalog\/(\d+)/i,
    /library\/(\d+)/i,
    /assets?\/(\d+)/i,
  ];

  for (const pattern of patterns) {
    const m = cleanUrl.match(pattern);
    if (m?.[1]) return m[1];
  }

  return null;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("query")?.trim() ?? "";

  if (!q) {
    return NextResponse.json({ error: "Query is required" }, { status: 400 });
  }

  try {
    const gamepassId = extractGamepassId(q);

    // ── Direct ID or URL lookup ──────────────────────────────────────
    if (gamepassId) {
      const { getGamepassById } = await import("@/lib/roblox");
      const gp = await getGamepassById(gamepassId);
      return NextResponse.json({
        success: true,
        gamepasses: gp ? [gp] : [],
        isDirect: true,
      });
    }

    // ── Username lookup ──────────────────────────────────────────────
    const gamepasses = await getUserGamepasses(q);
    if (gamepasses.length > 0) {
      return NextResponse.json({
        success: true,
        gamepasses,
        isDirect: false,
        detectedUsername: q,
        userExists: true,
      });
    }
    // Empty — distinguish "no such user on Roblox" (likely a typo) from
    // "user exists but has no public for-sale gamepasses" (place closed / not
    // created). Mirrors the bot's searchGamepassesByNick branching. We only pay
    // for this extra resolve when the fast path returned nothing.
    const user = await getRobloxUser(q);
    return NextResponse.json({
      success: true,
      gamepasses: [],
      isDirect: false,
      detectedUsername: null,
      userExists: !!user,
    });
  } catch (error) {
    console.error("[Gamepasses API] Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
