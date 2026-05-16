import { NextRequest, NextResponse } from "next/server";
import { getStats30d } from "@/lib/wb-api";
import { prisma } from "@/lib/prisma";

function getWbToken() {
  return (process.env.WB_API_TOKEN ?? "").trim().replace(/^["'`]|["'`]$/g, "").trim();
}

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (secret !== process.env.ADMIN_SECRET) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const raw   = process.env.WB_API_TOKEN ?? "";
  const clean = getWbToken();

  // 1. Simulate EXACTLY what dashboard route does: Promise.all with DB + WB
  let statsInParallel: string = "not_run";
  let dbWorked = false;
  try {
    const [stats, _codes] = await Promise.all([
      getStats30d(),
      (prisma as any).wbCode.count(),
    ]);
    dbWorked = true;
    statsInParallel = stats
      ? `ok (orders=${stats.orders.length} sales=${stats.sales.length})`
      : "NULL — apiAvailable would be false";
  } catch (e: any) {
    statsInParallel = `throw: ${e?.message ?? "unknown"}`;
  }

  // 2. Sequential call (no DB in parallel)
  let statsAlone: string = "not_run";
  try {
    const stats = await getStats30d();
    statsAlone = stats ? `ok (orders=${stats.orders.length})` : "NULL";
  } catch (e: any) {
    statsAlone = `throw: ${e?.message ?? "unknown"}`;
  }

  return NextResponse.json({
    tokenLen:        clean.length,
    tokenFirst12:    clean.slice(0, 12) || "(empty)",
    statsInParallel,
    statsAlone,
    dbWorked,
    nodeEnv:         process.env.NODE_ENV,
  });
}
