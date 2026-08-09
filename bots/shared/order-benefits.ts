/* eslint-disable @typescript-eslint/no-explicit-any -- bot Prisma mirror intentionally uses the generated client through a shared compatibility boundary */
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

import { PaymentAttemptStatus } from "@prisma/client";
import { db } from "./db";
import {
  cancelTbankPaymentSession,
  getTbankPaymentState,
  internalPaymentStatus,
  staleProviderPaymentNeedsCancel,
} from "./tbank-payment";

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
const CREATED_PAYMENT_STALE_MS = 2 * 60 * 1000;
const LIVE_ATTEMPT_STATUSES = ["CREATED", "INITIATED", "AUTHORIZED"] as const;

async function reserveLatePaymentBenefitsTx(tx: any, order: Record<string, any>, attemptId: string) {
  if (!order.benefitsRevertedAt) return true;

  const bonusRobux = order.bonusAppliedRobux ?? 0;
  const discountKopecks = order.discountAppliedKopecks ?? 0;
  const discountRubles = discountKopecks / 100;
  if (bonusRobux <= 0 && discountKopecks <= 0) return true;

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
  if (guarded.count !== 1) return false;

  if (bonusRobux > 0) {
    const after = await tx.user.findUnique({ where: { id: order.userId }, select: { balance: true } });
    await tx.bonusLedger.create({
      data: {
        userId: order.userId,
        deltaRobux: -bonusRobux,
        balanceAfter: after?.balance ?? 0,
        reason: BONUS_REASONS.WEB_ORDER_REDEMPTION,
        referenceId: order.priceQuoteId ?? order.id,
        idempotencyKey: `web-order-bonus-late-payment:${attemptId}`,
        metadata: { orderId: order.id, paymentAttemptId: attemptId, revision: order.benefitsRevision + 1 },
      },
    });
  }
  return true;
}

async function reconcileConfirmedAttempt(attemptId: string, providerStatus: string, now: Date) {
  return (db as any).$transaction(async (tx: any) => {
    const attempt = await tx.paymentAttempt.findUnique({
      where: { id: attemptId },
      include: { order: true },
    });
    if (!attempt || attempt.status === "CONFIRMED") return { reconciled: false, manual: false };
    if (!LIVE_ATTEMPT_STATUSES.includes(attempt.status)) return { reconciled: false, manual: false };

    const transitioned = await tx.paymentAttempt.updateMany({
      where: { id: attempt.id, status: { in: [...LIVE_ATTEMPT_STATUSES] } },
      data: { status: "CONFIRMED", finalizedAt: now },
    });
    if (transitioned.count !== 1) return { reconciled: false, manual: false };

    const benefitsReserved = await reserveLatePaymentBenefitsTx(tx, attempt.order, attempt.id);
    await tx.wbOrder.update({
      where: { id: attempt.orderId },
      data: benefitsReserved
        ? {
            status: "PENDING",
            paidAt: now,
            pendingAt: now,
            rejectionReason: null,
            ...(attempt.order.benefitsRevertedAt
              ? { benefitsRevertedAt: null, benefitsRevision: { increment: 1 } }
              : {}),
          }
        : {
            status: "ERROR",
            paidAt: now,
            rejectionReason: "Оплата подтверждена после автоотмены; льготы требуют ручной сверки",
          },
    });

    const event = await tx.orderEvent.upsert({
      where: { idempotencyKey: `tbank:${attempt.paymentId}:CONFIRMED:${attempt.amountKopecks}` },
      update: {},
      create: {
        orderId: attempt.orderId,
        type: "PAYMENT_CONFIRMED",
        idempotencyKey: `tbank:${attempt.paymentId}:CONFIRMED:${attempt.amountKopecks}`,
        payload: {
          paymentAttemptId: attempt.id,
          provider: "TBANK",
          source: "GET_STATE",
          providerStatus,
          needsReconciliation: !benefitsReserved,
        },
      },
    });
    await tx.outboxMessage.upsert({
      where: { eventId: event.id },
      update: {},
      create: {
        eventId: event.id,
        topic: "payment.confirmed",
        payload: { orderId: attempt.orderId, paymentAttemptId: attempt.id, needsReconciliation: !benefitsReserved },
      },
    });
    return { reconciled: true, manual: !benefitsReserved };
  });
}

async function closeUnpaidAttempt(
  attemptId: string,
  nextStatus: PaymentAttemptStatus,
  providerStatus: string,
  now: Date,
) {
  const closed = await (db as any).$transaction(async (tx: any) => {
    const attempt = await tx.paymentAttempt.findUnique({
      where: { id: attemptId },
      include: { order: true },
    });
    if (!attempt || !LIVE_ATTEMPT_STATUSES.includes(attempt.status)) return null;
    const transitioned = await tx.paymentAttempt.updateMany({
      where: { id: attempt.id, status: { in: [...LIVE_ATTEMPT_STATUSES] } },
      data: { status: nextStatus, finalizedAt: now },
    });
    if (transitioned.count !== 1) return null;

    await tx.orderEvent.upsert({
      where: { idempotencyKey: `tbank-reconcile:${attempt.id}:${providerStatus}` },
      update: {},
      create: {
        orderId: attempt.orderId,
        type: `PAYMENT_${nextStatus}`,
        idempotencyKey: `tbank-reconcile:${attempt.id}:${providerStatus}`,
        payload: { paymentAttemptId: attempt.id, provider: "TBANK", source: "GET_STATE", providerStatus },
      },
    });

    if (attempt.order.paidAt) return null;
    const anotherLive = await tx.paymentAttempt.findFirst({
      where: { orderId: attempt.orderId, id: { not: attempt.id }, status: { in: [...LIVE_ATTEMPT_STATUSES] } },
      select: { id: true },
    });
    if (anotherLive) return null;
    const rejected = await tx.wbOrder.updateMany({
      where: {
        id: attempt.orderId,
        paidAt: null,
        status: { in: ["AWAITING_PAYMENT", "PAYMENT_PENDING", "REJECTED", "ERROR"] },
      },
      data: { status: "REJECTED", rejectionReason: "Оплата не завершена (статус сверён с банком)" },
    });
    return rejected.count === 1 ? attempt.orderId : null;
  });

  if (!closed) return { closed: false, reverted: false };
  const source = await (db as any).wbOrder.findUnique({ where: { id: closed }, select: { orderSource: true } });
  const outcome = await revertOrderBenefits(closed, {
    reason: "ABANDONED",
    kind: source?.orderSource === "DIRECT" ? "DIRECT" : "WEB",
  });
  return { closed: true, reverted: outcome.reverted };
}

