import { NextRequest, NextResponse } from "next/server";
import { extractTwaUser } from "@/lib/twa-auth";

function getWbToken() {
  return (process.env.WB_API_TOKEN ?? "").trim().replace(/^["'`]|["'`]$/g, "").trim();
}

export async function GET(req: NextRequest) {
  if (!await extractTwaUser(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const raw   = process.env.WB_API_TOKEN ?? "";
  const clean = getWbToken();

  // Test one statistics API call
  let apiStatus = "not_tested";
  let httpCode: number | null = null;
  try {
    const dateFrom = new Date(Date.now() - 7 * 864e5).toISOString().split(".")[0] + "Z";
    const res = await fetch(
      `https://statistics-api.wildberries.ru/api/v1/supplier/orders?dateFrom=${encodeURIComponent(dateFrom)}&flag=0`,
      { cache: "no-store", headers: { Authorization: clean } }
    );
    httpCode   = res.status;
    apiStatus  = res.ok ? "ok" : `http_${res.status}`;
  } catch (e: any) {
    apiStatus = `error: ${e?.message ?? "unknown"}`;
  }

  return NextResponse.json({
    rawTokenLength:   raw.length,
    cleanTokenLength: clean.length,
    tokenFirstChars:  clean.slice(0, 10) || "(empty)",
    tokensMatch:      raw === clean,
    apiStatus,
    httpCode,
    nodeEnv: process.env.NODE_ENV,
  });
}
