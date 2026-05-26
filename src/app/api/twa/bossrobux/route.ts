import { NextRequest, NextResponse } from "next/server";
import { extractTwaUser } from "@/lib/twa-auth";

const BASE = "https://bossrobux.com/api";

function brToken() {
  return process.env.BOSSROBUX_TOKEN ?? "";
}

async function brPost(endpoint: string, body: object = {}) {
  const res = await fetch(`${BASE}/${endpoint}`, {
    method: "POST",
    headers: { Token: brToken(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<Record<string, unknown>>;
}

// VND/USD rate cache (1 hour TTL, module-level — survives across requests in the same process)
let vndRateCache: { usdPerVnd: number; ts: number } | null = null;

async function getVndToUsd(): Promise<number> {
  const now = Date.now();
  if (vndRateCache && now - vndRateCache.ts < 3_600_000) return vndRateCache.usdPerVnd;
  try {
    const r = await fetch("https://open.er-api.com/v6/latest/VND", { signal: AbortSignal.timeout(5_000) });
    const d = await r.json() as Record<string, any>;
    const usdPerVnd = Number(d?.rates?.USD ?? 0);
    if (usdPerVnd > 0) {
      vndRateCache = { usdPerVnd, ts: now };
      return usdPerVnd;
    }
  } catch { /* fall through */ }
  // fallback ≈ 25,300 VND = $1
  return 1 / 25_300;
}

export async function GET(req: NextRequest) {
  if (!await extractTwaUser(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!brToken()) return NextResponse.json({ error: "Token not configured" }, { status: 503 });
  try {
    const [data, usdPerVnd] = await Promise.all([brPost("get-rb"), getVndToUsd()]);
    if (data.robux_total === undefined) return NextResponse.json({ error: "Bad response" }, { status: 502 });
    return NextResponse.json({
      rate:        Number(data.rate),
      robux_total: Number(data.robux_total),
      robux_max:   Number(data.robux_max),
      usd_per_vnd: usdPerVnd,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  if (!await extractTwaUser(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!brToken()) return NextResponse.json({ error: "Token not configured" }, { status: 503 });

  const body = await req.json().catch(() => null);
  if (!body?.action) return NextResponse.json({ error: "action required" }, { status: 400 });

  if (body.action === "search") {
    const username = String(body.username ?? "").trim();
    if (!username) return NextResponse.json({ error: "username required" }, { status: 400 });
    try {
      const data = await brPost("get-gamepass", { name: username });
      if (data.status === "success") {
        return NextResponse.json({ gamepasses: Array.isArray(data.data) ? data.data : [] });
      }
      if (Array.isArray(data)) return NextResponse.json({ gamepasses: data });
      return NextResponse.json({ error: String(data.msg ?? "Search failed") }, { status: 400 });
    } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: 502 });
    }
  }

  if (body.action === "purchase") {
    const gp = body.gp;
    if (!gp?.gamepassId) return NextResponse.json({ error: "gp required" }, { status: 400 });
    try {
      const data = await brPost("get-orders", {
        placeId:    gp.placeId,
        productId:  gp.productId,
        gamepassId: gp.gamepassId,
        robux:      gp.robux,
        sellerName: gp.sellerName,
      });
      return NextResponse.json({
        success: data.status === "success",
        msg: String(data.msg ?? (data.status === "success" ? "Успешно" : "Ошибка")),
      });
    } catch (e: any) {
      return NextResponse.json({ success: false, msg: e.message });
    }
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
