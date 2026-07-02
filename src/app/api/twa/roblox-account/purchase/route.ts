import { NextRequest, NextResponse } from "next/server";
import { extractTwaUser } from "@/lib/twa-auth";
import { prisma } from "@/lib/prisma";

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

export async function POST(req: NextRequest) {
  if (!await extractTwaUser(req))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body?.action)
    return NextResponse.json({ error: "action required" }, { status: 400 });

  // ── Search by username ──────────────────────────────────────────────────
  if (body.action === "search-by-username") {
    const username = String(body.username ?? "").trim();
    if (!username || username.length < 2 || username.length > 20)
      return NextResponse.json({ error: "Невалидный ник" }, { status: 400 });

    const uRes = await fetch("https://users.roblox.com/v1/usernames/users", {
      method: "POST",
      headers: { ...ROBLOX_UA, "Content-Type": "application/json" },
      body: JSON.stringify({ usernames: [username], excludeBannedUsers: true }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    if (!uRes?.ok) return NextResponse.json({ error: "Не удалось найти пользователя" }, { status: 502 });
    const uData = await uRes.json().catch(() => null);
    const userId: number | undefined = uData?.data?.[0]?.id;
    if (!userId) return NextResponse.json({ error: `Пользователь «${username}» не найден` }, { status: 404 });
    const resolvedName: string = uData.data[0].name ?? username;

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

    const gamepasses = forSale.map((gp: any) => ({
      gamepassId: gp.id,
      productId:  gp.productId ?? 0,
      name:       gp.name ?? gp.displayName ?? "Gamepass",
      price:      gp.price ?? 0,
      sellerName: gp.creator?.name ?? resolvedName,
      image:      thumbMap[gp.id] ?? null,
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
    });
  }

  // ── Purchase ────────────────────────────────────────────────────────────
  if (body.action === "purchase") {
    const { productId, price, sellerId } = body;
    if (!productId || !price || !sellerId)
      return NextResponse.json({ error: "productId, price, sellerId required" }, { status: 400 });

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
    if (!purchaseData)
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

    if (purchaseData.purchased) {
      return NextResponse.json({
        ok: true, success: true,
        msg: `Куплено за ${purchaseData.price ?? price} R$`,
        price: purchaseData.price ?? price,
        balance,
      });
    }

    const reason = purchaseData.reason ?? purchaseData.errorMsg ?? "Неизвестная ошибка";
    return NextResponse.json({ ok: true, success: false, msg: reason, balance });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
