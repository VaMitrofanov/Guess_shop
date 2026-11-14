import crypto from "node:crypto";
import { Prisma, type CodeOrder, type CodePayment } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isSiteAcquiringEnabled } from "@/lib/site-acquiring";
import { initCanonicalTinkoffPayment } from "@/lib/tinkoff";
import { isCodeDenomination, quoteCode, type CodeQuote } from "@/lib/codes-pricing";
import { viewerCodeDiscount } from "@/lib/codes/referral";
import { hasStock, reserveCodeForOrder } from "@/lib/codes/stock";
import { activationCryptoReady, hashPayToken, maskEmail, newCodeOrderPublicId } from "@/lib/codes/secrets";
import { codesBackorderEnabled } from "@/lib/codes/fulfillment";
import { giftOpenTokenFor, hashGiftToken, type GiftInput, type GiftTheme } from "@/lib/codes/gift";

/**
 * Заказ кода активации на сайте (14.11.2026).
 *
 * Сервер — единственный, кто считает цену: номинал, базовая цена, скидка
 * создателя заказа и итог в копейках фиксируются в заказе при создании и
 * больше не пересчитываются молча. Платёжная ссылка — неперебираемый токен,
 * открывший её человек не может поменять ни товар, ни сумму, ни получателя.
 */

export const CODE_OFFER_TTL_MS = 24 * 60 * 60 * 1000;
export const CODES_TERMS_VERSION = "2026-11-14-codes";
/** INITIATED-сессию банка моложе этого возраста отдаём повторно, не создавая новую. */
const REUSE_PAYMENT_MS = 30 * 60 * 1000;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://robloxbank.ru";

