import { NextRequest, NextResponse } from "next/server";
import { extractTwaUser } from "@/lib/twa-auth";
import { getOrderIntelligence } from "@/lib/order-intelligence";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!await extractTwaUser(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const dossier = await getOrderIntelligence(id);
  if (!dossier) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  return NextResponse.json(dossier);
}
