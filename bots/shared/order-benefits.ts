/**
 * Единая точка изменения бонусного баланса на стороне ботов
 * (ultra-review U3/U4, риск №25 в docs/security.md).
 *
 * Зеркало `src/lib/bonus-ledger.ts` + `src/lib/web-order-benefits.ts`: `bots/`
 * и `src/` не импортируют друг друга (см. bots/shared/completed-messages.ts),
 * поэтому ключи идемпотентности и названия причин обязаны совпадать буквально.
 *
 * Что здесь чинится:
 *   - бот считал `balance = user.balance + x` (read-modify-write → lost update
 *     при гонке) и не писал в `BonusLedger` вовсе;
 *   - ветка возврата бонуса при отмене прямого заказа (`ucd:`) брала номинал из
 *     строки `WbCode`, которой у `DIR-` заказов не существует, поэтому
 *     `bonusApplied` всегда был 0 и возврат был недостижим;
 *   - скидка не возвращалась вообще («минорный edge case» в комментарии).
 */

import { db } from "./db";

export const BONUS_REASONS = {
  WEB_ORDER_REDEMPTION: "WEB_ORDER_REDEMPTION",
  WEB_ORDER_REDEMPTION_REVERSED: "WEB_ORDER_REDEMPTION_REVERSED",
  DIRECT_ORDER_REDEMPTION: "DIRECT_ORDER_REDEMPTION",
  DIRECT_ORDER_REDEMPTION_REVERSED: "DIRECT_ORDER_REDEMPTION_REVERSED",
} as const;

export const webOrderBonusRevertKey = (referenceId: string) => `web-order-bonus-revert:${referenceId}`;
export const directOrderBonusKey = (orderId: string) => `direct-order-bonus:${orderId}`;
export const directOrderBonusRevertKey = (orderId: string) => `direct-order-bonus-revert:${orderId}`;

export type BonusDeltaInput = {
  userId: string;
  deltaRobux: number;
  reason: string;
  referenceId?: string | null;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
};

/**
 * Меняет баланс ТОЛЬКО через `increment` и всегда оставляет строку в леджере.
 * Повторный вызов с тем же ключом ничего не делает.
 */
export async function applyBonusDeltaTx(tx: any, input: BonusDeltaInput): Promise<boolean> {
  if (!Number.isInteger(input.deltaRobux) || input.deltaRobux === 0) return false;

  const existing = await tx.bonusLedger.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    select: { id: true },
  });
  if (existing) return false;

  if (input.deltaRobux < 0) {
    const guarded = await tx.user.updateMany({
      where: { id: input.userId, balance: { gte: -input.deltaRobux } },
      data: { balance: { increment: input.deltaRobux } },
    });
    if (guarded.count !== 1) return false;
  } else {
    await tx.user.update({
      where: { id: input.userId },
      data: { balance: { increment: input.deltaRobux } },
    });
  }

  const after = await tx.user.findUnique({ where: { id: input.userId }, select: { balance: true } });

  await tx.bonusLedger.create({
    data: {
      userId: input.userId,
      deltaRobux: input.deltaRobux,
      balanceAfter: after?.balance ?? 0,
      reason: input.reason,
      referenceId: input.referenceId ?? null,
      idempotencyKey: input.idempotencyKey,
      metadata: input.metadata ?? undefined,
    },
  });
  return true;
}

export type RevertOutcome = {
  reverted: boolean;
  bonusRobux: number;
  discountKopecks: number;
};

/**
 * Возврат бонуса и скидки по заказу. Источник сумм — поля самого заказа
 * (`bonusAppliedRobux` / `discountAppliedKopecks`), которые теперь пишутся при
 * его создании. Идемпотентно: `benefitsRevertedAt` + уникальный ключ в леджере.
 */