export class CodeOrderError extends Error {
  constructor(
    public readonly code:
      | "SALES_CLOSED"
      | "BAD_DENOMINATION"
      | "EMAIL_REQUIRED"
      | "RECEIPT_EMAIL_REQUIRED"
      | "OUT_OF_STOCK"
      | "OFFER_EXPIRED"
      | "ALREADY_PAID"
      | "PAYMENT_IN_PROGRESS"
      | "NOT_FOUND"
      | "IDEMPOTENCY_CONFLICT"
      | "BANK_UNAVAILABLE",
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

/** Продажа кодов: отдельный флаг поверх аварийного выключателя эквайринга. */
export function codesSalesOpen(): boolean {
  return process.env.CODES_SALES_ENABLED === "true" && isSiteAcquiringEnabled() && activationCryptoReady();
}

function tokenSecret(): string {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is required for code payment links");
  return secret;
}

/**
 * Токен ссылки выводится из id заказа и серверного секрета (256 бит HMAC):
 * создатель может снова получить ту же ссылку (повтор запроса, кабинет), а без
 * секрета её не подобрать. В базе — только хеш.
 */
export function payTokenFor(orderId: string): string {
  return crypto.createHmac("sha256", tokenSecret()).update(`code-pay-link:v1:${orderId}`).digest("base64url");
}

export function payUrlFor(orderId: string): string {
  return `${APP_URL}/pay/${payTokenFor(orderId)}`;
}

function normalizeEmail(email: string | null | undefined): string | null {
  const value = email?.trim().toLowerCase();
  return value ? value : null;
}

async function quoteFor(denomination: number, userId: string | null): Promise<CodeQuote> {
  const discount = await viewerCodeDiscount(userId);
  return quoteCode(denomination, discount.percent);
}

export type CodeOrderChannel = "SITE" | "TG" | "VK";

export type CreateCodeOrderInput = {
  denomination: number;
  userId: string | null;
  recipientEmail?: string | null;
  createdVia: "SELF" | "SHARE";
  idempotencyKey: string;
  /** Подарок открыткой: код уходит получателю, а не создателю. */
  gift?: GiftInput | null;
  /** Где оформлен заказ; TG/VK получают код ещё и сообщением в чат. */
  channel?: CodeOrderChannel;
};

export async function createCodeOrder(input: CreateCodeOrderInput): Promise<{ order: CodeOrder; token: string; reused: boolean }> {
  if (!codesSalesOpen()) throw new CodeOrderError("SALES_CLOSED", "Продажа кодов откроется совсем скоро.", 503);
  if (!isCodeDenomination(input.denomination)) throw new CodeOrderError("BAD_DENOMINATION", "Такого номинала нет.");
  const gift = input.gift ?? null;
  const recipientEmail = gift ? normalizeEmail(gift.email) : input.userId ? null : normalizeEmail(input.recipientEmail);
  if (!input.userId && !recipientEmail) throw new CodeOrderError("EMAIL_REQUIRED", "Укажите email, на который отправить код.");
  if (gift && !recipientEmail) throw new CodeOrderError("EMAIL_REQUIRED", "Укажите почту получателя подарка.");

  const existing = await prisma.codeOrder.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) {
    const same = existing.denomination === input.denomination
      && existing.creatorUserId === input.userId
      && existing.recipientEmail === recipientEmail;
    if (!same) throw new CodeOrderError("IDEMPOTENCY_CONFLICT", "Этот запрос уже использован. Обновите страницу.", 409);
    return { order: existing, token: payTokenFor(existing.id), reused: true };
  }

  // Ручной режим (15.11.2026): пустой склад не мешает продаже — код выдаём
  // руками после оплаты (`src/lib/codes/fulfillment.ts`).
  if (!codesBackorderEnabled() && !(await hasStock(input.denomination))) {
    throw new CodeOrderError("OUT_OF_STOCK", "Коды этого номинала закончились. Выберите другой номинал — пополним склад в ближайшее время.", 409);
  }

  const quote = await quoteFor(input.denomination, input.userId);
  const id = `co${crypto.randomBytes(12).toString("hex")}`;
  const token = payTokenFor(id);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const order = await prisma.codeOrder.create({
        data: {
          id,
          publicId: newCodeOrderPublicId(),
          denomination: quote.denomination,
          pricingVersion: quote.policyVersion,
          baseAmountKopecks: quote.baseAmountKopecks,
          discountPercent: quote.discountPercent,
          discountKopecks: quote.discountKopecks,
          finalAmountKopecks: quote.finalAmountKopecks,
          creatorUserId: input.userId,
          deliveryMode: gift ? "GIFT" : input.userId ? "ACCOUNT" : "EMAIL",
          recipientEmail,
          channel: input.channel ?? "SITE",
          ...(gift ? {
            giftTheme: gift.theme,
            giftTo: gift.to,
            giftFrom: gift.from,
            giftMessage: gift.message,
            giftSendAt: gift.sendAt,
            giftOpenTokenHash: hashGiftToken(giftOpenTokenFor(id)),
          } : {}),
          payTokenHash: hashPayToken(token),
          createdVia: input.createdVia,
          offerExpiresAt: new Date(Date.now() + CODE_OFFER_TTL_MS),
          idempotencyKey: input.idempotencyKey,
          events: {
            create: {
              type: "CREATED",
              idempotencyKey: `code-created:${id}`,
              payload: { via: input.createdVia, discountPercent: quote.discountPercent, finalAmountKopecks: quote.finalAmountKopecks },
            },
          },
        },
      });
      return { order, token, reused: false };
    } catch (error) {
      // Коллизия publicId (32^8) — просто берём другой номер.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" && attempt < 2) {
        const again = await prisma.codeOrder.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
        if (again) return { order: again, token: payTokenFor(again.id), reused: true };
        continue;
      }
      throw error;
    }
  }
  throw new Error("unreachable");
}

export async function findCodeOrderByToken(token: string) {
  return prisma.codeOrder.findUnique({
    where: { payTokenHash: hashPayToken(token) },
    include: {
      payments: { orderBy: { createdAt: "desc" } },
      creator: { select: { email: true, emailVerifiedAt: true } },
    },
  });
}

type OrderWithPayments = CodeOrder & { payments: CodePayment[]; creator?: { email: string | null; emailVerifiedAt: Date | null } | null };

export function offerExpired(order: Pick<CodeOrder, "offerExpiresAt" | "paidAt">, now = new Date()): boolean {
  return !order.paidAt && order.offerExpiresAt.getTime() <= now.getTime();
}

/** Адрес для чека по умолчанию: гостю — его email, клиенту — почта аккаунта. */
export function defaultReceiptEmail(order: OrderWithPayments): string | null {
  // Подарок: адрес получателя — не для чека, иначе сюрприз раскроется письмом банка.
  if (order.deliveryMode === "GIFT") return order.creator?.email ?? null;
  return order.recipientEmail ?? order.creator?.email ?? null;
}

/**
 * Переход к оплате: проверка срока и склада, резерв кода, платёжная сессия
 * банка. Сумма — ТОЛЬКО из заказа.
 */
