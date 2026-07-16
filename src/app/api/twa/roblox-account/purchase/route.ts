import { NextRequest, NextResponse } from "next/server";
import { extractTwaUser } from "@/lib/twa-auth";
import { prisma } from "@/lib/prisma";
import { BuyoutError, purchaseGamepassWithCookie, resolveGamepassForBuyer } from "@/lib/roblox-buyout";
import { BUYOUT_ERROR_REGIONAL_PRICE, checkGamepassPrice, expectedGamepassPrice } from "@/lib/purchase-guard";
import { notifyRetailBuyoutAdmins } from "@/lib/buyout-admin-notify";

const ROBLOX_UA = { "User-Agent": "Roblox/WinInet", Accept: "application/json" };

async function rGet(url: string, timeout = 10_000) {
  const r = await fetch(url, { headers: ROBLOX_UA, signal: AbortSignal.timeout(timeout) });
  if (!r.ok) return null;
  return r.json().catch(() => null);
}

async function getCookie(): Promise<string | null> {
  const s = await (prisma as any).globalSettings.findUnique({ where: { id: "global" } });
  return s?.robloxCookie ?? null;
}

export interface ExistingOrderRef {
  wbCode: string;
  status: string;
  orderSource: string;
  createdAt: Date;
  /** Ожидаемая цена пасса по номиналу заказа — UI-подсказка прайс-гарда (Ш3). */
  expectedPrice: number;
}

/**
 * Дедуп заказов: находит заказы, уже ссылающиеся на эти геймпассы, чтобы поиск
 * подсветил «уже в заказе» и менеджер не создал дубль (Авито и не только).
 * REJECTED не блокирует. Возвращает map gamepassId → последний такой заказ.
 */
async function findExistingOrders(gamepassIds: (string | number)[]): Promise<Record<string, ExistingOrderRef>> {
  const ids = [...new Set(gamepassIds.map(String).filter((s) => /^\d+$/.test(s)))];
  if (ids.length === 0) return {};
  try {
    const orders = await (prisma as any).wbOrder.findMany({
      where: {
        isTest: false,
        status: { notIn: ["REJECTED"] },
        OR: ids.map((id) => ({ gamepassUrl: { contains: `/${id}` } })),
      },
      orderBy: { createdAt: "desc" },
      select: { wbCode: true, status: true, orderSource: true, createdAt: true, gamepassUrl: true, amount: true },
    });
    const map: Record<string, ExistingOrderRef> = {};
    for (const o of orders) {
      // `contains` может зацепить более длинный id — сверяем точным парсингом URL.
      const m = (o.gamepassUrl ?? "").match(/game-pass(?:es)?\/(\d+)/);
      if (!m || !ids.includes(m[1]) || map[m[1]]) continue;
      map[m[1]] = {
        wbCode: o.wbCode, status: o.status, orderSource: o.orderSource, createdAt: o.createdAt,
        expectedPrice: expectedGamepassPrice(o.amount),
      };
    }
    return map;
  } catch {
    return {};
  }
}

