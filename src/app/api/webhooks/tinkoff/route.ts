import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { notificationStatus, paymentTransitionAllowed } from "@/lib/payment-notification";
import { verifyTinkoffSignature } from "@/lib/tinkoff";

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

    const eventKey = `tbank:${paymentId}:${String(body.Status)}:${amountKopecks}`;
    const duplicate = await prisma.orderEvent.findUnique({ where: { idempotencyKey: eventKey }, select: { id: true } });
    if (duplicate) return new NextResponse("OK", { status: 200 });

    const eventHash = crypto.createHash("sha256").update(rawBody, "utf8").digest("hex");
    await prisma.$transaction(async (tx) => {
      const transitioned = await tx.paymentAttempt.updateMany({
        where: { id: attempt.id, status: attempt.status, paymentId, amountKopecks },
        data: {
          status: nextStatus,
          rawEventHash: eventHash,
          ...(nextStatus === "CONFIRMED" || nextStatus === "REJECTED" || nextStatus === "CANCELED" || nextStatus === "REFUNDED"
            ? { finalizedAt: new Date() }
            : {}),
        },
      });
      if (transitioned.count !== 1) throw new Error("concurrent payment transition");

      if (nextStatus === "CONFIRMED") {
        await tx.wbOrder.update({
          where: { id: attempt.order.id },
          data: { status: "PENDING", paidAt: new Date(), pendingAt: new Date() },
        });
      } else if ((nextStatus === "REJECTED" || nextStatus === "CANCELED") && attempt.order.status !== "COMPLETED") {
        await tx.wbOrder.update({ where: { id: attempt.order.id }, data: { status: "REJECTED" } });
      }

      const event = await tx.orderEvent.create({
        data: {
          orderId: attempt.order.id,
          type: `PAYMENT_${nextStatus}`,
          idempotencyKey: eventKey,
          payload: { paymentAttemptId: attempt.id, provider: "TBANK", eventHash },
        },
      });
      if (nextStatus === "CONFIRMED" || nextStatus === "PARTIALLY_REFUNDED" || nextStatus === "REFUNDED") {
        await tx.outboxMessage.create({
          data: {
            eventId: event.id,
            topic: nextStatus === "CONFIRMED" ? "payment.confirmed" : "payment.refund.recorded",
            payload: { orderId: attempt.order.id, paymentAttemptId: attempt.id },
          },
        });
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

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