export async function startCodePayment(order: OrderWithPayments, receiptEmailInput: string | null): Promise<{ paymentUrl: string; reused: boolean }> {
  if (!codesSalesOpen()) throw new CodeOrderError("SALES_CLOSED", "Оплата временно недоступна. Попробуйте чуть позже.", 503);
  if (order.paidAt || order.status === "ISSUED" || order.status === "PAID" || order.status === "REFUNDED") {
    throw new CodeOrderError("ALREADY_PAID", "Этот заказ уже оплачен.", 409);
  }
  if (offerExpired(order)) {
    throw new CodeOrderError("OFFER_EXPIRED", "Срок предложения истёк — подтвердите обновлённый заказ.", 410);
  }
  const receiptEmail = normalizeEmail(receiptEmailInput) ?? defaultReceiptEmail(order);
  if (!receiptEmail) throw new CodeOrderError("RECEIPT_EMAIL_REQUIRED", "Укажите email для чека.");

  const now = Date.now();
  if (order.payments.some((payment) => payment.status === "AUTHORIZED" || payment.status === "CONFIRMED")) {
    throw new CodeOrderError("PAYMENT_IN_PROGRESS", "Платёж уже проходит. Обновите страницу через минуту.", 409);
  }
  const reusable = order.payments.find((payment) =>
    payment.status === "INITIATED"
    && payment.paymentUrl
    && payment.receiptEmail === receiptEmail
    && payment.amountKopecks === order.finalAmountKopecks
    && now - payment.createdAt.getTime() < REUSE_PAYMENT_MS);
  if (reusable?.paymentUrl) {
    await reserveCodeForOrder(prisma, order.id, order.denomination);
    return { paymentUrl: reusable.paymentUrl, reused: true };
  }
  const backorder = codesBackorderEnabled();

  const attemptNumber = order.payments.length + 1;
  const payment = await prisma.$transaction(async (tx) => {
    const reserved = await reserveCodeForOrder(tx, order.id, order.denomination);
    if (!reserved && !backorder) throw new CodeOrderError("OUT_OF_STOCK", "Коды этого номинала только что закончились. Выберите другой номинал или попробуйте позже.", 409);
    return tx.codePayment.create({
      data: {
        orderId: order.id,
        providerOrderId: `${order.publicId}-${attemptNumber}`,
        amountKopecks: order.finalAmountKopecks,
        receiptEmail,
        idempotencyKey: `code-pay:${order.id}:${attemptNumber}`,
      },
    });
  });

  const token = payTokenFor(order.id);
  let init: { paymentId: string; paymentUrl: string };
  try {
    init = await initCanonicalTinkoffPayment({
      publicOrderId: order.publicId,
      providerOrderId: payment.providerOrderId,
      amountKopecks: payment.amountKopecks,
      receiptEmail,
      description: `Код Roblox ${order.denomination} R$ · ${order.publicId}`,
      statusToken: "",
      successUrl: `${APP_URL}/pay/${token}?result=success`,
      failUrl: `${APP_URL}/pay/${token}?result=fail`,
    });
  } catch (error) {
    const errorHash = crypto.createHash("sha256").update(String(error)).digest("hex");
    await prisma.codePayment.update({ where: { id: payment.id }, data: { status: "FAILED", rawEventHash: errorHash, finalizedAt: new Date() } });
    console.error("[codes] T-Bank Init failed", { order: order.publicId, errorHash });
    throw new CodeOrderError("BANK_UNAVAILABLE", "Банк временно не создал платёж. Нажмите «Оплатить» ещё раз — заказ сохранён.", 502);
  }

  await prisma.codePayment.update({
    where: { id: payment.id },
    data: { paymentId: init.paymentId, paymentUrl: init.paymentUrl, status: "INITIATED", initiatedAt: new Date() },
  });
  await prisma.codeOrder.update({
    where: { id: order.id },
    data: {
      status: "PAYMENT_PENDING",
      ...(order.termsAcceptedAt ? {} : { termsAcceptedAt: new Date(), termsVersion: CODES_TERMS_VERSION }),
      events: {
        create: { type: "PAYMENT_INITIATED", idempotencyKey: `code-pay-init:${payment.id}`, payload: { attempt: attemptNumber } },
      },
    },
  });
  return { paymentUrl: init.paymentUrl, reused: false };
}

/**
 * Просроченное предложение подтверждается заново ЯВНЫМ действием: цена
 * пересчитывается по скидке СОЗДАТЕЛЯ заказа (гость — без скидки), а не того,
 * кто открыл ссылку.
 */
