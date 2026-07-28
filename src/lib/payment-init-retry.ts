import { PaymentAttemptStatus, Prisma } from "@prisma/client";
import { BONUS_REASONS, applyBonusDeltaTx, webOrderBonusRetryKey } from "@/lib/bonus-ledger";
import { createStatusToken, hashStatusToken } from "@/lib/canonical-web-order";
import { prisma } from "@/lib/prisma";

export const MAX_PAYMENT_INIT_ATTEMPTS = 3;
export const CREATED_ATTEMPT_STALE_MS = 2 * 60_000;

const LIVE_PAYMENT_STATUSES = new Set<PaymentAttemptStatus>([
  "CREATED",
  "INITIATED",
  "AUTHORIZED",
  "CONFIRMED",
  "PARTIALLY_REFUNDED",
]);

export function isLivePaymentAttempt(status: PaymentAttemptStatus, createdAt?: Date, now = new Date()) {
  if (status === "CREATED" && createdAt) {
    return now.getTime() - createdAt.getTime() <= CREATED_ATTEMPT_STALE_MS;
  }
  return LIVE_PAYMENT_STATUSES.has(status);
}

export function providerOrderIdForAttempt(publicOrderId: string, attemptNumber: number) {
  if (!Number.isSafeInteger(attemptNumber) || attemptNumber < 1 || attemptNumber > MAX_PAYMENT_INIT_ATTEMPTS) {
    throw new Error("invalid payment attempt number");
  }
  return attemptNumber === 1 ? publicOrderId : `${publicOrderId}-R${attemptNumber}`;
}

export class PaymentRetryError extends Error {
  constructor(
    public readonly code: "PAYMENT_ACTIVE" | "PAYMENT_RETRY_LIMIT" | "BENEFITS_CHANGED" | "BENEFITS_RECONCILING",
    message: string,
  ) {
    super(message);
    this.name = "PaymentRetryError";
  }
}

/**
 * Creates another provider attempt for the same canonical order. This is only
 * called after every prior attempt is terminal. If the first Init failure
 * returned bonus/discount, the exact same benefits are atomically reserved
 * again before the customer is sent to the bank.
 */
export async function createPaymentRetry(input: {
  orderId: string;
  idempotencyKey: string;
  receiptEmail: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const rawStatusToken = createStatusToken();

  const result = await prisma.$transaction(async (tx) => {
    const order = await tx.wbOrder.findUnique({
      where: { id: input.orderId },
      select: {
        id: true,
        userId: true,
        publicOrderId: true,
        paymentAmountKopecks: true,
        bonusAppliedRobux: true,
        discountAppliedKopecks: true,
        benefitsRevertedAt: true,
        benefitsRevision: true,
        paymentAttempts: {
          orderBy: { createdAt: "asc" },
          select: { id: true, status: true, paymentUrl: true, createdAt: true },
        },
      },
    });
    if (!order?.publicOrderId || !order.paymentAmountKopecks) throw new Error("canonical order not found");

    const staleCreatedIds = order.paymentAttempts
      .filter((attempt) => attempt.status === "CREATED" && !isLivePaymentAttempt(attempt.status, attempt.createdAt, now))
      .map((attempt) => attempt.id);
    if (staleCreatedIds.length > 0) {
      await tx.paymentAttempt.updateMany({
        where: { id: { in: staleCreatedIds }, status: "CREATED" },
        data: { status: "FAILED", finalizedAt: now },
      });
    }
    const live = order.paymentAttempts.find((attempt) => isLivePaymentAttempt(attempt.status, attempt.createdAt, now));
    if (live) throw new PaymentRetryError("PAYMENT_ACTIVE", "Оплата для заказа уже создана");
    if (order.paymentAttempts.length >= MAX_PAYMENT_INIT_ATTEMPTS) {
      throw new PaymentRetryError("PAYMENT_RETRY_LIMIT", "Лимит попыток оплаты исчерпан. Создайте новый заказ.");
    }

    const attemptNumber = order.paymentAttempts.length + 1;
    const nextRevision = order.benefitsRevision + 1;
    const bonusRobux = order.bonusAppliedRobux ?? 0;
    const discountKopecks = order.discountAppliedKopecks ?? 0;

    if ((bonusRobux > 0 || discountKopecks > 0) && !order.benefitsRevertedAt) {
      throw new PaymentRetryError(
        "BENEFITS_RECONCILING",
        "Возврат бонуса или скидки ещё проверяется. Повторите через несколько секунд.",
      );
    }

    if (order.benefitsRevertedAt) {
      if (bonusRobux > 0) {
        const bonus = await applyBonusDeltaTx(tx, {
          userId: order.userId,
          deltaRobux: -bonusRobux,
          reason: BONUS_REASONS.WEB_ORDER_REDEMPTION,
          referenceId: order.id,
          idempotencyKey: webOrderBonusRetryKey(order.id, nextRevision),
          metadata: { orderId: order.id, attemptNumber, revision: nextRevision } as Prisma.InputJsonValue,
        });
        if (!bonus.applied && bonus.reason === "insufficient") {
          throw new PaymentRetryError("BENEFITS_CHANGED", "Бонусный баланс изменился. Создайте новый заказ.");
        }
      }
      if (discountKopecks > 0) {
        const discountRubles = discountKopecks / 100;
        const discount = await tx.user.updateMany({
          where: { id: order.userId, rubleDiscount: { gte: discountRubles } },
          data: { rubleDiscount: { decrement: discountRubles } },
        });
        if (discount.count !== 1) {
          throw new PaymentRetryError("BENEFITS_CHANGED", "Скидка изменилась. Создайте новый заказ.");
        }
      }
    }

    const providerOrderId = providerOrderIdForAttempt(order.publicOrderId, attemptNumber);
    const attempt = await tx.paymentAttempt.create({
      data: {
        orderId: order.id,
        provider: "TBANK",
        publicOrderId: providerOrderId,
        amountKopecks: order.paymentAmountKopecks,
        idempotencyKey: `tbank:init:${input.idempotencyKey}`,
      },
    });
    await tx.wbOrder.update({
      where: { id: order.id },
      data: {
        status: "AWAITING_PAYMENT",
        receiptEmail: input.receiptEmail,
        statusTokenHash: hashStatusToken(rawStatusToken),
        benefitsRevertedAt: null,
        ...(order.benefitsRevertedAt ? { benefitsRevision: nextRevision } : {}),
        rejectionReason: null,
      },
    });
    await tx.orderEvent.create({
      data: {
        orderId: order.id,
        type: "PAYMENT_RETRY_CREATED",
        idempotencyKey: `payment-retry-created:${attempt.id}`,
        payload: { paymentAttemptId: attempt.id, attemptNumber, providerOrderId },
      },
    });
    return { attempt, publicOrderId: order.publicOrderId, providerOrderId, attemptNumber };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  return { ...result, statusToken: rawStatusToken };
}
