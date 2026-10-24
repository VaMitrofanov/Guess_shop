import { NextRequest, NextResponse } from "next/server";
import { extractTwaUser } from "@/lib/twa-auth";
import { prisma } from "@/lib/prisma";

const BASE = "https://bossrobux.com/api";

function brToken() {
  return process.env.BOSSROBUX_TOKEN ?? "";
}

async function brPost(endpoint: string, body: object = {}) {
  console.log(`[BossRobux] POST /${endpoint}`, JSON.stringify(body));
  const res = await fetch(`${BASE}/${endpoint}`, {
    method: "POST",
    headers: { Token: brToken(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  console.log(`[BossRobux] /${endpoint} → HTTP ${res.status}: ${text}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
  return JSON.parse(text) as Record<string, unknown>;
}

export async function GET(req: NextRequest) {
  if (!await extractTwaUser(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!brToken()) return NextResponse.json({ error: "Token not configured" }, { status: 503 });
  try {
    const data = await brPost("get-rb");
    if (data.robux_total === undefined) return NextResponse.json({ error: "Bad response" }, { status: 502 });
    const rate = Number(data.rate);
    let rate_usd: number;
    if (data.rate_usd !== undefined) {
      rate_usd = Number(data.rate_usd);
    } else if (data.rate_usdt !== undefined) {
      rate_usd = rate / Number(data.rate_usdt);
    } else {
      const mr = await prisma.marketRate.findUnique({ where: { provider: "bossrobux" } });
      rate_usd = mr ? mr.rateUSD / 1000 : rate / 26_000;
    }
    return NextResponse.json({
      rate,
      robux_total: Number(data.robux_total),
      robux_max:   Number(data.robux_max),
      rate_usd,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  if (!await extractTwaUser(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body?.action) return NextResponse.json({ error: "action required" }, { status: 400 });

  if (body.action === "lookup") {
    const gamepassId = String(body.gamepassId ?? "").trim();
    if (!gamepassId || !/^\d{1,20}$/.test(gamepassId)) {
      return NextResponse.json({ error: "gamepassId required" }, { status: 400 });
    }

    const bridgeUrl = process.env.VALIDATOR_SOURCE_URL?.trim();
    if (!bridgeUrl) {
      return NextResponse.json({ error: "Поиск недоступен — VALIDATOR_SOURCE_URL не задан" });
    }

    try {
      const res = await fetch(
        `${bridgeUrl.replace(/\/+$/, "")}/gamepass-by-id?id=${gamepassId}`,
        {
          headers: process.env.VALIDATOR_KEY
            ? { "x-validator-key": process.env.VALIDATOR_KEY }
            : {},
          signal: AbortSignal.timeout(25_000),
        }
      );
      const data = await res.json().catch(() => null);
      if (!data?.ok) {
        return NextResponse.json({ error: data?.error ?? "Ошибка поиска" });
      }
      return NextResponse.json({ gamepass: data.gamepass ?? null });
    } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: 502 });
    }
  }

  if (body.action === "search") {
    const username = String(body.username ?? "").trim();
    if (!username) return NextResponse.json({ error: "username required" }, { status: 400 });

    const bridgeUrl = process.env.VALIDATOR_SOURCE_URL?.trim();
    if (!bridgeUrl) {
      return NextResponse.json({ error: "Поиск недоступен — VALIDATOR_SOURCE_URL не задан" });
    }

    try {
      const res = await fetch(`${bridgeUrl.replace(/\/+$/, "")}/search-gamepasses`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(process.env.VALIDATOR_KEY ? { "x-validator-key": process.env.VALIDATOR_KEY } : {}),
        },
        body: JSON.stringify({ username }),
        signal: AbortSignal.timeout(25_000),
      });
      const data = await res.json().catch(() => null);
      if (!data?.ok) {
        return NextResponse.json({ error: data?.error ?? "Ошибка поиска" });
      }
      return NextResponse.json({ gamepasses: data.gamepasses ?? [] });
    } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: 502 });
    }
  }

  if (body.action === "purchase") {
    if (!brToken()) return NextResponse.json({ success: false, msg: "BOSSROBUX_TOKEN не задан" });
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
