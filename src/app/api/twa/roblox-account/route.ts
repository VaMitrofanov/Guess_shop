import { NextRequest, NextResponse } from "next/server";
import { extractTwaUser } from "@/lib/twa-auth";
import { prisma } from "@/lib/prisma";

const ROBLOX_HEADERS = {
  "User-Agent": "Roblox/WinInet",
  Accept: "application/json",
};

async function robloxGet(url: string, cookie: string) {
  const res = await fetch(url, {
    headers: { ...ROBLOX_HEADERS, Cookie: `.ROBLOSECURITY=${cookie}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

export async function GET(req: NextRequest) {
  if (!await extractTwaUser(req))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const settings = await (prisma as any).globalSettings.findUnique({ where: { id: "global" } });
  const cookie = settings?.robloxCookie;
  const cookieUpdatedAt = settings?.robloxCookieUpdatedAt ?? null;

  if (!cookie) {
    return NextResponse.json({
      hasCookie: false,
      cookieUpdatedAt,
      accountName: null,
      accountId: null,
      balance: null,
    });
  }

  const [user, currency] = await Promise.all([
    robloxGet("https://users.roblox.com/v1/users/authenticated", cookie),
    robloxGet("https://economy.roblox.com/v1/user/currency", cookie),
  ]);

  return NextResponse.json({
    hasCookie: true,
    cookieValid: !!user?.id,
    cookieUpdatedAt,
    accountName: user?.name ?? user?.displayName ?? null,
    accountId: user?.id ?? null,
    balance: currency?.robux ?? null,
  });
}

export async function POST(req: NextRequest) {
  if (!await extractTwaUser(req))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body?.action)
    return NextResponse.json({ error: "action required" }, { status: 400 });

  if (body.action === "set-cookie") {
    const rawCookie = String(body.cookie ?? "").trim();
    if (!rawCookie || rawCookie.length < 50)
      return NextResponse.json({ error: "Невалидный cookie" }, { status: 400 });

    const user = await robloxGet("https://users.roblox.com/v1/users/authenticated", rawCookie);
    if (!user?.id)
      return NextResponse.json({ error: "Cookie невалиден или истёк" }, { status: 400 });

    const currency = await robloxGet("https://economy.roblox.com/v1/user/currency", rawCookie);

    await (prisma as any).globalSettings.upsert({
      where: { id: "global" },
      create: { id: "global", robloxCookie: rawCookie, robloxCookieUpdatedAt: new Date() },
      update: { robloxCookie: rawCookie, robloxCookieUpdatedAt: new Date() },
    });

    return NextResponse.json({
      ok: true,
      accountName: user.name ?? user.displayName ?? "Unknown",
      accountId: user.id,
      balance: currency?.robux ?? null,
    });
  }

  if (body.action === "refresh-balance") {
    const settings = await (prisma as any).globalSettings.findUnique({ where: { id: "global" } });
    const cookie = settings?.robloxCookie;
    if (!cookie)
      return NextResponse.json({ error: "Cookie не задан" }, { status: 400 });

    const [user, currency] = await Promise.all([
      robloxGet("https://users.roblox.com/v1/users/authenticated", cookie),
      robloxGet("https://economy.roblox.com/v1/user/currency", cookie),
    ]);

    if (!user?.id)
      return NextResponse.json({ error: "Cookie истёк — обнови" }, { status: 400 });

    return NextResponse.json({
      ok: true,
      accountName: user.name ?? user.displayName ?? "Unknown",
      accountId: user.id,
      balance: currency?.robux ?? null,
    });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