export async function revertOrderBenefits(
  orderId: string,
  opts: { reason: string; kind: "WEB" | "DIRECT" },
): Promise<RevertOutcome> {
  const none: RevertOutcome = { reverted: false, bonusRobux: 0, discountKopecks: 0 };

  return (db as any).$transaction(async (tx: any) => {
    const order = await tx.wbOrder.findUnique({
      where: { id: orderId },
      select: {
        id: true, userId: true, paidAt: true, priceQuoteId: true,
        bonusAppliedRobux: true, discountAppliedKopecks: true, benefitsRevertedAt: true,
      },
    });
    if (!order || order.benefitsRevertedAt || order.paidAt) return none;

    const bonusRobux = order.bonusAppliedRobux ?? 0;
    const discountKopecks = order.discountAppliedKopecks ?? 0;

    if (bonusRobux <= 0 && discountKopecks <= 0) {
      await tx.wbOrder.update({ where: { id: order.id }, data: { benefitsRevertedAt: new Date() } });
      return none;
    }

    const referenceKey = order.priceQuoteId ?? order.id;
    if (bonusRobux > 0) {
      await applyBonusDeltaTx(tx, {
        userId: order.userId,
        deltaRobux: bonusRobux,
        reason: opts.kind === "WEB"
          ? BONUS_REASONS.WEB_ORDER_REDEMPTION_REVERSED
          : BONUS_REASONS.DIRECT_ORDER_REDEMPTION_REVERSED,
        referenceId: referenceKey,
        idempotencyKey: opts.kind === "WEB"
          ? webOrderBonusRevertKey(referenceKey)
          : directOrderBonusRevertKey(order.id),
        metadata: { orderId: order.id, revertReason: opts.reason },
      });
    }
    if (discountKopecks > 0) {
      await tx.user.update({
        where: { id: order.userId },
        data: { rubleDiscount: { increment: discountKopecks / 100 } },
      });
    }

    await tx.wbOrder.update({ where: { id: order.id }, data: { benefitsRevertedAt: new Date() } });
    await tx.orderEvent.create({
      data: {
        orderId: order.id,
        type: "BENEFITS_REVERTED",
        idempotencyKey: `benefits-reverted:${order.id}`,
        payload: { bonusRobux, discountKopecks, reason: opts.reason },
      },
    }).catch(() => {});

    return { reverted: true, bonusRobux, discountKopecks };
  });
}

/** Заказы, брошенные без оплаты дольше этого срока, отменяются автоматически. */
export const STALE_WEB_ORDER_MS = 2 * 60 * 60 * 1000;

/**
 * Крон: web-заказы, застрявшие в `AWAITING_PAYMENT`/`PAYMENT_PENDING` дольше
 * двух часов, переводятся в `REJECTED` с возвратом бонуса и скидки. Без этого
 * брошенная оплата навсегда съедала накопленное клиента.
 */
export async function sweepStaleWebOrders(now = Date.now()): Promise<{ swept: number; reverted: number }> {
  const cutoff = new Date(now - STALE_WEB_ORDER_MS);
  const stale = await (db as any).wbOrder.findMany({
    where: {
      status: { in: ["AWAITING_PAYMENT", "PAYMENT_PENDING"] },
      orderSource: "SITE",
      paidAt: null,
      createdAt: { lt: cutoff },
    },
    select: { id: true },
    take: 200,
  });

  let reverted = 0;
  for (const order of stale) {
    try {
      await (db as any).wbOrder.updateMany({
        where: { id: order.id, status: { in: ["AWAITING_PAYMENT", "PAYMENT_PENDING"] }, paidAt: null },
        data: { status: "REJECTED", rejectionReason: "Оплата не завершена (авто-отмена через 2 ч)" },
      });
      const outcome = await revertOrderBenefits(order.id, { reason: "ABANDONED", kind: "WEB" });
      if (outcome.reverted) reverted++;
    } catch (err: any) {
      console.error("[StaleWebOrders] error:", order.id, err?.message ?? err);
    }
  }
  return { swept: stale.length, reverted };
}
