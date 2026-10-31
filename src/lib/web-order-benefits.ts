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

export type LatePaymentBenefitOrder = {
  id: string;
  userId: string;
  priceQuoteId: string | null;
  publicOrderId: string | null;
  bonusAppliedRobux: number | null;
  discountAppliedKopecks: number | null;
  benefitsRevertedAt: Date | null;
  benefitsRevision: number;
  orderSource: string;
};

export type LatePaymentBenefitResult =
  | { reserved: true; revision: number }
  | { reserved: false; reason: "benefits_changed" };

/**
 * Поздний CONFIRMED может прийти после прежней автоотмены, когда льготы уже
 * вернулись пользователю. Повторное списание бонуса и скидки выполняется одним
 * guarded update внутри той же serializable-транзакции, что и статус платежа.
 * Если льгот уже не хватает, деньги всё равно фиксируются как полученные, но
 * заказ уходит в ERROR для ручной сверки и не попадает в очередь выкупа.
 */
export async function reserveLatePaymentBenefitsTx(
  tx: Prisma.TransactionClient,
  order: LatePaymentBenefitOrder,
  paymentAttemptId: string,
): Promise<LatePaymentBenefitResult> {
  if (!order.benefitsRevertedAt) return { reserved: true, revision: order.benefitsRevision };

  const bonusRobux = order.bonusAppliedRobux ?? 0;
  const discountKopecks = order.discountAppliedKopecks ?? 0;
  const discountRubles = discountKopecks / 100;
  const nextRevision = order.benefitsRevision + 1;

  if (bonusRobux > 0 || discountKopecks > 0) {
    const guarded = await tx.user.updateMany({
      where: {
        id: order.userId,
        ...(bonusRobux > 0 ? { balance: { gte: bonusRobux } } : {}),
        ...(discountKopecks > 0 ? { rubleDiscount: { gte: discountRubles } } : {}),
      },
      data: {
        ...(bonusRobux > 0 ? { balance: { decrement: bonusRobux } } : {}),
        ...(discountKopecks > 0 ? { rubleDiscount: { decrement: discountRubles } } : {}),
      },
    });
    if (guarded.count !== 1) return { reserved: false, reason: "benefits_changed" };
  }

  if (bonusRobux > 0) {
    const after = await tx.user.findUnique({ where: { id: order.userId }, select: { balance: true } });
    await tx.bonusLedger.create({
      data: {
        userId: order.userId,
        deltaRobux: -bonusRobux,
        balanceAfter: after?.balance ?? 0,
        reason: order.orderSource === "DIRECT"
          ? BONUS_REASONS.DIRECT_ORDER_REDEMPTION
          : BONUS_REASONS.WEB_ORDER_REDEMPTION,
        referenceId: order.priceQuoteId ?? order.id,
        idempotencyKey: `web-order-bonus-late-payment:${paymentAttemptId}`,
        metadata: {
          orderId: order.id,
          publicOrderId: order.publicOrderId,
          paymentAttemptId,
          revision: nextRevision,
        } as Prisma.InputJsonValue,
      },
    });
  }

  return { reserved: true, revision: nextRevision };
}

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
        orderSource: true,
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
        reason: order.orderSource === "DIRECT"
          ? BONUS_REASONS.DIRECT_ORDER_REDEMPTION_REVERSED
          : BONUS_REASONS.WEB_ORDER_REDEMPTION_REVERSED,
        referenceId: referenceKey,
        idempotencyKey: order.orderSource === "DIRECT"
          ? `direct-order-bonus-revert:${order.id}:${order.benefitsRevision}`
          : webOrderBonusRevisionRevertKey(referenceKey, order.benefitsRevision),
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
