import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  BOT_PAYMENT_SIGNATURE_HEADER,
  BOT_PAYMENT_TIMESTAMP_HEADER,
  verifyBotPaymentBody,
} from "@/lib/bot-payment-auth";
import {
  BotPaymentError,
  createCanonicalBotOrder,
  type BotPaymentMethod,
} from "@/lib/canonical-bot-order";
import { prisma } from "@/lib/prisma";
import { initCanonicalTinkoffPayment } from "@/lib/tinkoff";
import { revertWebOrderBenefits } from "@/lib/web-order-benefits";
import { createPaymentRetry } from "@/lib/payment-init-retry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  intentId: z.string().cuid(),
  platform: z.enum(["TG", "VK"]),
  subject: z.string().trim().min(1).max(64),
  receiptEmail: z.email().max(254),
  method: z.enum(["SITE", "BOT_ACQUIRING", "MANUAL_TRANSFER"]),
});

function appUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "https://robloxbank.ru").replace(/\/$/, "");
}

function statusUrl(publicOrderId: string, statusToken: string) {
  const query = new URLSearchParams({ orderId: publicOrderId, token: statusToken, source: "bot" });
  return `${appUrl()}/payment/status?${query}`;
}

function manualDetails() {
  const bank = process.env.MANUAL_TRANSFER_BANK?.trim();
  const recipient = process.env.MANUAL_TRANSFER_RECIPIENT?.trim();
  const phone = process.env.MANUAL_TRANSFER_PHONE?.trim();
  const version = process.env.MANUAL_TRANSFER_CONFIG_VERSION?.trim();
  if (!bank || !recipient || !phone || !version) {
    throw new BotPaymentError("CONFIGURATION", "Оплата по реквизитам временно недоступна");
  }
  return { bank, recipient, phone, version };
}

