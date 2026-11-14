import crypto from "node:crypto";
import { Prisma, type PaymentAttemptStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { notificationStatus, paymentTransitionAllowed } from "@/lib/payment-notification";
import { issueCodeForOrder } from "@/lib/codes/stock";
import { sendCodeEmail } from "@/lib/codes/delivery";
import { notifyCodeAdmins } from "@/lib/codes/admin-notify";

/**
 * Уведомление Т-Банка по заказу кода (OrderId `CODE-…`).
 *
 * Подпись и терминал уже проверены в `/api/webhooks/tinkoff`. Здесь —
 * сверка с НАШИМ платежом (PaymentId, сумма, допустимый переход статуса) и
 * идемпотентность: повтор того же уведомления ничего не меняет, а код
 * выдаётся ровно один раз — в той же транзакции, что фиксирует оплату.
 * Возврат браузера со страницы банка оплату не подтверждает: подтверждает
 * только этот обработчик.
 */

export const CODE_PROVIDER_ORDER_PREFIX = "CODE-";

type Outcome = { status: number; body: string };
const ok: Outcome = { status: 200, body: "OK" };

export async function handleCodePaymentNotification(body: Record<string, unknown>, rawBody: string): Promise<Outcome> {
  const providerOrderId = String(body.OrderId ?? "");
  const paymentId = String(body.PaymentId ?? "");
  const amountKopecks = Number(body.Amount);
  const nextStatus = notificationStatus(body.Status);
  if (!providerOrderId || !paymentId || !Number.isSafeInteger(amountKopecks) || !nextStatus) {
    return { status: 422, body: "unsupported notification" };
  }

  const payment = await prisma.codePayment.findUnique({
    where: { providerOrderId },
    include: { order: { select: { id: true, publicId: true, denomination: true, status: true, paidAt: true, finalAmountKopecks: true } } },
  });
  if (!payment) return { status: 404, body: "payment attempt not found" };
  if (!payment.paymentId) return { status: 503, body: "payment initialization is not durable yet" };
  if (payment.paymentId !== paymentId) return { status: 409, body: "payment id mismatch" };
  if (payment.amountKopecks !== amountKopecks) return { status: 409, body: "amount mismatch" };
  // Т-Банк работает только в рублях; валюта, если пришла, обязана быть 643.
  if (body.Currency !== undefined && String(body.Currency) !== "643") return { status: 409, body: "currency mismatch" };
  if (!paymentTransitionAllowed(payment.status, nextStatus)) return { status: 409, body: "invalid status transition" };

  const eventHash = crypto.createHash("sha256").update(rawBody, "utf8").digest("hex");
  const refund = nextStatus === "PARTIALLY_REFUNDED" || nextStatus === "REFUNDED";
  const eventKey = refund
    ? `code-tbank:${paymentId}:${String(body.Status)}:${eventHash}`
    : `code-tbank:${paymentId}:${String(body.Status)}:${amountKopecks}`;
  const duplicate = await prisma.codeOrderEvent.findUnique({ where: { idempotencyKey: eventKey }, select: { id: true } });
  if (duplicate) return ok;

  let issued = false;
  let attention: "NO_STOCK" | "DOUBLE_PAYMENT" | null = null;

  try {
    await prisma.$transaction(async (tx) => {
      const moved = await tx.codePayment.updateMany({
        where: { id: payment.id, status: payment.status, paymentId, amountKopecks },
        data: {
          status: nextStatus,
          rawEventHash: eventHash,
          ...(nextStatus === "REFUNDED" ? { refundedAmountKopecks: payment.amountKopecks } : {}),
          ...(isFinal(nextStatus) ? { finalizedAt: new Date() } : {}),
        },
      });
      if (moved.count !== 1) throw new Error("concurrent code payment transition");

      const order = await tx.codeOrder.findUniqueOrThrow({
        where: { id: payment.orderId },
        select: { id: true, denomination: true, status: true, paidAt: true, activationCodeId: true },
      });

      if (nextStatus === "CONFIRMED") {
        if (order.paidAt) {
          // Второй успешный платёж по уже оплаченному заказу (старая сессия
          // банка). Второй код НЕ выдаём: деньги — на ручной возврат.
          attention = "DOUBLE_PAYMENT";
          await tx.codeOrder.update({ where: { id: order.id }, data: { attentionReason: "DOUBLE_PAYMENT" } });
        } else {
          const codeId = order.activationCodeId ?? await issueCodeForOrder(tx, order.id, order.denomination);
          if (codeId) {
            issued = true;
            await tx.codeOrder.update({
              where: { id: order.id },
              data: { status: "ISSUED", paidAt: new Date(), issuedAt: new Date(), activationCodeId: codeId, attentionReason: null },
            });
          } else {
            attention = "NO_STOCK";
            await tx.codeOrder.update({
              where: { id: order.id },
              data: { status: "PAID", paidAt: new Date(), attentionReason: "NO_STOCK" },
            });
          }
        }
      } else if ((nextStatus === "REJECTED" || nextStatus === "CANCELED") && !order.paidAt) {
        // Платёж не завершён: заказ снова ждёт оплату, ссылка остаётся рабочей.
        const live = await tx.codePayment.count({
          where: { orderId: order.id, id: { not: payment.id }, status: { in: ["INITIATED", "AUTHORIZED", "CONFIRMED"] } },
        });
        if (live === 0) await tx.codeOrder.update({ where: { id: order.id }, data: { status: "AWAITING_PAYMENT" } });
      } else if (nextStatus === "REFUNDED") {
        await tx.codeOrder.update({ where: { id: order.id }, data: { status: "REFUNDED", refundedAt: new Date() } });
      }

      await tx.codeOrderEvent.create({
        data: {
          orderId: order.id,
          type: `PAYMENT_${nextStatus}`,
          idempotencyKey: eventKey,
          payload: { paymentId: payment.id, eventHash, ...(attention ? { attention } : {}), ...(issued ? { issued: true } : {}) },
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return ok;
    console.error("[codes webhook] durable processing failed", { order: payment.order.publicId });
    return { status: 503, body: "temporary processing error" };
  }

  // Письмо — после фиксации оплаты и кода. Его сбой не трогает ни деньги, ни
  // код: заказ ISSUED, письмо можно переотправить.
  if (issued) {
    const mail = await sendCodeEmail(payment.orderId, "issued").catch(() => "failed" as const);
    if (mail === "failed" || mail === "exhausted") {
      await notifyCodeAdmins({
        marker: "action",
        title: "письмо с кодом не ушло",
        orderPublicId: payment.order.publicId,
        denomination: payment.order.denomination,
        amountKopecks: payment.amountKopecks,
        next: "код выдан и лежит в заказе; переотправка — со страницы заказа или кабинета",
      });
    }
  }
  if (attention) {
    await notifyCodeAdmins({
      marker: "urgent",
      title: attention === "NO_STOCK" ? "оплачен, а кода на складе нет" : "второй платёж по оплаченному заказу",
      orderPublicId: payment.order.publicId,
      denomination: payment.order.denomination,
      amountKopecks: payment.amountKopecks,
      next: attention === "NO_STOCK" ? "загрузить код этого номинала или вернуть деньги" : "вернуть второй платёж через Т-Банк",
    });
  }
  return ok;
}

function isFinal(status: PaymentAttemptStatus): boolean {
  return status === "CONFIRMED" || status === "REJECTED" || status === "CANCELED" || status === "REFUNDED";
}
