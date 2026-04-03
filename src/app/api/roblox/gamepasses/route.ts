import { NextRequest, NextResponse } from "next/server";
import { getUserGamepasses } from "@/lib/roblox";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("query") || "";

  if (!q) {
    return NextResponse.json({ error: "Query is required" }, { status: 400 });
  }

  try {
    const query = q.trim();
    // 1. Try to extract ID from URL (catalog or game-pass)
    const urlMatch = query.match(/(?:game-pass|catalog)\/(\d+)/i);
    const idMatch = query.match(/^\d+$/);
    const targetId = urlMatch ? urlMatch[1] : (idMatch ? query : null);

    console.log("Roblox Search Query:", query, "Extracted ID:", targetId);

    if (targetId) {
      const { getGamepassById } = await import("@/lib/roblox");
      const gp = await getGamepassById(targetId);
      console.log("Found Single Gamepass:", gp?.id);
      return NextResponse.json({ success: true, gamepasses: gp ? [gp] : [] });
    }

    // 2. Otherwise assume it's a username
    const gamepasses = await getUserGamepasses(query);
    console.log("Found Gamepasses for User:", gamepasses.length);
    return NextResponse.json({ success: true, gamepasses });
  } catch (error) {
    console.error("Gamepasses API Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