async function closeOrderWithoutProviderAttempt(orderId: string) {
  const updated = await (db as any).wbOrder.updateMany({
    where: { id: orderId, status: { in: ["AWAITING_PAYMENT", "PAYMENT_PENDING"] }, paidAt: null },
    data: { status: "REJECTED", rejectionReason: "Оплата не была создана (авто-отмена через 2 ч)" },
  });
  if (updated.count !== 1) return { closed: false, reverted: false };
  const outcome = await revertOrderBenefits(orderId, { reason: "ABANDONED", kind: "WEB" });
  return { closed: true, reverted: outcome.reverted };
}

/**
 * Крон: перед закрытием брошенного web-заказа обязательно сверяет T-Bank
 * GetState. Живая сессия сначала отменяется через Cancel, а бонус/скидка
 * возвращаются только после терминального ответа банка. Также чинит старые
 * пары `REJECTED + INITIATED`, оставленные прежней реализацией.
 */
export async function sweepStaleWebOrders(now = Date.now()): Promise<{
  scanned: number;
  swept: number;
  reverted: number;
  reconciled: number;
  manual: number;
  deferred: number;
}> {
  const cutoff = new Date(now - STALE_WEB_ORDER_MS);
  const stale = await (db as any).wbOrder.findMany({
    where: {
      orderSource: { in: ["SITE", "DIRECT"] },
      publicOrderId: { not: null },
      AND: [{
        OR: [
          { paymentAttempts: { some: { provider: "TBANK" } } },
          { paymentAttempts: { none: {} } },
        ],
      }],
      paidAt: null,
      OR: [
        { status: { in: ["AWAITING_PAYMENT", "PAYMENT_PENDING"] }, createdAt: { lt: cutoff } },
        {
          status: { in: ["REJECTED", "ERROR"] },
          paymentAttempts: {
            some: {
              status: { in: [...LIVE_ATTEMPT_STATUSES] },
              createdAt: { lt: cutoff },
            },
          },
        },
      ],
    },
    select: {
      id: true,
      status: true,
      paymentAttempts: {
        where: { provider: "TBANK", status: { in: [...LIVE_ATTEMPT_STATUSES] } },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          status: true,
          paymentId: true,
          publicOrderId: true,
          amountKopecks: true,
          createdAt: true,
        },
      },
    },
    take: 200,
  });

  const stats = { scanned: stale.length, swept: 0, reverted: 0, reconciled: 0, manual: 0, deferred: 0 };
  for (const order of stale) {
    const attempts = order.paymentAttempts ?? [];
    if (attempts.length === 0) {
      const result = await closeOrderWithoutProviderAttempt(order.id);
      if (result.closed) stats.swept++;
      if (result.reverted) stats.reverted++;
      continue;
    }

    try {
      for (const attempt of attempts) {
        if (attempt.status === "CREATED") {
          if (now - new Date(attempt.createdAt).getTime() <= CREATED_PAYMENT_STALE_MS) {
            stats.deferred++;
            continue;
          }
          const result = await closeUnpaidAttempt(attempt.id, PaymentAttemptStatus.FAILED, "INIT_TIMEOUT", new Date(now));
          if (result.closed) stats.swept++;
          if (result.reverted) stats.reverted++;
          continue;
        }
        if (!attempt.paymentId) {
          stats.deferred++;
          console.error("[StaleWebOrders] live attempt has no PaymentId", { orderId: order.id, attemptId: attempt.id });
          continue;
        }

        let state = await getTbankPaymentState({
          paymentId: attempt.paymentId,
          providerOrderId: attempt.publicOrderId,
          amountKopecks: attempt.amountKopecks,
        });
        if (staleProviderPaymentNeedsCancel(state.status)) {
          state = await cancelTbankPaymentSession(attempt.paymentId);
        }
        const internalStatus = internalPaymentStatus(state.status);
        if (internalStatus === PaymentAttemptStatus.CONFIRMED) {
          const result = await reconcileConfirmedAttempt(attempt.id, state.status, new Date(now));
          if (result.reconciled) stats.reconciled++;
          if (result.manual) stats.manual++;
        } else if (
          internalStatus === PaymentAttemptStatus.REJECTED
          || internalStatus === PaymentAttemptStatus.CANCELED
          || internalStatus === PaymentAttemptStatus.REFUNDED
        ) {
          const result = await closeUnpaidAttempt(attempt.id, internalStatus, state.status, new Date(now));
          if (result.closed) stats.swept++;
          if (result.reverted) stats.reverted++;
        } else {
          stats.deferred++;
        }
      }
    } catch (err: any) {
      console.error("[StaleWebOrders] error:", order.id, err?.message ?? err);
      stats.deferred++;
    }
  }
  return stats;
}
