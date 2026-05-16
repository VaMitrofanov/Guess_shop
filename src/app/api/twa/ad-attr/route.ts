import { NextRequest, NextResponse } from "next/server";
import { extractTwaUser } from "@/lib/twa-auth";
import { getAdvertSpendSince } from "@/lib/wb-api";
import { prisma } from "@/lib/prisma";

async function getSettings() {
  return (prisma as any).wbSettings.upsert({
    where:  { id: 1 },
    update: {},
    create: { id: 1, kursRb: 4, kursUsd: 75, fixedCost: 87.5 },
  }) as Promise<{ lastAdAttributedAt: Date | null }>;
}

// GET — returns unattributed spend (= CPO for next order)
export async function GET(req: NextRequest) {
  if (!await extractTwaUser(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const settings = await getSettings();

  // If never attributed before, start from 30 days ago as a sane default
  const fromDate = settings.lastAdAttributedAt
    ? settings.lastAdAttributedAt.toISOString().split("T")[0]
    : new Date(Date.now() - 30 * 864e5).toISOString().split("T")[0];

  const spend = await getAdvertSpendSince(fromDate);

  return NextResponse.json({
    unattributedSpend: spend !== null ? Math.round(spend) : null,
    lastAttributedAt:  settings.lastAdAttributedAt ?? null,
    fromDate,
    apiAvailable: spend !== null,
  });
}

// POST — mark current unattributed spend as attributed to a completed order
export async function POST(req: NextRequest) {
  if (!await extractTwaUser(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const settings = await getSettings();

  const fromDate = settings.lastAdAttributedAt
    ? settings.lastAdAttributedAt.toISOString().split("T")[0]
    : new Date(Date.now() - 30 * 864e5).toISOString().split("T")[0];

  const spend = await getAdvertSpendSince(fromDate);

  // Update lastAdAttributedAt to right now
  await (prisma as any).wbSettings.update({
    where:  { id: 1 },
    data:   { lastAdAttributedAt: new Date() },
  });

  return NextResponse.json({
    attributed:      spend !== null ? Math.round(spend) : 0,
    lastAttributedAt: new Date().toISOString(),
    apiAvailable:    spend !== null,
  });
}