export async function POST(req: NextRequest) {
  if (!await extractTwaUser(req))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body?.action)
    return NextResponse.json({ error: "action required" }, { status: 400 });

  // ── Search by username ──────────────────────────────────────────────────
  if (body.action === "search-by-username") {
    // Квикфикс (PLAN +5.J): менеджер вставляет «@nick» или ссылку на профиль
    // roblox.com/users/<id>/profile — раньше Roblox такое не находил.
    const rawInput = String(body.username ?? "").trim();
    const profileMatch = rawInput.match(/roblox\.com\/users\/(\d+)/i);
    const username = rawInput.replace(/^@+/, "");
    if (!profileMatch && (!username || username.length < 2 || username.length > 20))
      return NextResponse.json({ error: "Невалидный ник" }, { status: 400 });

    let userId: number | undefined;
    let resolvedName: string;
    if (profileMatch) {
      userId = Number(profileMatch[1]);
      const pRes = await fetch(`https://users.roblox.com/v1/users/${userId}`, {
        headers: ROBLOX_UA, signal: AbortSignal.timeout(10_000),
      }).catch(() => null);
      const pData = pRes?.ok ? await pRes.json().catch(() => null) : null;
      if (!pData?.name) return NextResponse.json({ error: "Профиль по ссылке не найден" }, { status: 404 });
      resolvedName = pData.name;
    } else {
      const uRes = await fetch("https://users.roblox.com/v1/usernames/users", {
        method: "POST",
        headers: { ...ROBLOX_UA, "Content-Type": "application/json" },
        body: JSON.stringify({ usernames: [username], excludeBannedUsers: true }),
        signal: AbortSignal.timeout(10_000),
      }).catch(() => null);
      if (!uRes?.ok) return NextResponse.json({ error: "Не удалось найти пользователя" }, { status: 502 });
      const uData = await uRes.json().catch(() => null);
      userId = uData?.data?.[0]?.id;
      if (!userId) return NextResponse.json({ error: `Пользователь «${username}» не найден` }, { status: 404 });
      resolvedName = uData.data[0].name ?? username;
    }

    const gRes = await fetch(
      `https://games.roblox.com/v2/users/${userId}/games?accessFilter=Public&limit=10`,
      { headers: ROBLOX_UA, signal: AbortSignal.timeout(10_000) },
    ).catch(() => null);
    if (!gRes?.ok) return NextResponse.json({ error: "Не удалось загрузить игры" }, { status: 502 });
    const gData = await gRes.json().catch(() => null);
    const universes: any[] = gData?.data ?? [];
    if (universes.length === 0)
      return NextResponse.json({ gamepasses: [], username: resolvedName, msg: "Нет публичных игр" });

    const passBatches = await Promise.all(universes.map(async (game: any) => {
      const placeId: number = game.rootPlaceId ?? game.rootPlace?.id ?? 0;
      const pRes = await fetch(
        `https://apis.roblox.com/game-passes/v1/universes/${game.id}/game-passes?passView=Full&pageSize=30`,
        { headers: ROBLOX_UA, signal: AbortSignal.timeout(10_000) },
      ).catch(() => null);
      if (!pRes?.ok) return [];
      const pData = await pRes.json().catch(() => null);
      return (pData?.gamePasses ?? []).map((gp: any) => ({ ...gp, _placeId: placeId }));
    }));

    const all: any[] = passBatches.flat();
    const forSale = all.filter((gp: any) => gp.isForSale === true && (gp.price ?? 0) > 0);

    let thumbMap: Record<number, string> = {};
    if (forSale.length > 0) {
      const ids = forSale.map((gp: any) => gp.id).join(",");
      const tRes = await fetch(
        `https://thumbnails.roblox.com/v1/game-passes?gamePassIds=${ids}&size=150x150&format=Png&isCircular=false`,
        { headers: ROBLOX_UA, signal: AbortSignal.timeout(8_000) },
      ).catch(() => null);
      const tData = tRes?.ok ? await tRes.json().catch(() => null) : null;
      thumbMap = Object.fromEntries((tData?.data ?? []).map((t: any) => [t.targetId, t.imageUrl]));
    }

    const existingMap = await findExistingOrders(forSale.map((gp: any) => gp.id));
    const gamepasses = forSale.map((gp: any) => ({
      gamepassId: gp.id,
      productId:  gp.productId ?? 0,
      name:       gp.name ?? gp.displayName ?? "Gamepass",
      price:      gp.price ?? 0,
      sellerName: gp.creator?.name ?? resolvedName,
      image:      thumbMap[gp.id] ?? null,
      existingOrder: existingMap[String(gp.id)] ?? null,
    }));

    return NextResponse.json({ gamepasses, username: resolvedName });
  }

  // ── Resolve single gamepass by ID/URL ───────────────────────────────────
  if (body.action === "resolve-gamepass") {
    const raw = String(body.gamepassId ?? "").trim();
    const match = raw.match(/(\d+)/);
    if (!match) return NextResponse.json({ error: "Невалидный ID геймпасса" }, { status: 400 });
    const gpId = match[1];

    const infoUrls = [
      `https://apis.roblox.com/game-passes/v1/game-passes/${gpId}/product-info`,
      `https://apis.roproxy.com/game-passes/v1/game-passes/${gpId}/product-info`,
    ];
    let info: any = null;
    const cookie = await getCookie();
    // Prefer the authenticated official response: PriceInRobux is regional to
    // the buyer account, UserBasePriceInRobux is the seller's configured price.
    if (cookie) {
      try {
        const r = await fetch(infoUrls[0], {
          headers: { ...ROBLOX_UA, Cookie: `.ROBLOSECURITY=${cookie}` },
          signal: AbortSignal.timeout(8_000), cache: "no-store",
        });
        if (r.ok) info = await r.json();
      } catch { /* public fallback below */ }
    }
    for (const url of info ? [] : infoUrls) {
      try {
        const r = await fetch(url, { headers: ROBLOX_UA, signal: AbortSignal.timeout(8_000) });
        if (r.ok) { info = await r.json(); break; }
      } catch { /* try next */ }
    }
    if (!info?.ProductId)
      return NextResponse.json({ error: "Геймпасс не найден" }, { status: 404 });

    const price = info.PriceInRobux ?? 0;
    const base = info.UserBasePriceInRobux ?? price;

    let image: string | null = null;
    try {
      const tRes = await fetch(
        `https://thumbnails.roblox.com/v1/game-passes?gamePassIds=${gpId}&size=150x150&format=Png&isCircular=false`,
        { headers: ROBLOX_UA, signal: AbortSignal.timeout(5_000) },
      );
      if (tRes.ok) {
        const tData = await tRes.json().catch(() => null);
        image = tData?.data?.[0]?.imageUrl ?? null;
      }
    } catch { /* ok */ }

    const existingMap = await findExistingOrders([gpId]);
    return NextResponse.json({
      gamepassId:  Number(gpId),
      productId:   info.ProductId,
      name:        info.Name ?? "Gamepass",
      price,
      sellerName:  info.Creator?.Name ?? "Unknown",
      sellerId:    info.Creator?.Id ?? info.Creator?.CreatorTargetId ?? 0,
      isForSale:   info.IsForSale ?? false,
      isManagedPricing: price !== base,
      basePriceInRobux: base,
      image,
      existingOrder: existingMap[gpId] ?? null,
    });
  }

  // ── Purchase ────────────────────────────────────────────────────────────
  if (body.action === "purchase") {
    // П5 (PLAN «+7»): покупка за реальные робуксы по геймпассу неоплаченного
    // прямого заказа запрещена — этот роут раньше не проверял статус вовсе.
    const gpIdRaw = String(body.gamepassId ?? "").match(/(\d+)/)?.[1];
    if (!gpIdRaw)
      return NextResponse.json({ error: "gamepassId required" }, { status: 400 });

    const cookie = await getCookie();
    if (!cookie) return NextResponse.json({ error: "Cookie не задан" }, { status: 400 });

    let buyerInfo;
    try {
      buyerInfo = await resolveGamepassForBuyer(gpIdRaw, cookie);
    } catch (err) {
      const status = err instanceof BuyoutError ? err.status : 502;
      return NextResponse.json({ error: err instanceof Error ? err.message : "Не удалось получить персональную цену Roblox" }, { status });
    }
    if (!buyerInfo.isForSale)
      return NextResponse.json({ error: "Геймпасс не на продаже" }, { status: 409 });

    {
      const candidates = await (prisma as any).wbOrder.findMany({
        where: {
          isTest: false,
          isDirectOrder: true,
          paidAt: null,
          status: { in: ["AWAITING_PAYMENT", "PAYMENT_PENDING", "PENDING", "IN_PROGRESS", "ERROR"] },
          gamepassUrl: { contains: `/${gpIdRaw}` },
        },
        select: { wbCode: true, gamepassUrl: true },
      });
      // `contains` может зацепить более длинный id — сверяем точным парсингом.
      const unpaid = candidates.find(
        (o: any) => (o.gamepassUrl ?? "").match(/game-pass(?:es)?\/(\d+)/)?.[1] === gpIdRaw,
      );
      if (unpaid)
        return NextResponse.json(
          { error: `💳 Геймпасс привязан к неоплаченному прямому заказу ${unpaid.wbCode} — сначала подтверди оплату` },
          { status: 409 },
        );

      // ЦЕНА-СТОП (PLAN-gp-price-guard Ш3): валидируем глобальную цену
      // продавца и отдельно запрещаем buyer-specific regional price. Все
      // значения перечитаны сервером; productId/price/sellerId из body не доверяем.
      const linkedCandidates = await (prisma as any).wbOrder.findMany({
        where: {
          isTest: false,
          status: { in: ["AWAITING_GAMEPASS", "PENDING", "IN_PROGRESS", "ERROR", "AWAITING_PAYMENT", "PAYMENT_PENDING"] },
          gamepassUrl: { contains: `/${gpIdRaw}` },
        },
        select: { id: true, wbCode: true, amount: true, gamepassUrl: true },
      });
      const linked = linkedCandidates.find(
        (o: any) => (o.gamepassUrl ?? "").match(/game-pass(?:es)?\/(\d+)/)?.[1] === gpIdRaw,
      );
      if (linked) {
        const { ok: priceOk, expected } = checkGamepassPrice(
          linked.amount,
          buyerInfo.price,
          buyerInfo.basePriceInRobux,
        );
        if (!priceOk)
          return NextResponse.json(
            { error: `⛔ Пасс привязан к заказу ${linked.wbCode}: базовая цена ${buyerInfo.basePriceInRobux} R$ ≠ ожидаемой ${expected} R$ (номинал ${linked.amount}). Выкуп заблокирован — нужен пасс с базой ${expected} R$.` },
            { status: 409 },
          );
        if (buyerInfo.hasUnsafeBuyerPrice) {
          await (prisma as any).wbOrder.update({
            where: { id: linked.id },
            data: { status: "ERROR", buyoutErrorCode: BUYOUT_ERROR_REGIONAL_PRICE },
          });
          return NextResponse.json(
            { error: `Рег. цена ${buyerInfo.price}/${buyerInfo.basePriceInRobux} R$ — покупка запрещена; запускай выкуп из очереди для автозамены`, failureCode: BUYOUT_ERROR_REGIONAL_PRICE },
            { status: 409 },
          );
        }
      }
      if (!linked && buyerInfo.hasUnsafeBuyerPrice)
        return NextResponse.json(
          { error: `Рег. цена ${buyerInfo.price}/${buyerInfo.basePriceInRobux} R$ — покупка запрещена`, failureCode: BUYOUT_ERROR_REGIONAL_PRICE },
          { status: 409 },
        );
    }

    const productId = buyerInfo.productId;
    const price = buyerInfo.price;
    const sellerId = buyerInfo.sellerId;

    const result = await purchaseGamepassWithCookie(cookie, {
      productId,
      price,
      sellerId,
      gamepassId: gpIdRaw,
    });

    if (result.success) {
      const settings = await (prisma as any).globalSettings.findUnique({
        where: { id: "global" },
        select: { robloxAccountName: true },
      });
      await notifyRetailBuyoutAdmins({
        source: "twa-account",
        gamepassId: gpIdRaw,
        chargedPrice: result.price ?? price,
        donorName: settings?.robloxAccountName ?? null,
        sellerName: buyerInfo.sellerName,
        balance: result.balance,
      }).catch((err) => console.warn("[twa/roblox-account] admin buyout notification failed:", err));
      return NextResponse.json({
        ok: true, success: true,
        msg: result.msg,
        price: result.price ?? price,
        balance: result.balance,
        robloxPlusDiscountPercent: buyerInfo.robloxPlusDiscountPercent,
      });
    }

    return NextResponse.json({ ok: true, success: false, msg: result.msg, balance: result.balance });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
