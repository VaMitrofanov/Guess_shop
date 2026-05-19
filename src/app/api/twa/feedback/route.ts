import { NextRequest, NextResponse } from "next/server";
import { extractTwaUser } from "@/lib/twa-auth";
import { getFeedbackSummary } from "@/lib/wb-api";

export async function GET(req: NextRequest) {
  if (!await extractTwaUser(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const data = await getFeedbackSummary();
  if (!data) return NextResponse.json({ error: "WB API unavailable" }, { status: 503 });
  return NextResponse.json(data);
}
