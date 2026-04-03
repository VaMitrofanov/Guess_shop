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
    let query = q.trim();
    // Support links with extra params like ?id=...
    const cleanUrl = query.split('?')[0];

    // 1. Try to extract ID from various Roblox URL formats
    const urlMatch = cleanUrl.match(/(?:game-pass|catalog|library|assets)\/(\d+)/i);
    const idMatch = query.match(/^\d+$/);
    const targetId = urlMatch ? urlMatch[1] : (idMatch ? query : null);
    
    const isUrl = !!urlMatch;

    if (targetId) {
      const { getGamepassById } = await import("@/lib/roblox");
      const gp = await getGamepassById(targetId);
      return NextResponse.json({ 
        success: true, 
        gamepasses: gp ? [gp] : [],
        isDirect: true // Flag for frontend to know it was a direct ID/URL search
      });
    }

    // 2. Otherwise assume it's a username
    const gamepasses = await getUserGamepasses(query);
    return NextResponse.json({ 
        success: true, 
        gamepasses,
        isDirect: false,
        detectedUsername: gamepasses.length > 0 ? query : null 
    });
  } catch (error) {
    console.error("Gamepasses API Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
