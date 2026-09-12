import { NextRequest, NextResponse } from "next/server";
import { extractTwaUser } from "@/lib/twa-auth";
import { prisma } from "@/lib/prisma";

let cached: { count: number; ts: number } | null = null;
const TTL = 20_000;

export async function GET(req: NextRequest) {
  if (!await extractTwaUser(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (cached && Date.now() - cached.ts < TTL) {
    return NextResponse.json({ count: cached.count });
  }
  // `denominationSnapshot` — тот же признак «наш коридор», что в консоли
  // доставки и в воркерах: продажа самих кодов активации (`800code`) гейта не
  // требует и в бейдж попадать не должна.
  const count = await prisma.wbMarketplaceOrder.count({
    where: { isTest: false, completedAt: null, cancelledAt: null, denominationSnapshot: { not: null } },
  });
  cached = { count, ts: Date.now() };
  return NextResponse.json({ count });
}
