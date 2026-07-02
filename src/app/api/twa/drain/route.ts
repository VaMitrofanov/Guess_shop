import { NextRequest, NextResponse } from "next/server";
import { extractTwaUser } from "@/lib/twa-auth";
import { prisma } from "@/lib/prisma";

/**
 * "Слив" — drain a donor account's leftover balance into the operator's own
 * account. Flow: read donor balance → set the price of a gamepass on the drain
 * (own) account to that balance → wait until Roblox reflects the new price →
 * buy that gamepass with the donor account. Net effect: leftover R$ consolidate
 * into the drain account (minus Roblox's standard 30% marketplace fee, same as
 * any gamepass buyout).
 *
 * Two cookies are involved:
 *   • GlobalSettings.robloxCookie — the donor (buyer), same account used for buyouts.
 *   • GlobalSettings.drainCookie  — the operator's own account (seller / target).
 */

const ROBLOX_UA = { "User-Agent": "Roblox/WinInet", Accept: "application/json" };

async function authed(cookie: string): Promise<any | null> {
  try {
    const r = await fetch("https://users.roblox.com/v1/users/authenticated", {
      headers: { ...ROBLOX_UA, Cookie: `.ROBLOSECURITY=${cookie}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return null;
    return r.json().catch(() => null);
  } catch { return null; }
}

async function currency(cookie: string): Promise<number | null> {
  try {
    const r = await fetch("https://economy.roblox.com/v1/user/currency", {
      headers: { ...ROBLOX_UA, Cookie: `.ROBLOSECURITY=${cookie}` },
      signal: AbortSignal.timeout(8_000),
    });
    if (!r.ok) return null;
    const d = await r.json().catch(() => null);
    return d?.robux ?? null;
  } catch { return null; }
}

async function productInfo(gpId: string): Promise<any | null> {
  const urls = [
    `https://apis.roblox.com/game-passes/v1/game-passes/${gpId}/product-info`,
    `https://apis.roproxy.com/game-passes/v1/game-passes/${gpId}/product-info`,
  ];
  for (const url of urls) {
    try {
      const r = await fetch(url, { headers: ROBLOX_UA, signal: AbortSignal.timeout(8_000) });
      if (r.ok) return await r.json();
    } catch { /* try next */ }
  }
  return null;
}

async function getCsrf(cookie: string): Promise<string | null> {
  const r = await fetch("https://auth.roblox.com/v2/logout", {
    method: "POST",
    headers: { Cookie: `.ROBLOSECURITY=${cookie}` },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  return r?.headers.get("x-csrf-token") ?? null;
}

/**
 * SPIKE — change a gamepass price. Roblox has moved this endpoint over the
 * years, so we try the modern game-passes API first, then fall back to the
 * legacy web endpoint. Whichever returns 2xx wins. VERIFY against a live
 * gamepass once drainCookie is set, then prune the losing branch.
 */
async function setGamepassPrice(
  cookie: string, csrf: string, gpId: string, price: number, info: any,
): Promise<{ ok: boolean; via: string; detail: string }> {
  const name = info?.Name ?? "Gamepass";
  const description = info?.Description ?? "";

  // Attempt A — modern game-passes API
  let aStatus = 0, aBody = "";
  try {
    const rA = await fetch(`https://apis.roblox.com/game-passes/v1/game-passes/${gpId}/details`, {
      method: "POST",
      headers: {
        Cookie: `.ROBLOSECURITY=${cookie}`,
        "Content-Type": "application/json",
        "x-csrf-token": csrf,
      },
      body: JSON.stringify({ name, description, price, isForSale: true }),
      signal: AbortSignal.timeout(12_000),
    });
    aStatus = rA.status;
    aBody = (await rA.text().catch(() => "")).slice(0, 200);
    if (rA.ok) return { ok: true, via: "apis/details", detail: `${aStatus}` };
  } catch (e: any) {
    aBody = String(e?.message ?? e).slice(0, 120);
  }

  // Attempt B — legacy web endpoint (form-encoded)
  let bStatus = 0, bBody = "";
  try {
    const params = new URLSearchParams({
      id: gpId, name, description,
      price: String(price), isForSale: "true", sellForRobux: "true",
    });
    const rB = await fetch("https://www.roblox.com/game-pass/update", {
      method: "POST",
      headers: {
        Cookie: `.ROBLOSECURITY=${cookie}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "X-CSRF-TOKEN": csrf,
      },
      body: params.toString(),
      signal: AbortSignal.timeout(12_000),
    });
    bStatus = rB.status;
    bBody = (await rB.text().catch(() => "")).slice(0, 200);
    if (rB.ok) return { ok: true, via: "web/update", detail: `${bStatus}` };
  } catch (e: any) {
    bBody = String(e?.message ?? e).slice(0, 120);
  }

  return { ok: false, via: "none", detail: `A[${aStatus}]:${aBody} B[${bStatus}]:${bBody}` };
}

// ── GET — drain account + donor balance + gamepass snapshot ─────────────────
export async function GET(req: NextRequest) {
  if (!await extractTwaUser(req))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const s = await (prisma as any).globalSettings.findUnique({ where: { id: "global" } });

  const drainCookie = s?.drainCookie as string | undefined;
  const donorCookie = s?.robloxCookie as string | undefined;
  const gpId = s?.drainGamepassId as string | undefined;

  const [drainUser, drainBal, donorBal, gpInfo] = await Promise.all([
    drainCookie ? authed(drainCookie) : Promise.resolve(null),
    drainCookie ? currency(drainCookie) : Promise.resolve(null),
    donorCookie ? currency(donorCookie) : Promise.resolve(null),
    gpId ? productInfo(gpId) : Promise.resolve(null),
  ]);

  return NextResponse.json({
    drain: {
      hasCookie: !!drainCookie,
      cookieValid: drainCookie ? !!drainUser?.id : null,
      cookieUpdatedAt: s?.drainCookieUpdatedAt ?? null,
      accountName: drainUser?.name ?? drainUser?.displayName ?? s?.drainAccountName ?? null,
      accountId: drainUser?.id ?? null,
      balance: drainBal,
    },
    donor: {
      hasCookie: !!donorCookie,
      accountName: s?.robloxAccountName ?? null,
      balance: donorBal,
    },
    gamepass: gpInfo?.ProductId ? {
      gamepassId: Number(gpId),
      productId: gpInfo.ProductId,
      name: gpInfo.Name ?? "Gamepass",
      price: gpInfo.PriceInRobux ?? 0,
      isForSale: gpInfo.IsForSale ?? false,
      sellerName: gpInfo.Creator?.Name ?? null,
      sellerId: gpInfo.Creator?.Id ?? gpInfo.Creator?.CreatorTargetId ?? null,
    } : (gpId ? { gamepassId: Number(gpId), error: "product-info недоступен" } : null),
  });
}

// ── POST — set-cookie / set-gamepass / drain ────────────────────────────────
export async function POST(req: NextRequest) {
  if (!await extractTwaUser(req))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body?.action)
    return NextResponse.json({ error: "action required" }, { status: 400 });

  try {
  // ── Save drain-account cookie ─────────────────────────────────────────────
  if (body.action === "set-cookie") {
    const raw = String(body.cookie ?? "").trim();
    if (!raw || raw.length < 50)
      return NextResponse.json({ error: "Невалидный cookie" }, { status: 400 });

    const user = await authed(raw);
    if (!user?.id)
      return NextResponse.json({ error: "Cookie невалиден или истёк" }, { status: 400 });

    const accountName = user.name ?? user.displayName ?? "Unknown";
    await (prisma as any).globalSettings.upsert({
      where: { id: "global" },
      create: { id: "global", usdToRub: 90, drainCookie: raw, drainCookieUpdatedAt: new Date(), drainAccountName: accountName },
      update: { drainCookie: raw, drainCookieUpdatedAt: new Date(), drainAccountName: accountName },
    });
    const balance = await currency(raw);
    return NextResponse.json({ ok: true, accountName, accountId: user.id, balance });
  }

  // ── Set which gamepass on the drain account we reprice ─────────────────────
  if (body.action === "set-gamepass") {
    const raw = String(body.gamepassId ?? "").trim();
    const m = raw.match(/(\d+)/);
    if (!m) return NextResponse.json({ error: "Невалидный ID геймпасса" }, { status: 400 });
    const gpId = m[1];

    const info = await productInfo(gpId);
    if (!info?.ProductId)
      return NextResponse.json({ error: "Геймпасс не найден" }, { status: 404 });

    await (prisma as any).globalSettings.upsert({
      where: { id: "global" },
      create: { id: "global", usdToRub: 90, drainGamepassId: gpId },
      update: { drainGamepassId: gpId },
    });

    return NextResponse.json({
      ok: true,
      gamepassId: Number(gpId),
      productId: info.ProductId,
      name: info.Name ?? "Gamepass",
      price: info.PriceInRobux ?? 0,
      isForSale: info.IsForSale ?? false,
      sellerName: info.Creator?.Name ?? null,
    });
  }

  // ── Execute the drain ──────────────────────────────────────────────────────
  if (body.action === "drain") {
    const s = await (prisma as any).globalSettings.findUnique({ where: { id: "global" } });
    const donorCookie = s?.robloxCookie as string | undefined;
    const drainCookie = s?.drainCookie as string | undefined;
    const gpId = s?.drainGamepassId as string | undefined;

    if (!donorCookie) return NextResponse.json({ error: "Cookie донора не задан" }, { status: 400 });
    if (!drainCookie) return NextResponse.json({ error: "Cookie аккаунта-приёмника не задан" }, { status: 400 });
    if (!gpId) return NextResponse.json({ error: "Геймпасс для слива не задан" }, { status: 400 });

    // 1. Donor balance = drain target
    const target = await currency(donorCookie);
    if (target === null) return NextResponse.json({ error: "Не удалось прочитать баланс донора — cookie протух?" }, { status: 502 });
    if (target < 1) return NextResponse.json({ ok: true, success: false, msg: "Нечего сливать (баланс донора 0)" });

    // 2. Resolve the drain gamepass (productId + sellerId = drain account)
    const info = await productInfo(gpId);
    if (!info?.ProductId) return NextResponse.json({ error: "product-info геймпасса недоступен" }, { status: 502 });
    const productId = info.ProductId as number;
    const sellerId = info.Creator?.Id ?? info.Creator?.CreatorTargetId ?? 0;
    if (!sellerId) return NextResponse.json({ error: "Не удалось определить продавца геймпасса" }, { status: 502 });

    // 3. Change the price on the drain account to `target`
    const drainCsrf = await getCsrf(drainCookie);
    if (!drainCsrf) return NextResponse.json({ error: "CSRF приёмника не получен — cookie протух?" }, { status: 502 });

    const priceRes = await setGamepassPrice(drainCookie, drainCsrf, gpId, target, info);
    if (!priceRes.ok)
      return NextResponse.json({ ok: true, success: false, msg: `Не удалось сменить цену геймпасса (${priceRes.detail})` });

    // 4. Wait until Roblox reflects the new price (propagation delay)
    let priced = false;
    for (let i = 0; i < 12; i++) {
      await new Promise(r => setTimeout(r, 1200));
      const chk = await productInfo(gpId);
      if ((chk?.PriceInRobux ?? -1) === target && chk?.IsForSale) { priced = true; break; }
    }
    if (!priced)
      return NextResponse.json({ ok: true, success: false, msg: `Цена сменена (via ${priceRes.via}), но не подтвердилась за ~15с. Повтори слив.` });

    // 5. Donor buys the drain gamepass
    let donorCsrf = await getCsrf(donorCookie);
    if (!donorCsrf) return NextResponse.json({ error: "CSRF донора не получен — cookie протух?" }, { status: 502 });

    let purchaseRes: Response | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      purchaseRes = await fetch(`https://economy.roblox.com/v1/purchases/products/${productId}`, {
        method: "POST",
        headers: {
          Cookie: `.ROBLOSECURITY=${donorCookie}`,
          "Content-Type": "application/json",
          "x-csrf-token": donorCsrf!,
        },
        body: JSON.stringify({ expectedCurrency: 1, expectedPrice: target, expectedSellerId: sellerId }),
        signal: AbortSignal.timeout(15_000),
      }).catch(() => null);
      if (purchaseRes?.status === 403) {
        const newCsrf = purchaseRes.headers.get("x-csrf-token");
        if (newCsrf && attempt === 0) { donorCsrf = newCsrf; continue; }
      }
      break;
    }

    if (purchaseRes?.status === 401)
      return NextResponse.json({ ok: true, success: false, msg: "Cookie донора истёк — обнови" });

    const pData: any = await purchaseRes?.json().catch(() => null);
    const [donorAfter, drainAfter] = await Promise.all([currency(donorCookie), currency(drainCookie)]);

    if (pData?.purchased) {
      return NextResponse.json({
        ok: true, success: true,
        drained: pData.price ?? target,
        via: priceRes.via,
        donorBalanceAfter: donorAfter,
        drainBalanceAfter: drainAfter,
        msg: `Слито ${pData.price ?? target} R$ → ${s?.drainAccountName ?? "приёмник"}`,
      });
    }

    const reason = pData?.reason ?? pData?.errorMsg ?? "Неизвестная ошибка";
    return NextResponse.json({ ok: true, success: false, msg: `Покупка не прошла: ${reason}`, donorBalanceAfter: donorAfter, drainBalanceAfter: drainAfter });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json(
      { error: `Ошибка сервера: ${String(e?.message ?? e).slice(0, 200)}` },
      { status: 500 },
    );
  }
}
