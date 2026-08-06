import { NextRequest, NextResponse } from "next/server";
import { extractTwaUser } from "@/lib/twa-auth";
import { prisma } from "@/lib/prisma";
import { normalizeRobloxSecurityCookie } from "@/lib/roblox-cookie";
import { browserFailureMessage, getBrowserSession } from "@/lib/browser-purchase";

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

  const browser = await getBrowserSession(cookie);

  return NextResponse.json({
    hasCookie: true,
    cookieValid: browser.ok,
    cookieUpdatedAt,
    accountName: browser.session?.accountName ?? settings?.robloxAccountName ?? null,
    accountId: browser.session?.accountId ?? null,
    balance: browser.session?.balance ?? null,
    failureCode: browser.ok ? null : browser.code,
  });
}

export async function POST(req: NextRequest) {
  if (!await extractTwaUser(req))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body?.action)
    return NextResponse.json({ error: "action required" }, { status: 400 });

  if (body.action === "set-cookie") {
    const rawCookie = normalizeRobloxSecurityCookie(body.cookie);
    if (!rawCookie || rawCookie.length < 50)
      return NextResponse.json({ error: "Невалидный cookie" }, { status: 400 });

    const browser = await getBrowserSession(rawCookie);
    if (!browser.ok || !browser.session) {
      const status = browser.code === "DONOR_COOKIE_INVALID" ? 400 : 503;
      return NextResponse.json({ error: browserFailureMessage(browser.reason, browser.code), failureCode: browser.code }, { status });
    }

    const accountName = browser.session.accountName;
    await (prisma as any).globalSettings.upsert({
      where: { id: "global" },
      create: { id: "global", usdToRub: 90, robloxCookie: rawCookie, robloxCookieUpdatedAt: new Date(), robloxAccountName: accountName },
      update: { robloxCookie: rawCookie, robloxCookieUpdatedAt: new Date(), robloxAccountName: accountName },
    });

    return NextResponse.json({
      ok: true,
      accountName,
      accountId: browser.session.accountId,
      balance: browser.session.balance,
    });
  }

  if (body.action === "refresh-balance") {
    const settings = await (prisma as any).globalSettings.findUnique({ where: { id: "global" } });
    const cookie = settings?.robloxCookie;
    if (!cookie)
      return NextResponse.json({ error: "Cookie не задан" }, { status: 400 });

    const browser = await getBrowserSession(cookie);
    if (!browser.ok || !browser.session) {
      const status = browser.code === "DONOR_COOKIE_INVALID" ? 400 : 503;
      return NextResponse.json({ error: browserFailureMessage(browser.reason, browser.code), failureCode: browser.code }, { status });
    }

    return NextResponse.json({
      ok: true,
      accountName: browser.session.accountName,
      accountId: browser.session.accountId,
      balance: browser.session.balance,
    });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
