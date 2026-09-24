import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-access";
import { prisma } from "@/lib/prisma";
import { browserFailureMessage, getBrowserSession } from "@/lib/browser-purchase";

/**
 * Состояние донорского аккаунта: живой баланс, ник и свежесть cookie.
 *
 * Отдельный роут, потому что `getBrowserSession` ждёт серверный браузер до
 * 70 с. Страница выкупа рисует выгрузку сразу и подставляет донора, когда он
 * ответит; если браузер недоступен, показывается человеческая причина, а не
 * пустой прочерк.
 */
export async function GET(req: NextRequest) {
  if (!await requireAdmin(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const settings = await prisma.globalSettings.findUnique({
    where: { id: "global" },
    select: { robloxCookie: true, robloxCookieUpdatedAt: true, robloxAccountName: true },
  });

  const cookie = settings?.robloxCookie;
  const cookieUpdatedAt = settings?.robloxCookieUpdatedAt?.toISOString() ?? null;

  if (!cookie) {
    return NextResponse.json({
      hasCookie: false, cookieValid: false, cookieUpdatedAt,
      accountName: null, accountId: null, balance: null,
      problem: "Cookie донора не задан — выкуп невозможен. Задаётся в TWA → Аккаунт → 🔑.",
    });
  }

  // Это диагностический widget, а не purchase path: не держим UI до 70 секунд.
  const browser = await getBrowserSession(cookie, 12_000);

  return NextResponse.json({
    hasCookie: true,
    cookieValid: browser.ok,
    cookieUpdatedAt,
    accountName: browser.session?.accountName ?? settings?.robloxAccountName ?? null,
    accountId: browser.session?.accountId ?? null,
    balance: browser.session?.balance ?? null,
    problem: browser.ok ? null : browserFailureMessage(browser.reason, browser.code),
  }, { headers: { "Cache-Control": "private, no-store" } });
}
