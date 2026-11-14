import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { buildBasket, type BasketRow } from "@/lib/wb-basket";

/**
 * Корзина по коду заказа (01.11.2026): соседние заказы той же покупки WB.
 *
 * Страница инструкции зовёт это после оформления заказа, чтобы предложить
 * следующий одной кнопкой. Код соседа отдаётся только тому, кто знает код
 * этого заказа И уже оформил его (заказ создан) — то есть самому покупателю.
 * Ответ на чужой/неоформленный код — пустой список, как и на одиночный заказ:
 * роут не оракул кодов.
 */
export async function GET(request: Request) {
  const ip = clientIp(request);
  if (!rateLimit(`wb-basket:${ip}`, 10, 1 / 30).ok) return NextResponse.json({ items: [] });

  const code = new URL(request.url).searchParams.get("code")?.trim().toUpperCase() ?? "";
  if (!/^[A-Z0-9]{7}$/.test(code)) return NextResponse.json({ items: [] });

  try {
    const own = await prisma.wbOrder.findFirst({
      where: { wbCode: code, isTest: false },
      select: { robloxUsername: true },
    });
    if (!own) return NextResponse.json({ items: [] });
    const self = await prisma.wbMarketplaceOrder.findFirst({
      where: { wbCode: { code }, isTest: false },
      select: { orderUid: true },
    });
    if (!self?.orderUid) return NextResponse.json({ items: [] });

    const rows = await prisma.$queryRaw<Array<BasketRow>>`
      SELECT m."wbOrderId", m."denominationSnapshot" AS "amount", (m."cancelledAt" IS NOT NULL) AS "cancelled",
             w."code", o."status" AS "orderStatus", o."robloxUsername" AS "nick", o."gamepassId"
        FROM "WbMarketplaceOrder" m
        LEFT JOIN "WbCode" w ON w."id" = m."wbCodeId"
        LEFT JOIN "WbOrder" o ON o."wbCode" = w."code"
       WHERE m."orderUid" = ${self.orderUid} AND m."isTest" = false
       LIMIT 10`;
    return NextResponse.json(
      { items: buildBasket(rows.map((r) => ({ ...r, orderStatus: r.orderStatus ? String(r.orderStatus) : null })), code), nick: own.robloxUsername },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ items: [] });
  }
}
