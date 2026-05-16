import { NextRequest, NextResponse } from "next/server";
import { extractTwaUser } from "@/lib/twa-auth";
import { getAdvertData } from "@/lib/wb-api";

export async function GET(req: NextRequest) {
  if (!await extractTwaUser(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const data = await getAdvertData();
  return NextResponse.json(data ?? { empty: true });
}