async function initializeAcquiring(input: {
  orderId: string;
  publicOrderId: string;
  attemptId: string;
  providerOrderId: string;
  amountKopecks: number;
  receiptEmail: string;
  statusToken: string;
}) {
  // Claim provider initialization before the network call. Two fast bot taps (or
  // an HMAC replay inside the allowed clock window) must never send two Init calls
  // for the same PaymentAttempt or compensate benefits under a successful peer.
  const claimed = await prisma.$transaction(async (tx) => {
    const attempt = await tx.paymentAttempt.updateMany({
      where: { id: input.attemptId, orderId: input.orderId, status: "CREATED" },
      data: { status: "INITIATED", initiatedAt: new Date() },
    });
    if (attempt.count !== 1) return false;
    const order = await tx.wbOrder.updateMany({
      where: { id: input.orderId, status: "AWAITING_PAYMENT" },
      data: { status: "PAYMENT_PENDING" },
    });
    if (order.count !== 1) throw new BotPaymentError("ALREADY_PROCESSED", "Платёж уже подготавливается");
    return true;
  });
  if (!claimed) {
    throw new BotPaymentError("ALREADY_PROCESSED", "Платёж уже подготавливается");
  }
  let providerPayment: { paymentId: string; paymentUrl: string } | null = null;
  try {
    const payment = await initCanonicalTinkoffPayment({
      publicOrderId: input.publicOrderId,
      providerOrderId: input.providerOrderId,
      amountKopecks: input.amountKopecks,
      receiptEmail: input.receiptEmail,
      description: `Заказ ${input.publicOrderId}`,
      statusToken: input.statusToken,
    });
    providerPayment = payment;
    await prisma.$transaction([
      prisma.paymentAttempt.update({
        where: { id: input.attemptId },
        data: { paymentId: payment.paymentId, paymentUrl: payment.paymentUrl },
      }),
      prisma.orderEvent.create({
        data: {
          orderId: input.orderId,
          type: "PAYMENT_INITIATED",
          idempotencyKey: `payment-initiated:${input.attemptId}`,
          payload: { paymentAttemptId: input.attemptId, provider: "TBANK", providerOrderId: input.providerOrderId },
        },
      }),
    ]);
    return payment.paymentUrl;
  } catch (error) {
    // A successful provider response means money can still arrive. If only local
    // persistence failed, leave the attempt live and fail closed for reconciliation;
    // never label it FAILED or return customer benefits automatically.
    if (providerPayment) {
      console.error("[bot-payments] CRITICAL: provider Init succeeded but persistence failed", {
        orderId: input.publicOrderId,
        paymentIdHash: crypto.createHash("sha256").update(providerPayment.paymentId).digest("hex"),
        error,
      });
      throw error;
    }
    const errorHash = crypto.createHash("sha256").update(String(error)).digest("hex");
    await prisma.$transaction([
      prisma.paymentAttempt.updateMany({
        where: { id: input.attemptId, status: "INITIATED", paymentId: null },
        data: { status: "FAILED", rawEventHash: errorHash, finalizedAt: new Date() },
      }),
      prisma.orderEvent.create({
        data: {
          orderId: input.orderId,
          type: "PAYMENT_INIT_FAILED",
          idempotencyKey: `payment-init-failed:${input.attemptId}`,
          payload: { paymentAttemptId: input.attemptId, errorHash },
        },
      }),
    ]).catch(() => undefined);
    await revertWebOrderBenefits(input.orderId, "PAYMENT_INIT_FAILED").catch((revertError) => {
      console.error("[bot-payments] benefit compensation failed", { orderId: input.publicOrderId, revertError });
    });
    console.error("[bot-payments] T-Bank Init failed", { orderId: input.publicOrderId, errorHash });
    throw error;
  }
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  let authorized = false;
  try {
    authorized = verifyBotPaymentBody({
      timestamp: request.headers.get(BOT_PAYMENT_TIMESTAMP_HEADER),
      signature: request.headers.get(BOT_PAYMENT_SIGNATURE_HEADER),
      body: rawBody,
    });
  } catch {
    authorized = false;
  }
  if (!authorized) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let json: unknown = null;
  try { json = JSON.parse(rawBody || "null"); } catch { /* invalid payload below */ }
  const parsed = requestSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Некорректные параметры оплаты" }, { status: 400 });

  try {
    const manual = parsed.data.method === "MANUAL_TRANSFER" ? manualDetails() : null;
    const created = await createCanonicalBotOrder({
      ...parsed.data,
      manualConfigVersion: manual?.version,
    });
    if (!created.attempt) throw new Error("payment attempt missing");
    const expectedProvider = parsed.data.method === "MANUAL_TRANSFER" ? "MANUAL_TRANSFER" : "TBANK";
    if (created.attempt.provider !== expectedProvider) {
      return NextResponse.json({
        error: created.attempt.provider === "TBANK"
          ? "Для заказа уже создана безопасная оплата через Т‑Банк"
          : "Для заказа уже выбрана оплата по реквизитам",
      }, { status: 409 });
    }

    let currentAttempt = created.attempt;
    let currentStatusToken = created.statusToken;
    if (
      expectedProvider === "TBANK" &&
      ["FAILED", "REJECTED", "CANCELED"].includes(currentAttempt.status)
    ) {
      const retry = await createPaymentRetry({
        orderId: created.order.id,
        idempotencyKey: `bot-retry:${parsed.data.intentId}:${created.attemptCount + 1}`,
        receiptEmail: parsed.data.receiptEmail.toLowerCase(),
        statusToken: created.statusToken,
      });
      currentAttempt = retry.attempt;
      currentStatusToken = retry.statusToken;
    }
    const checkoutUrl = statusUrl(created.order.publicOrderId!, currentStatusToken);
    if (manual) {
      return NextResponse.json({
        ok: true,
        orderId: created.order.id,
        publicOrderId: created.order.publicOrderId,
        wbCode: created.order.wbCode,
        amountRobux: created.order.amount,
        amountKopecks: created.order.paymentAmountKopecks,
        method: parsed.data.method,
        statusUrl: checkoutUrl,
        manual: { bank: manual.bank, recipient: manual.recipient, phone: manual.phone },
        alreadyExists: created.alreadyExists,
      }, { status: created.alreadyExists ? 200 : 201 });
    }

    let paymentUrl = currentAttempt.paymentUrl;
    if (!paymentUrl && currentAttempt.status === "CREATED") {
      paymentUrl = await initializeAcquiring({
        orderId: created.order.id,
        publicOrderId: created.order.publicOrderId!,
        attemptId: currentAttempt.id,
        providerOrderId: currentAttempt.publicOrderId,
        amountKopecks: currentAttempt.amountKopecks,
        receiptEmail: created.order.receiptEmail!,
        statusToken: currentStatusToken,
      });
    }
    if (!paymentUrl) return NextResponse.json({ error: "Платёж уже обрабатывается" }, { status: 409 });

    return NextResponse.json({
      ok: true,
      orderId: created.order.id,
      publicOrderId: created.order.publicOrderId,
      wbCode: created.order.wbCode,
      amountRobux: created.order.amount,
      amountKopecks: created.order.paymentAmountKopecks,
      method: parsed.data.method as BotPaymentMethod,
      paymentUrl,
      statusUrl: checkoutUrl,
      alreadyExists: created.alreadyExists,
    }, { status: created.alreadyExists ? 200 : 201 });
  } catch (error) {
    if (error instanceof BotPaymentError) {
      // The expiry check happens inside the serializable create transaction. A thrown
      // domain error rolls that transaction back, so persist the terminal intent state
      // separately without touching an intent that another request already consumed.
      if (error.code === "EXPIRED") {
        await prisma.directIntent.updateMany({
          where: { id: parsed.data.intentId, status: "PENDING" },
          data: { status: "EXPIRED" },
        }).catch(() => undefined);
      }
      const status = error.code === "NOT_FOUND" ? 404 : error.code === "EXPIRED" ? 410 : error.code === "CONFIGURATION" ? 503 : 409;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }
    console.error("[bot-payments] create failed", error);
    return NextResponse.json({ error: "Не удалось подготовить оплату. Попробуй ещё раз." }, { status: 502 });
  }
}
