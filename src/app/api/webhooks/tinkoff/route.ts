import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  notificationStatus,
  paymentClosesUnfulfilledOrder,
  paymentTransitionAllowed,
} from "@/lib/payment-notification";
import { verifyTinkoffSignature } from "@/lib/tinkoff";
import {
  reserveLatePaymentBenefitsTx,
  revertWebOrderBenefits,
} from "@/lib/web-order-benefits";
import { CREATED_ATTEMPT_STALE_MS } from "@/lib/payment-init-retry";

export const dynamic = "force-dynamic";

function fail(message: string, status: number) {
  return new NextResponse(message, { status });
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return fail("invalid json", 400);
  }

  if (!verifyTinkoffSignature(body)) return fail("invalid signature", 401);

  const terminalKey = process.env.TINKOFF_TERMINAL_KEY;
  if (!terminalKey) return fail("terminal is not configured", 503);
  if (body.TerminalKey !== terminalKey) return fail("terminal mismatch", 409);

  const publicOrderId = typeof body.OrderId === "string" ? body.OrderId : String(body.OrderId ?? "");
  const paymentId = typeof body.PaymentId === "string" ? body.PaymentId : String(body.PaymentId ?? "");
  const amountKopecks = Number(body.Amount);
  const nextStatus = notificationStatus(body.Status);
  if (!publicOrderId || !paymentId || !Number.isSafeInteger(amountKopecks) || !nextStatus) {
    return fail("unsupported notification", 422);
  }

  try {
    const attempt = await prisma.paymentAttempt.findUnique({
      where: { publicOrderId },
      include: { order: { select: { id: true, status: true } } },
    });
    if (!attempt) return fail("payment attempt not found", 404);
    // A notification can beat the Init response. Returning a retryable error is
    // safer than accepting a PaymentId we have not durably recorded yet.
    if (!attempt.paymentId) return fail("payment initialization is not durable yet", 503);
    if (attempt.paymentId !== paymentId) return fail("payment id mismatch", 409);
    if (attempt.amountKopecks !== amountKopecks) return fail("amount mismatch", 409);
    if (!paymentTransitionAllowed(attempt.status, nextStatus)) return fail("invalid status transition", 409);

    /** U3: заказ, которому нужно вернуть бонус/скидку после отказа банка. */
    let benefitsToRevert: string | null = null;

    const eventHash = crypto.createHash("sha256").update(rawBody, "utf8").digest("hex");
    // Multiple legitimate partial refunds share PaymentId/Status/Amount. Their
    // signed raw bodies are the only safe idempotency discriminator available.
    const refundNotification = nextStatus === "PARTIALLY_REFUNDED" || nextStatus === "REFUNDED";
    if (refundNotification && attempt.rawEventHash === eventHash) return new NextResponse("OK", { status: 200 });
    const refundCandidate = refundNotification
      ? await prisma.paymentRefund.findFirst({
          where: { paymentAttemptId: attempt.id, status: { in: ["PENDING", "SUBMITTED", "SUBMIT_UNKNOWN"] } },
          orderBy: { createdAt: "asc" }, select: { id: true },
        })
      : null;
    const eventKey = refundNotification
      ? `tbank:${paymentId}:${String(body.Status)}:${refundCandidate?.id ?? eventHash}`
      : `tbank:${paymentId}:${String(body.Status)}:${amountKopecks}`;
    const duplicate = await prisma.orderEvent.findUnique({ where: { idempotencyKey: eventKey }, select: { id: true } });
    if (duplicate) return new NextResponse("OK", { status: 200 });

    await prisma.$transaction(async (tx) => {
      const submittedRefunds = refundNotification
        ? await tx.paymentRefund.findMany({
            where: { paymentAttemptId: attempt.id, status: { in: ["PENDING", "SUBMITTED", "SUBMIT_UNKNOWN"] } },
            orderBy: { createdAt: "asc" },
            ...(nextStatus === "PARTIALLY_REFUNDED" ? { take: 1 } : {}),
            select: { id: true, amountKopecks: true },
          })
        : [];
      const acknowledgedNow = submittedRefunds.reduce((sum, refund) => sum + refund.amountKopecks, 0);
      const refundedAmountKopecks = nextStatus === "REFUNDED"
        ? attempt.amountKopecks
        : Math.min(attempt.amountKopecks, attempt.refundedAmountKopecks + acknowledgedNow);
      const transitioned = await tx.paymentAttempt.updateMany({
        where: { id: attempt.id, status: attempt.status, paymentId, amountKopecks },
        data: {
          status: nextStatus,
          rawEventHash: eventHash,
          ...(refundNotification ? { refundedAmountKopecks } : {}),
          ...(nextStatus === "CONFIRMED" || nextStatus === "REJECTED" || nextStatus === "CANCELED" || nextStatus === "REFUNDED"
            ? { finalizedAt: new Date() }
            : {}),
        },
      });
      if (transitioned.count !== 1) throw new Error("concurrent payment transition");

      if (submittedRefunds.length > 0) {
        await tx.paymentRefund.updateMany({
          where: { id: { in: submittedRefunds.map((refund) => refund.id) }, status: { in: ["PENDING", "SUBMITTED", "SUBMIT_UNKNOWN"] } },
          data: { status: "CONFIRMED", providerStatus: String(body.Status) },
        });
      }

      let needsBenefitReconciliation = false;
      if (nextStatus === "CONFIRMED") {
        const currentOrder = await tx.wbOrder.findUnique({
          where: { id: attempt.order.id },
          select: {
            id: true,
            userId: true,
            status: true,
            priceQuoteId: true,
            publicOrderId: true,
            bonusAppliedRobux: true,
            discountAppliedKopecks: true,
            benefitsRevertedAt: true,
            benefitsRevision: true,
            orderSource: true,
          },
        });
        if (!currentOrder) throw new Error("payment order disappeared");
        const reservation = await reserveLatePaymentBenefitsTx(tx, currentOrder, attempt.id);
        needsBenefitReconciliation = !reservation.reserved;
        await tx.wbOrder.update({
          where: { id: attempt.order.id },
          data: currentOrder.status === "COMPLETED"
            ? { paidAt: new Date() }
            : reservation.reserved
              ? {
                  status: "PENDING",
                  paidAt: new Date(),
                  pendingAt: new Date(),
                  rejectionReason: null,
                  ...(currentOrder.benefitsRevertedAt
                    ? { benefitsRevertedAt: null, benefitsRevision: reservation.revision }
                    : {}),
                }
              : {
                  status: "ERROR",
                  paidAt: new Date(),
                  rejectionReason: "Оплата подтверждена после автоотмены; льготы требуют ручной сверки",
                },
        });
      } else if (paymentClosesUnfulfilledOrder(nextStatus, attempt.order.status)) {
        // A late callback from an older provider attempt must not reject an
        // order that already has a newer live attempt. Provider OrderId is
        // unique per retry precisely so both callbacks can be reconciled.
        const anotherLiveAttempt = await tx.paymentAttempt.findFirst({
          where: {
            orderId: attempt.order.id,
            id: { not: attempt.id },
            OR: [
              { status: "CREATED", createdAt: { gt: new Date(Date.now() - CREATED_ATTEMPT_STALE_MS) } },
              { status: { in: ["INITIATED", "AUTHORIZED", "CONFIRMED", "PARTIALLY_REFUNDED"] } },
            ],
          },
          select: { id: true },
        });
        if (!anotherLiveAttempt) {
          await tx.wbOrder.update({
            where: { id: attempt.order.id },
            data: {
              status: "REJECTED",
              rejectionReason: nextStatus === "REFUNDED"
                ? "Платёж полностью возвращён"
                : "Платёж отклонён или отменён банком",
            },
          });
          if (nextStatus === "REJECTED" || nextStatus === "CANCELED") {
            // U3: банк отказал до оплаты — бонус и скидка возвращаются клиенту.
            benefitsToRevert = attempt.order.id;
          }
        }
      }

      const event = await tx.orderEvent.create({
        data: {
          orderId: attempt.order.id,
          type: `PAYMENT_${nextStatus}`,
          idempotencyKey: eventKey,
          payload: {
            paymentAttemptId: attempt.id,
            provider: "TBANK",
            eventHash,
            ...(nextStatus === "CONFIRMED" ? { needsReconciliation: needsBenefitReconciliation } : {}),
          },
        },
      });
      if (nextStatus === "CONFIRMED" || nextStatus === "PARTIALLY_REFUNDED" || nextStatus === "REFUNDED") {
        await tx.outboxMessage.create({
          data: {
            eventId: event.id,
            topic: nextStatus === "CONFIRMED" ? "payment.confirmed" : "payment.refund.recorded",
            payload: {
              orderId: attempt.order.id,
              paymentAttemptId: attempt.id,
              ...(nextStatus === "CONFIRMED" ? { needsReconciliation: needsBenefitReconciliation } : {}),
              ...(refundNotification ? { refundedAmountKopecks, needsReconciliation: submittedRefunds.length === 0 } : {}),
            },
          },
        });
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    // U3: компенсация бонуса/скидки — отдельной транзакцией после того, как
    // отказ платежа зафиксирован. Она идемпотентна, поэтому повторный webhook
    // (T-Bank шлёт их повторно) второго возврата не создаст, а её падение не
    // откатывает уже принятый статус платежа.
    if (benefitsToRevert) {
      try {
        await revertWebOrderBenefits(benefitsToRevert, "BANK_REJECTED");
      } catch (revertError) {
        console.error("[Tinkoff webhook] benefits revert failed", { orderId: benefitsToRevert, revertError });
      }
    }

    // T-Bank treats this exact body as acknowledgement. It is returned only
    // after the payment transition and durable event/outbox commit.
    return new NextResponse("OK", { status: 200 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return new NextResponse("OK", { status: 200 });
    }
    console.error("[Tinkoff webhook] durable processing failed", error);
    return fail("temporary processing error", 503);
  }
}
