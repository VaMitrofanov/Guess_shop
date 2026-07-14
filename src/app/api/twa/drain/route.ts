import { NextRequest, NextResponse } from "next/server";
import { extractTwaUser } from "@/lib/twa-auth";
import { prisma } from "@/lib/prisma";
import { needsOwnershipCheck } from "@/lib/roblox-buyout";

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

/** List the drain account's own gamepasses (for the picker in TWA — avoids
 *  pasting IDs and picking a gamepass the account doesn't own). */
async function userGamepasses(userId: number, cookie: string): Promise<any[]> {
  try {
    const r = await fetch(`https://apis.roblox.com/game-passes/v1/users/${userId}/game-passes?count=50`, {
      headers: { ...ROBLOX_UA, Cookie: `.ROBLOSECURITY=${cookie}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return [];
    const d = await r.json().catch(() => null);
    return Array.isArray(d?.gamePasses) ? d.gamePasses : [];
  } catch { return []; }
}

/** Владеет ли юзер геймпассом (зеркало bots/shared/drain.ts ownsGamepass).
 *  null = проверка не удалась — трактовать консервативно. */
async function ownsGamepass(userId: number, gpId: string): Promise<boolean | null> {
  try {
    const r = await fetch(`https://inventory.roblox.com/v1/users/${userId}/items/GamePass/${gpId}`, {
      headers: ROBLOX_UA, signal: AbortSignal.timeout(8_000),
    });
    if (!r.ok) return null;
    const d: any = await r.json().catch(() => null);
    return Array.isArray(d?.data) ? d.data.length > 0 : null;
  } catch { return null; }
}

async function getCsrf(cookie: string): Promise<string | null> {
  const r = await fetch("https://auth.roblox.com/v2/logout", {
    method: "POST",
    headers: { Cookie: `.ROBLOSECURITY=${cookie}` },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  return r?.headers.get("x-csrf-token") ?? null;
}

/** Resolve the universe a gamepass belongs to (needed for the price-change endpoint).
 *  gamepass → placeId (GET .../game-passes/{id}/details) → universeId. */
async function resolveUniverse(cookie: string, gpId: string): Promise<number | null> {
  let placeId: number | undefined;
  try {
    const r = await fetch(`https://apis.roblox.com/game-passes/v1/game-passes/${gpId}/details`, {
      headers: { ...ROBLOX_UA, Cookie: `.ROBLOSECURITY=${cookie}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (r.ok) placeId = (await r.json())?.placeId;
  } catch { /* fall through */ }
  if (!placeId) return null;

  try {
    const r = await fetch(`https://apis.roblox.com/universes/v1/places/${placeId}/universe`, {
      headers: ROBLOX_UA, signal: AbortSignal.timeout(10_000),
    });
    if (r.ok) return (await r.json())?.universeId ?? null;
  } catch { /* fall through */ }
  return null;
}

/**
 * Change a gamepass price. VERIFIED live 2026-07-03 against a real gamepass:
 *   PATCH apis.roblox.com/game-passes/v1/universes/{universeId}/game-passes/{gpId}
 *   multipart/form-data, capitalized fields `IsForSale` + `Price`, X-CSRF-TOKEN header → 204.
 * Gotchas learned the hard way:
 *   • The write is universe-scoped — you must resolve universeId first.
 *   • It MUST be multipart/form-data. JSON / merge-patch / json-patch all → 415.
 *   • Do NOT set Content-Type manually; fetch derives the multipart boundary.
 *   • The old POST .../game-passes/{id}/details path is dead (GET-only now → 404 on write).
 */
async function setGamepassPrice(
  cookie: string, csrf: string, gpId: string, price: number,
): Promise<{ ok: boolean; via: string; detail: string }> {
  const universeId = await resolveUniverse(cookie, gpId);
  if (!universeId) return { ok: false, via: "none", detail: "universeId геймпасса не получен" };

  const fd = new FormData();
  fd.append("IsForSale", String(price > 0));
  fd.append("Price", String(Math.floor(price)));

  let status = 0, body = "";
  try {
    const r = await fetch(`https://apis.roblox.com/game-passes/v1/universes/${universeId}/game-passes/${gpId}`, {
      method: "PATCH",
      headers: { Cookie: `.ROBLOSECURITY=${cookie}`, "X-CSRF-TOKEN": csrf },
      body: fd,
      signal: AbortSignal.timeout(12_000),
    });
    status = r.status;
    body = (await r.text().catch(() => "")).slice(0, 200);
    if (r.ok) return { ok: true, via: "universes-patch", detail: `${status}` };
  } catch (e: any) {
    body = String(e?.message ?? e).slice(0, 120);
  }

  return { ok: false, via: "none", detail: `[${status}] ${body}` };
}

// ── GET — drain account + donor balance + gamepass snapshot ─────────────────
export async function GET(req: NextRequest) {
  if (!await extractTwaUser(req))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Лёгкий режим ?events=1 — только история сливов (для «Истории покупок»),
  // без походов в Roblox.
  if (new URL(req.url).searchParams.get("events")) {
    const events = await (prisma as any).drainEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
    }).catch(() => []);
    return NextResponse.json({ events });
  }

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

  // The drain account's own gamepasses — for the picker in the config UI.
  const drainGps = (drainCookie && drainUser?.id)
    ? await userGamepasses(drainUser.id, drainCookie)
    : [];

  return NextResponse.json({
    gamepasses: drainGps.map((g: any) => ({
      gamepassId: g.gamePassId,
      name: g.name ?? "Gamepass",
      price: g.price ?? null,
      isForSale: g.isForSale ?? false,
    })),
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

    // 2.5 (Ф1) Донор уже владеет пассом → Roblox не даст купить повторно
    // («один пасс = один слив на донора»). Раньше это выяснялось только после
    // смены цены; заодно фиксируем донора для post-fail проверки владения.
    const donorUser = await authed(donorCookie);
    if (donorUser?.id) {
      const preOwned = await ownsGamepass(donorUser.id, gpId);
      if (preOwned === true)
        return NextResponse.json({ ok: true, success: false, msg: "Донор уже владеет этим геймпассом (прошлый слив) — выбери другой пасс приёмника" });
    }

    // 3. Change the price on the drain account to `target`
    const drainCsrf = await getCsrf(drainCookie);
    if (!drainCsrf) return NextResponse.json({ error: "CSRF приёмника не получен — cookie протух?" }, { status: 502 });

    const priceRes = await setGamepassPrice(drainCookie, drainCsrf, gpId, target);
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
    let [donorAfter, drainAfter] = await Promise.all([currency(donorCookie), currency(drainCookie)]);

    // Ф1: провал/таймаут не значит «не куплено» — Roblox мог провести покупку.
    // Пре-чек 2.5 гарантирует, что владение появилось именно этой попыткой.
    let recovered = false;
    let recoveredMsg = "";
    if (!pData?.purchased && donorUser?.id) {
      const reason: string | null = pData ? (pData.reason ?? pData.errorMsg ?? "Неизвестная ошибка") : null;
      if (!(reason && /already.?own/i.test(reason)) && needsOwnershipCheck(reason)) {
        await new Promise(r => setTimeout(r, 2_500));
        let owned = await ownsGamepass(donorUser.id, gpId);
        if (owned !== true && (owned === null || reason === null)) {
          await new Promise(r => setTimeout(r, 5_000));
          owned = await ownsGamepass(donorUser.id, gpId);
        }
        if (owned === true) {
          recovered = true;
          recoveredMsg = ` (владение подтверждено проверкой после ошибки: ${reason ?? "нет ответа"})`;
          console.warn(`[twa/drain] recovered: пасс ${gpId} — владение донором подтверждено после ошибки «${reason ?? "нет ответа"}»`);
          [donorAfter, drainAfter] = await Promise.all([currency(donorCookie), currency(drainCookie)]);
        }
      }
    }

    if (pData?.purchased || recovered) {
      // Учёт в истории (PLAN +5.G.2): раньше успешный слив нигде не записывался.
      await (prisma as any).drainEvent.create({
        data: {
          donorName: s?.robloxAccountName ?? null,
          drainName: s?.drainAccountName ?? null,
          amount: pData?.price ?? target,
          gamepassId: gpId,
          source: "manual",
        },
      }).catch((e: any) => console.warn("[drain] DrainEvent write failed:", e?.message ?? e));
      // П7: слив состоялся — сброс дедупа алерта «💧 пора сливать» у автовыкупа,
      // чтобы после пополнения донора цикл начался чисто.
      await (prisma as any).globalSettings.update({
        where: { id: "global" }, data: { autoBuyoutBelowSince: null },
      }).catch((e: any) => console.warn("[drain] belowSince reset failed:", e?.message ?? e));
      return NextResponse.json({
        ok: true, success: true,
        drained: pData?.price ?? target,
        via: priceRes.via,
        donorBalanceAfter: donorAfter,
        drainBalanceAfter: drainAfter,
        msg: `Слито ${pData?.price ?? target} R$ → ${s?.drainAccountName ?? "приёмник"}${recoveredMsg}`,
      });
    }

    const reason = pData ? (pData.reason ?? pData.errorMsg ?? "Неизвестная ошибка") : "Нет ответа от Roblox";
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
