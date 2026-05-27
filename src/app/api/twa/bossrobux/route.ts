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

export async function GET(req: NextRequest) {
  if (!await extractTwaUser(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!brToken()) return NextResponse.json({ error: "Token not configured" }, { status: 503 });
  try {
    const data = await brPost("get-rb");
    if (data.robux_total === undefined) return NextResponse.json({ error: "Bad response" }, { status: 502 });
    return NextResponse.json({
      rate:        Number(data.rate),
      robux_total: Number(data.robux_total),
      robux_max:   Number(data.robux_max),
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
      console.log("[BossRobux/search] raw response:", JSON.stringify(data).slice(0, 500));
      // { status: "success", data: [...] }
      if (data.status === "success") {
        const arr = Array.isArray(data.data) ? data.data
          : Array.isArray((data as any).gamepasses) ? (data as any).gamepasses
          : Array.isArray((data as any).items) ? (data as any).items
          : [];
        return NextResponse.json({ gamepasses: arr });
      }
      // bare array
      if (Array.isArray(data)) return NextResponse.json({ gamepasses: data });
      // { success: true, data: [...] }
      if ((data as any).success === true) {
        const arr = Array.isArray(data.data) ? data.data
          : Array.isArray((data as any).gamepasses) ? (data as any).gamepasses
          : [];
        return NextResponse.json({ gamepasses: arr });
      }
      return NextResponse.json({ error: String(data.msg ?? (data as any).message ?? "Search failed") }, { status: 400 });
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
