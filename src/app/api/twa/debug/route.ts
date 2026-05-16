import { NextRequest, NextResponse } from "next/server";
import { getStats30d } from "@/lib/wb-api";

function getWbToken() {
  return (process.env.WB_API_TOKEN ?? "").trim().replace(/^["'`]|["'`]$/g, "").trim();
}

export async function GET(req: NextRequest) {
  // Protected by ADMIN_SECRET, not TWA auth — lets us diagnose from curl
  const secret = req.nextUrl.searchParams.get("secret");
  if (secret !== process.env.ADMIN_SECRET) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const raw   = process.env.WB_API_TOKEN ?? "";
  const clean = getWbToken();

  // Test raw HTTP first
  let httpStatus: number | null = null;
  let httpError: string | null  = null;
  try {
    const dateFrom = new Date(Date.now() - 7 * 864e5).toISOString().split(".")[0] + "Z";
    const res = await fetch(
      `https://statistics-api.wildberries.ru/api/v1/supplier/orders?dateFrom=${encodeURIComponent(dateFrom)}&flag=0`,
      { cache: "no-store", headers: { Authorization: clean } }
    );
    httpStatus = res.status;
  } catch (e: any) {
    httpError = e?.message ?? "unknown";
  }

  // Test full getStats30d (includes Zod parsing)
  let statsResult: "ok" | "null" | string = "not_run";
  try {
    const stats = await getStats30d();
    statsResult = stats ? `ok (orders=${stats.orders.length} sales=${stats.sales.length})` : "null";
  } catch (e: any) {
    statsResult = `throw: ${e?.message ?? "unknown"}`;
  }

  return NextResponse.json({
    rawTokenLength:   raw.length,
    cleanTokenLength: clean.length,
    tokenFirstChars:  clean.slice(0, 12) || "(empty)",
    tokensMatch:      raw === clean,
    httpStatus,
    httpError,
    statsResult,
    nodeEnv: process.env.NODE_ENV,
  });
}
