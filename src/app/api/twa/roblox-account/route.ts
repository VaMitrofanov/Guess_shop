import { NextRequest, NextResponse } from "next/server";
import { extractTwaUser } from "@/lib/twa-auth";
import { prisma } from "@/lib/prisma";
import { normalizeRobloxSecurityCookie } from "@/lib/roblox-cookie";
import { browserFailureMessage, getBrowserSession } from "@/lib/browser-purchase";

async function robloxApiFallback(cookie: string): Promise<{
  ok: boolean;
  accountName: string | null;
  accountId: number | null;
  balance: number | null;
}> {
  try {
    const headers = { Cookie: `.ROBLOSECURITY=${cookie}` };
    const [userRes, balRes] = await Promise.all([
      fetch("https://users.roblox.com/v1/users/authenticated", { headers, signal: AbortSignal.timeout(10_000) }),
      fetch("https://economy.roblox.com/v1/user/currency", { headers, signal: AbortSignal.timeout(10_000) }),
    ]);
    if (!userRes.ok) return { ok: false, accountName: null, accountId: null, balance: null };
    const user = await userRes.json();
    const bal = balRes.ok ? await balRes.json() : null;
    return { ok: true, accountName: user.name ?? user.displayName, accountId: user.id, balance: bal?.robux ?? null };
  } catch {
    return { ok: false, accountName: null, accountId: null, balance: null };
  }
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

  const browser = await getBrowserSession(cookie);

  if (browser.ok) {
    return NextResponse.json({
      hasCookie: true,
      cookieValid: true,
      cookieUpdatedAt,
      accountName: browser.session?.accountName ?? settings?.robloxAccountName ?? null,
      accountId: browser.session?.accountId ?? null,
      balance: browser.session?.balance ?? null,
      failureCode: null,
    });
  }

  if (browser.code === "BROWSER_SERVICE_UNAVAILABLE") {
    const api = await robloxApiFallback(cookie);
    return NextResponse.json({
      hasCookie: true,
      cookieValid: api.ok,
      cookieUpdatedAt,
      accountName: api.accountName ?? settings?.robloxAccountName ?? null,
      accountId: api.accountId ?? null,
      balance: api.balance,
      browserUnavailable: true,
      failureCode: api.ok ? null : "DONOR_COOKIE_INVALID",
    });
  }

  return NextResponse.json({
    hasCookie: true,
    cookieValid: false,
    cookieUpdatedAt,
    accountName: settings?.robloxAccountName ?? null,
    accountId: null,
    balance: null,
    failureCode: browser.code,
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

    if (browser.ok && browser.session) {
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

    if (browser.code === "BROWSER_SERVICE_UNAVAILABLE") {
      const api = await robloxApiFallback(rawCookie);
      if (!api.ok) {
        return NextResponse.json({ error: "Cookie невалиден — Roblox не принял" }, { status: 400 });
      }
      await (prisma as any).globalSettings.upsert({
        where: { id: "global" },
        create: { id: "global", usdToRub: 90, robloxCookie: rawCookie, robloxCookieUpdatedAt: new Date(), robloxAccountName: api.accountName },
        update: { robloxCookie: rawCookie, robloxCookieUpdatedAt: new Date(), robloxAccountName: api.accountName },
      });
      return NextResponse.json({
        ok: true,
        accountName: api.accountName,
        accountId: api.accountId,
        balance: api.balance,
        browserUnavailable: true,
      });
    }

    const status = browser.code === "DONOR_COOKIE_INVALID" ? 400 : 503;
    return NextResponse.json({ error: browserFailureMessage(browser.reason, browser.code), failureCode: browser.code }, { status });
  }

  if (body.action === "refresh-balance") {
    const settings = await (prisma as any).globalSettings.findUnique({ where: { id: "global" } });
    const cookie = settings?.robloxCookie;
    if (!cookie)
      return NextResponse.json({ error: "Cookie не задан" }, { status: 400 });

    const browser = await getBrowserSession(cookie);

    if (browser.ok && browser.session) {
      return NextResponse.json({
        ok: true,
        accountName: browser.session.accountName,
        accountId: browser.session.accountId,
        balance: browser.session.balance,
      });
    }

    if (browser.code === "BROWSER_SERVICE_UNAVAILABLE") {
      const api = await robloxApiFallback(cookie);
      if (!api.ok) {
        return NextResponse.json({ error: "Cookie невалиден — Roblox не принял" }, { status: 400 });
      }
      return NextResponse.json({
        ok: true,
        accountName: api.accountName,
        accountId: api.accountId,
        balance: api.balance,
        browserUnavailable: true,
      });
    }

    const status = browser.code === "DONOR_COOKIE_INVALID" ? 400 : 503;
    return NextResponse.json({ error: browserFailureMessage(browser.reason, browser.code), failureCode: browser.code }, { status });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