export async function refreshCodeOffer(order: OrderWithPayments): Promise<void> {
  if (order.paidAt) throw new CodeOrderError("ALREADY_PAID", "Этот заказ уже оплачен.", 409);
  if (!offerExpired(order)) return;
  if (!codesSalesOpen()) throw new CodeOrderError("SALES_CLOSED", "Продажа кодов временно закрыта.", 503);
  const quote = await quoteFor(order.denomination, order.creatorUserId);
  await prisma.codeOrder.update({
    where: { id: order.id },
    data: {
      pricingVersion: quote.policyVersion,
      baseAmountKopecks: quote.baseAmountKopecks,
      discountPercent: quote.discountPercent,
      discountKopecks: quote.discountKopecks,
      finalAmountKopecks: quote.finalAmountKopecks,
      offerExpiresAt: new Date(Date.now() + CODE_OFFER_TTL_MS),
      status: "AWAITING_PAYMENT",
      events: {
        create: {
          type: "OFFER_REFRESHED",
          idempotencyKey: `code-refresh:${order.id}:${Date.now()}`,
          payload: { from: order.finalAmountKopecks, to: quote.finalAmountKopecks, discountPercent: quote.discountPercent },
        },
      },
    },
  });
}

export type PublicPaymentState = "none" | "pending" | "failed";

export type PublicCodeOrder = {
  publicId: string;
  denomination: number;
  baseAmountKopecks: number;
  discountPercent: number;
  discountKopecks: number;
  finalAmountKopecks: number;
  deliveryMode: "EMAIL" | "ACCOUNT" | "GIFT";
  channel: CodeOrderChannel;
  maskedRecipient: string | null;
  gift: { theme: GiftTheme; to: string | null; sendAt: string | null; sent: boolean } | null;
  rating: number | null;
  /** Ссылку отправили другому человеку (родителю) — страница говорит с ним. */
  sharedLink: boolean;
  status: "AWAITING_PAYMENT" | "PAYMENT_PENDING" | "PAID" | "ISSUED" | "REFUNDED";
  expired: boolean;
  offerExpiresAt: string;
  paymentState: PublicPaymentState;
  emailSent: boolean;
  needsReceiptEmail: boolean;
  defaultReceiptMasked: string | null;
  quoteIfRefreshed: { finalAmountKopecks: number; discountPercent: number } | null;
};

/** Всё, что безопасно показать по общей ссылке: ни кода, ни полного адреса, ни имени создателя. */
export async function publicCodeOrderView(order: OrderWithPayments): Promise<PublicCodeOrder> {
  const latest = order.payments[0];
  const paymentState: PublicPaymentState = !latest
    ? "none"
    : latest.status === "REJECTED" || latest.status === "CANCELED" || latest.status === "FAILED"
      ? "failed"
      : latest.status === "INITIATED" || latest.status === "AUTHORIZED" || latest.status === "CREATED"
        ? "pending"
        : "none";
  const expired = offerExpired(order);
  const receipt = defaultReceiptEmail(order);
  let quoteIfRefreshed: PublicCodeOrder["quoteIfRefreshed"] = null;
  if (expired) {
    const quote = await quoteFor(order.denomination, order.creatorUserId);
    quoteIfRefreshed = { finalAmountKopecks: quote.finalAmountKopecks, discountPercent: quote.discountPercent };
  }
  return {
    publicId: order.publicId,
    denomination: order.denomination,
    baseAmountKopecks: order.baseAmountKopecks,
    discountPercent: order.discountPercent,
    discountKopecks: order.discountKopecks,
    finalAmountKopecks: order.finalAmountKopecks,
    deliveryMode: order.deliveryMode,
    channel: (order.channel === "TG" || order.channel === "VK" ? order.channel : "SITE"),
    maskedRecipient: order.deliveryMode === "EMAIL" || order.deliveryMode === "GIFT" ? maskEmail(order.recipientEmail) : null,
    gift: order.deliveryMode === "GIFT" && order.giftTheme
      ? {
          theme: order.giftTheme as GiftTheme,
          to: order.giftTo,
          sendAt: order.giftSendAt ? order.giftSendAt.toISOString() : null,
          sent: Boolean(order.giftSentAt),
        }
      : null,
    rating: order.rating,
    sharedLink: order.createdVia === "SHARE",
    status: order.status,
    expired,
    offerExpiresAt: order.offerExpiresAt.toISOString(),
    paymentState,
    emailSent: Boolean(order.emailSentAt),
    needsReceiptEmail: !receipt,
    defaultReceiptMasked: maskEmail(receipt),
    quoteIfRefreshed,
  };
}
