import { NextRequest, NextResponse } from "next/server";
import { extractTwaUser } from "@/lib/twa-auth";
import { prisma } from "@/lib/prisma";
import { needsOwnershipCheck, verifyOwnershipAfterFailure } from "@/lib/roblox-buyout";
import { checkGamepassPrice, expectedGamepassPrice } from "@/lib/purchase-guard";

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
    for (const url of infoUrls) {
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
    const { productId, price, sellerId } = body;
    if (!productId || !price || !sellerId)
      return NextResponse.json({ error: "productId, price, sellerId required" }, { status: 400 });

    // П5 (PLAN «+7»): покупка за реальные робуксы по геймпассу неоплаченного
    // прямого заказа запрещена — этот роут раньше не проверял статус вовсе.
    const gpIdRaw = String(body.gamepassId ?? "").match(/(\d+)/)?.[1];
    if (gpIdRaw) {
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

      // ЦЕНА-СТОП (PLAN-gp-price-guard Ш3): пасс привязан к активному заказу ⇒
      // цена покупки обязана совпадать с ожидаемой по номиналу этого заказа.
      // price приходит из body (live-цена с экрана) — Roblox сверит её сам,
      // а занижать её для обхода гарда бессмысленно: покупка тогда не пройдёт.
      const linkedCandidates = await (prisma as any).wbOrder.findMany({
        where: {
          isTest: false,
          status: { in: ["AWAITING_GAMEPASS", "PENDING", "IN_PROGRESS", "ERROR", "AWAITING_PAYMENT", "PAYMENT_PENDING"] },
          gamepassUrl: { contains: `/${gpIdRaw}` },
        },
        select: { wbCode: true, amount: true, gamepassUrl: true },
      });
      const linked = linkedCandidates.find(
        (o: any) => (o.gamepassUrl ?? "").match(/game-pass(?:es)?\/(\d+)/)?.[1] === gpIdRaw,
      );
      if (linked) {
        const { ok: priceOk, expected } = checkGamepassPrice(linked.amount, Number(price));
        if (!priceOk)
          return NextResponse.json(
            { error: `⛔ Пасс привязан к заказу ${linked.wbCode}: цена ${price} R$ ≠ ожидаемой ${expected} R$ (номинал ${linked.amount}). Выкуп заблокирован — нужен пасс ровно за ${expected} R$.` },
            { status: 409 },
          );
      }
    }

    const cookie = await getCookie();
    if (!cookie) return NextResponse.json({ error: "Cookie не задан" }, { status: 400 });

    const csrfRes = await fetch("https://auth.roblox.com/v2/logout", {
      method: "POST",
      headers: { Cookie: `.ROBLOSECURITY=${cookie}` },
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    let csrf = csrfRes?.headers.get("x-csrf-token");
    if (!csrf)
      return NextResponse.json({ error: "Не удалось получить CSRF — cookie протух?" }, { status: 502 });

    let purchaseRes: Response | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      purchaseRes = await fetch(
        `https://economy.roblox.com/v1/purchases/products/${productId}`,
        {
          method: "POST",
          headers: {
            Cookie: `.ROBLOSECURITY=${cookie}`,
            "Content-Type": "application/json",
            "x-csrf-token": csrf,
          },
          body: JSON.stringify({
            expectedCurrency: 1,
            expectedPrice: price,
            expectedSellerId: sellerId,
          }),
          signal: AbortSignal.timeout(15_000),
        },
      ).catch(() => null);

      if (purchaseRes?.status === 403) {
        const newCsrf = purchaseRes.headers.get("x-csrf-token");
        if (newCsrf && attempt === 0) { csrf = newCsrf; continue; }
      }
      break;
    }

    if (purchaseRes?.status === 401)
      return NextResponse.json({ ok: true, success: false, msg: "Cookie истёк — обнови" });

    const purchaseData: any = await purchaseRes?.json().catch(() => null);

    // Ф1: провал/«Нет ответа» не значит «не куплено» — Roblox при таймауте/5xx
    // нередко проводит транзакцию. gamepassId клиент шлёт всегда (guard П5).
    const isAlreadyOwned = /already.?own/i.test(purchaseData?.reason ?? "");
    let purchased = Boolean(purchaseData?.purchased) || isAlreadyOwned;
    let recovered = false;
    const canonicalReason: string | null = purchaseData?.reason ?? purchaseData?.errorMsg ?? null;
    if (!purchased && gpIdRaw && needsOwnershipCheck(canonicalReason)) {
      const owned = await verifyOwnershipAfterFailure(cookie, gpIdRaw, canonicalReason !== null);
      if (owned === true) {
        purchased = true;
        recovered = true;
        console.warn(`[twa/roblox-account] recovered: gamepass ${gpIdRaw} — владение подтверждено после ошибки «${canonicalReason ?? "нет ответа"}»`);
      }
    }

    if (!purchaseData && !recovered)
      return NextResponse.json({ error: "Нет ответа от Roblox" }, { status: 502 });

    // Fetch updated balance
    let balance: number | null = null;
    try {
      const bRes = await fetch("https://economy.roblox.com/v1/user/currency", {
        headers: { ...ROBLOX_UA, Cookie: `.ROBLOSECURITY=${cookie}` },
        signal: AbortSignal.timeout(5_000),
      });
      if (bRes.ok) {
        const bData = await bRes.json().catch(() => null);
        balance = bData?.robux ?? null;
      }
    } catch { /* ok */ }

    if (purchased) {
      return NextResponse.json({
        ok: true, success: true,
        msg: isAlreadyOwned
          ? `Куплено (AlreadyOwned — предыдущая покупка прошла)`
          : recovered
            ? `Куплено (владение подтверждено проверкой после ошибки: ${canonicalReason ?? "нет ответа от Roblox"})`
            : `Куплено за ${purchaseData.price ?? price} R$`,
        price: purchaseData?.price ?? price,
        balance,
        alreadyOwned: isAlreadyOwned,
      });
    }

    const reason = canonicalReason ?? "Неизвестная ошибка";
    return NextResponse.json({ ok: true, success: false, msg: reason, balance });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
