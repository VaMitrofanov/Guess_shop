import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { BONUS_REASONS, applyBonusDeltaTx, webOrderBonusRevisionRevertKey } from "@/lib/bonus-ledger";

/**
 * Компенсация бонуса и скидки, списанных при создании web-заказа
 * (ultra-review U3, риск №25 в docs/security.md).
 *
 * Бонус и рублёвая скидка списываются в момент создания заказа — до оплаты.
 * Раньше при провале `Init`, отказе банка (`REJECTED`/`CANCELED`) или просто
 * брошенной оплате накопленное клиента не возвращалось никуда и никогда:
 * `balance: { increment }` во всём проекте встречался ровно один раз (бонус за
 * отзыв), а `BonusLedger` писался только с отрицательной дельтой.
 *
 * Функция идемпотентна на двух уровнях: отметка `benefitsRevertedAt` на заказе
 * и уникальный ключ движения в леджере. Это важно, потому что вызывают её три
 * независимых пути — catch-ветка `orders/create`, webhook банка и крон
 * протухших заказов, — и они могут сработать почти одновременно.
 */

export type RevertReason = "PAYMENT_INIT_FAILED" | "BANK_REJECTED" | "ABANDONED";

export type RevertResult =
  | { reverted: true; bonusRobux: number; discountKopecks: number }
  | { reverted: false; reason: "not_found" | "already" | "nothing_to_revert" | "paid" };

const REVERTABLE_STATUSES = ["AWAITING_PAYMENT", "PAYMENT_PENDING", "REJECTED"] as const;

export async function revertWebOrderBenefits(
  orderId: string,
  reason: RevertReason,
  now = new Date(),
): Promise<RevertResult> {
  return prisma.$transaction(async (tx) => {
    const order = await tx.wbOrder.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        userId: true,
        status: true,
        paidAt: true,
        priceQuoteId: true,
        publicOrderId: true,
        bonusAppliedRobux: true,
        discountAppliedKopecks: true,
        benefitsRevertedAt: true,
        benefitsRevision: true,
      },
    });
    if (!order) return { reverted: false, reason: "not_found" as const };
    if (order.benefitsRevertedAt) return { reverted: false, reason: "already" as const };
    // Оплаченный заказ компенсировать нельзя — бонус реально потрачен.
    if (order.paidAt) return { reverted: false, reason: "paid" as const };
    if (!REVERTABLE_STATUSES.includes(order.status as (typeof REVERTABLE_STATUSES)[number])) {
      return { reverted: false, reason: "paid" as const };
    }

    const bonusRobux = order.bonusAppliedRobux ?? 0;
    const discountKopecks = order.discountAppliedKopecks ?? 0;
    if (bonusRobux <= 0 && discountKopecks <= 0) {
      // Отмечаем всё равно — чтобы крон не перебирал заказ бесконечно.
      await tx.wbOrder.update({ where: { id: order.id }, data: { benefitsRevertedAt: now } });
      return { reverted: false, reason: "nothing_to_revert" as const };
    }

    const referenceKey = order.priceQuoteId ?? order.id;

    if (bonusRobux > 0) {
      await applyBonusDeltaTx(tx, {
        userId: order.userId,
        deltaRobux: bonusRobux,
        reason: BONUS_REASONS.WEB_ORDER_REDEMPTION_REVERSED,
        referenceId: referenceKey,
        idempotencyKey: webOrderBonusRevisionRevertKey(referenceKey, order.benefitsRevision),
        metadata: {
          orderId: order.id,
          publicOrderId: order.publicOrderId,
          revertReason: reason,
        } as Prisma.InputJsonValue,
      });
    }

    if (discountKopecks > 0) {
      // Скидка — скаляр на пользователе (не леджер). Возвращаем ровно ту
      // сумму, которая была применена, а не «единственное значение в системе».
      await tx.user.update({
        where: { id: order.userId },
        data: { rubleDiscount: { increment: discountKopecks / 100 } },
      });
    }

    await tx.wbOrder.update({
      where: { id: order.id },
      data: { benefitsRevertedAt: now },
    });

    await tx.orderEvent.create({
      data: {
        orderId: order.id,
        type: "BENEFITS_REVERTED",
        idempotencyKey: `benefits-reverted:${order.id}`,
        payload: { bonusRobux, discountKopecks, reason },
      },
    });

    return { reverted: true, bonusRobux, discountKopecks };
  });
}
