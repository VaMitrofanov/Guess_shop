import { NextRequest, NextResponse } from "next/server";
import { extractTwaUser } from "@/lib/twa-auth";
import { prisma } from "@/lib/prisma";
import { URGENT_SQL } from "@/lib/order-queue";

let cached: { count: number; ts: number } | null = null;
const TTL = 20_000;

export async function GET(req: NextRequest) {
  if (!await extractTwaUser(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (cached && Date.now() - cached.ts < TTL) {
    return NextResponse.json({ count: cached.count });
  }
  // «Выкупить» + «Починить» по общим правилам (order-queue.ts). Свой SQL до
  // 20.10 считал и замороженные: значок 43 при очереди 25.
  const rows: { count: number }[] = await (prisma as any).$queryRawUnsafe(
    `SELECT COUNT(*)::int AS count FROM "WbOrder" WHERE "isTest" = false AND ${URGENT_SQL}`,
  );
  const count = Number(rows[0]?.count ?? 0);
  cached = { count, ts: Date.now() };
  return NextResponse.json({ count });
}
