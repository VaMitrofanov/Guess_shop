import { NextRequest, NextResponse } from "next/server";
import { extractTwaUser } from "@/lib/twa-auth";
import { getNmFunnel, getGoods } from "@/lib/wb-api";

export async function GET(req: NextRequest) {
  if (!await extractTwaUser(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [funnel, goods] = await Promise.all([getNmFunnel(), getGoods()]);
  return NextResponse.json({ funnel: funnel ?? [], goods: goods ?? [] });
}
