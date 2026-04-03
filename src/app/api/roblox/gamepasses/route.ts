import { NextRequest, NextResponse } from "next/server";
import { getUserGamepasses } from "@/lib/roblox";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const username = searchParams.get("username");

  if (!username) {
    return NextResponse.json({ error: "Username is required" }, { status: 400 });
  }

  try {
    const gamepasses = await getUserGamepasses(username);
    return NextResponse.json({ success: true, gamepasses });
  } catch (error) {
    console.error("Gamepasses API Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
