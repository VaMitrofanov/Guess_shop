import { NextRequest, NextResponse } from "next/server";
import { getUserGamepasses } from "@/lib/roblox";

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
    return NextResponse.json({
      success: true,
      gamepasses,
      isDirect: false,
      detectedUsername: gamepasses.length > 0 ? q : null,
    });
  } catch (error) {
    console.error("[Gamepasses API] Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
