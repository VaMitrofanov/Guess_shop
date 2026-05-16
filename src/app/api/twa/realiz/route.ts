import { NextRequest, NextResponse } from "next/server";
import { extractTwaUser } from "@/lib/twa-auth";
import { getRealizData } from "@/lib/wb-api";

export async function GET(req: NextRequest) {
  if (!await extractTwaUser(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const weeks = req.nextUrl.searchParams.get("weeks") === "2" ? 2 : 4;
  const data = await getRealizData(weeks);
  if (!data) return NextResponse.json({ error: "WB API unavailable" }, { status: 503 });
  return NextResponse.json(data);
}
