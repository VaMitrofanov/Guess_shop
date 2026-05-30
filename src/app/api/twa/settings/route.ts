import { NextRequest, NextResponse } from "next/server";
import { extractTwaUser } from "@/lib/twa-auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  if (!await extractTwaUser(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const s = await (prisma as any).globalSettings.findUnique({ where: { id: "global" } });
  return NextResponse.json({
    purchaseRate:    s?.purchaseRate    ?? null,
    usdToRub:        s?.usdToRub        ?? 90,
    autoBuyEnabled:  s?.autoBuyEnabled  ?? false,
    autoBuyRate:     s?.autoBuyRate     ?? 4.0,
  });
}

export async function POST(req: NextRequest) {
  if (!await extractTwaUser(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const update: Record<string, unknown> = {};

  if ("purchaseRate" in body) {
    const v = body.purchaseRate === null ? null : parseFloat(String(body.purchaseRate));
    if (v !== null && (isNaN(v) || v <= 0 || v > 100))
      return NextResponse.json({ error: "purchaseRate out of range" }, { status: 400 });
    update.purchaseRate = v;
  }
  if ("usdToRub" in body) {
    const v = parseFloat(String(body.usdToRub));
    if (isNaN(v) || v <= 0 || v > 500)
      return NextResponse.json({ error: "usdToRub out of range" }, { status: 400 });
    update.usdToRub = v;
  }
  if ("autoBuyEnabled" in body) {
    update.autoBuyEnabled = Boolean(body.autoBuyEnabled);
  }
  if ("autoBuyRate" in body) {
    const v = parseFloat(String(body.autoBuyRate));
    if (isNaN(v) || v < 1 || v > 20)
      return NextResponse.json({ error: "autoBuyRate out of range (1–20)" }, { status: 400 });
    update.autoBuyRate = v;
  }

  if (Object.keys(update).length === 0)
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  const s = await (prisma as any).globalSettings.upsert({
    where:  { id: "global" },
    update,
    create: { id: "global", usdToRub: 90, autoBuyEnabled: false, autoBuyRate: 4.0, ...update },
  });

  return NextResponse.json({
    purchaseRate:   s.purchaseRate   ?? null,
    usdToRub:       s.usdToRub       ?? 90,
    autoBuyEnabled: s.autoBuyEnabled ?? false,
    autoBuyRate:    s.autoBuyRate    ?? 4.0,
  });
}
