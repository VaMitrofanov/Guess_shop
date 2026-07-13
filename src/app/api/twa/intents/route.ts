import { NextRequest, NextResponse } from "next/server";
import { extractTwaUser } from "@/lib/twa-auth";
import { prisma } from "@/lib/prisma";
import {
  generateDirectCode,
  getSbpQrBuffer,
  INTENT_TTL_MS,
  notifyIntentRejected,
  sendPaymentDetailsToUser,
  sendSbpQrToUser,
  sbpQrUrl,
} from "@/lib/twa-direct";

/**
 * Заявки прямых заказов (DirectIntent, «⏳ Ожидаем реквизиты») в TWA.
 *
 * Раньше заявки жили только в TG-карточках админов («🔷 ЗАЯВКА · ник · сумма»);
 * этот роут даёт им поверхность в дашборде — те же три действия, что кнопки
 * TG-карточки, с теми же переходами и текстами клиенту:
 *   send-qr      = sqi: (создать заказ PAYMENT_PENDING + прислать СБП-QR)
 *   send-details = spi: + текст реквизитов сразу (в TG менеджер вводит после)
 *   reject       = cai: (CANCELLED + уведомление клиенту)
 *
 * Заявки старше 24ч автоматически помечаются EXPIRED (как в TG-хендлерах).
 */

async function expireStale(): Promise<void> {
  await (prisma as any).directIntent.updateMany({
    where: { status: "PENDING", createdAt: { lt: new Date(Date.now() - INTENT_TTL_MS) } },
    data: { status: "EXPIRED" },
  }).catch(() => {});
}

export async function GET(req: NextRequest) {
  if (!await extractTwaUser(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await expireStale();
  const intents = await (prisma as any).directIntent.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    include: { user: { select: { id: true, tgId: true, vkId: true, name: true, username: true } } },
  });

  // «Повторный клиент» — как в TG-карточке заявки: число прошлых заказов юзера.
  const userIds = [...new Set(intents.map((i: any) => i.userId as string))];
  const prevRows = userIds.length > 0
    ? await (prisma as any).wbOrder.groupBy({
        by: ["userId"],
        where: { userId: { in: userIds }, isTest: false, status: { notIn: ["AWAITING_GAMEPASS"] } },
        _count: { _all: true },
      })
    : [];
  const prevByUser = new Map<string, number>(prevRows.map((r: any) => [r.userId, r._count._all]));

  const qrConfigured = !!(await getSbpQrBuffer());

  return NextResponse.json({
    intents: intents.map((i: any) => ({
      id: i.id,
      amount: i.amount,
      bonus: i.bonus,
      totalAmount: i.totalAmount,
      rublePrice: i.rublePrice,
      robloxUsername: i.robloxUsername,
      gamepassId: i.gamepassId,
      gamepassUrl: i.gamepassUrl,
      platform: i.platform,
      createdAt: i.createdAt,
      prevOrders: prevByUser.get(i.userId) ?? 0,
      user: i.user,
    })),
    qrConfigured,
  });
}

export async function POST(req: NextRequest) {
  if (!await extractTwaUser(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const action = body?.action as string | undefined;
  const intentId = body?.intentId as string | undefined;
  if (!action || !intentId)
    return NextResponse.json({ error: "action и intentId обязательны" }, { status: 400 });

  const intent = await (prisma as any).directIntent.findUnique({
    where: { id: intentId },
    include: { user: true },
  });
  if (!intent) return NextResponse.json({ error: "Заявка не найдена" }, { status: 404 });
  if (intent.status !== "PENDING")
    return NextResponse.json({ error: "Заявка уже обработана" }, { status: 409 });
  if (Date.now() - new Date(intent.createdAt).getTime() > INTENT_TTL_MS) {
    await (prisma as any).directIntent.update({ where: { id: intentId }, data: { status: "EXPIRED" } });
    return NextResponse.json({ error: "Заявка просрочена (>24ч)" }, { status: 410 });
  }

  if (action === "reject") {
    await (prisma as any).directIntent.update({ where: { id: intentId }, data: { status: "CANCELLED" } });
    const notified = await notifyIntentRejected(intent.user);
    return NextResponse.json({ ok: true, notified });
  }

  if (action !== "send-qr" && action !== "send-details")
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });

  const details = action === "send-details" ? String(body?.details ?? "").trim() : "";
  if (action === "send-details" && !details)
    return NextResponse.json({ error: "Текст реквизитов обязателен" }, { status: 400 });
  if (action === "send-qr" && !(await getSbpQrBuffer()))
    return NextResponse.json({ error: "QR не настроен (GlobalSettings.sbpQrBase64)" }, { status: 400 });

  // Транзакция = TG sqi:/spi:. Заказ сразу PAYMENT_PENDING: реквизиты/QR
  // уходят этим же запросом, промежуточный AWAITING_PAYMENT (TG ждёт ввода
  // текста админом) здесь не нужен.
  const dirCode = generateDirectCode();
  let newOrder: any;
  try {
    newOrder = await (prisma as any).$transaction(async (tx: any) => {
      const ord = await tx.wbOrder.create({
        data: {
          amount:         intent.totalAmount,
          gamepassUrl:    intent.gamepassUrl,
          robloxUsername: intent.robloxUsername,
          status:         "PAYMENT_PENDING",
          platform:       intent.platform,
          userId:         intent.userId,
          wbCode:         dirCode,
          isDirectOrder:  true,
          orderSource:    "DIRECT",
          saleAmountKopecks: intent.rublePrice * 100,
          paymentDetails: action === "send-qr" ? "СБП QR" : details.slice(0, 2000),
        },
      });
      await tx.directIntent.update({ where: { id: intentId }, data: { status: "CONSUMED" } });
      const updateData: any = {};
      if (intent.bonus > 0) {
        updateData.balance = 0;
        updateData.reviewBonusGrantedAt = null;
        updateData.bonusExpiresAt = null;
        updateData.reviewReminderLevel = 0;
      }
      if (intent.user.rubleDiscount > 0) updateData.rubleDiscount = 0;
      if (Object.keys(updateData).length > 0) {
        await tx.user.update({ where: { id: intent.userId }, data: updateData });
      }
      return ord;
    });
  } catch (e: any) {
    console.error("[twa-intents] consume error:", e?.message);
    return NextResponse.json({ error: "Ошибка создания заказа" }, { status: 500 });
  }

  const notified = action === "send-qr"
    ? await sendSbpQrToUser(intent.user, intent.totalAmount, intent.rublePrice)
    : await sendPaymentDetailsToUser(intent.user, intent.totalAmount, details);

  if (!notified) console.warn("[twa-intents] delivery failed:", dirCode, "qrUrl:", sbpQrUrl());

  return NextResponse.json({ ok: true, code: dirCode, orderId: newOrder.id, notified });
}
