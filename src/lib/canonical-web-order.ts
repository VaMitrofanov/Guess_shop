import crypto from "crypto";
import { PriceQuoteStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { PRICE_TOL } from "@/lib/purchase-guard";
import { BONUS_REASONS, webOrderBonusKey } from "@/lib/bonus-ledger";

export const WEB_ORDER_TERMS_VERSION = "2026-04-28";
export const MIN_PAYMENT_KOPECKS = 1_000;

export class WebOrderError extends Error {
  constructor(
    public readonly code:
      | "QUOTE_NOT_FOUND"
      | "QUOTE_NOT_OWNED"
      | "QUOTE_UNAVAILABLE"
      | "QUOTE_EXPIRED"
      | "POLICY_MISMATCH"
      | "GAMEPASS_NOT_FOR_SALE"
      | "GAMEPASS_OWNER_MISMATCH"
      | "GAMEPASS_PRICE_MISMATCH"
      | "PAYMENT_TOO_SMALL",
    message: string,
  ) {
    super(message);
    this.name = "WebOrderError";
  }
}

type CheckoutQuote = {
  id: string;
  userId: string | null;
  status: PriceQuoteStatus;
  expiresAt: Date;
  policyVersion: string;
  requestedRobux: number;
  bonusRobux: number;
  discountKopecks: number;
  finalAmountKopecks: number;
  policy: { version: string };
};

type CheckoutGamepass = {
  price: number;
  creatorId: number;
  isActive: boolean;
};

export function expectedGamepassPrice(quote: Pick<CheckoutQuote, "requestedRobux" | "bonusRobux">) {
  return Math.ceil((quote.requestedRobux + quote.bonusRobux) / 0.7);
}

export function validateCheckoutQuote(quote: CheckoutQuote | null, userId: string, now = new Date()) {
  if (!quote) throw new WebOrderError("QUOTE_NOT_FOUND", "Котировка не найдена");
  if (quote.userId !== userId) {
    throw new WebOrderError("QUOTE_NOT_OWNED", "Обновите цену после входа в аккаунт");
  }
  if (quote.status !== PriceQuoteStatus.ACTIVE) {
    throw new WebOrderError("QUOTE_UNAVAILABLE", "Котировка уже использована или отменена");
  }
  if (quote.expiresAt <= now) {
    throw new WebOrderError("QUOTE_EXPIRED", "Срок котировки истёк — обновите цену");
  }
  if (quote.policyVersion !== quote.policy.version) {
    throw new WebOrderError("POLICY_MISMATCH", "Версия ценовой политики не совпадает");
  }
  if (!Number.isInteger(quote.discountKopecks) || quote.discountKopecks % 100 !== 0) {
    throw new WebOrderError("POLICY_MISMATCH", "Скидка в котировке имеет неверный формат");
  }
  if (quote.finalAmountKopecks < MIN_PAYMENT_KOPECKS) {
    throw new WebOrderError("PAYMENT_TOO_SMALL", "Итоговая сумма меньше минимальной суммы оплаты");
  }
  return quote;
}

export function validateCheckoutGamepass(
  quote: Pick<CheckoutQuote, "requestedRobux" | "bonusRobux">,
  gamepass: CheckoutGamepass,
  robloxUserId: number,
) {
  if (!gamepass.isActive) {
    throw new WebOrderError("GAMEPASS_NOT_FOR_SALE", "Геймпасс снят с продажи");
  }
  if (gamepass.creatorId !== robloxUserId) {
    throw new WebOrderError("GAMEPASS_OWNER_MISMATCH", "Геймпасс принадлежит другому Roblox-пользователю");
  }
  const expected = expectedGamepassPrice(quote);
  if (Math.abs(gamepass.price - expected) > PRICE_TOL) {
    throw new WebOrderError(
      "GAMEPASS_PRICE_MISMATCH",
      `Цена геймпасса должна быть ${expected} R$ (допуск ±${PRICE_TOL} R$)`,
    );
  }
  return expected;
}

function publicOrderId() {
  return `WEB-${crypto.randomBytes(10).toString("hex").toUpperCase()}`;
}

export function createStatusToken() {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashStatusToken(token: string) {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

type CreateCanonicalWebOrderInput = {
  quote: CheckoutQuote;
  userId: string;
  username: string;
  gamepassId: string;
  receiptEmail: string;
  idempotencyKey: string;
  termsIpAddress: string | null;
  termsUserAgent?: string | null;
  now?: Date;
};

/**
 * Consumes the quote and creates the canonical SITE order, payment attempt,
 * audit event and outbox row in one serializable transaction. No provider I/O
 * is performed here, so an external timeout can never leave a half-built order.
 */
export async function createCanonicalWebOrder(input: CreateCanonicalWebOrderInput) {
  const now = input.now ?? new Date();
  const publicId = publicOrderId();
  const rawStatusToken = createStatusToken();
  const tokenHash = hashStatusToken(rawStatusToken);

  const result = await prisma.$transaction(async (tx) => {
    const consumed = await tx.priceQuote.updateMany({
      where: {
        id: input.quote.id,
        userId: input.userId,
        status: PriceQuoteStatus.ACTIVE,
        expiresAt: { gt: now },
      },
      data: { status: PriceQuoteStatus.CONSUMED, consumedAt: now },
    });
    if (consumed.count !== 1) {
      throw new WebOrderError("QUOTE_UNAVAILABLE", "Котировка уже использована или истекла");
    }

    const discountRubles = Math.max(0, input.quote.discountKopecks) / 100;
    if (input.quote.bonusRobux > 0 || discountRubles > 0) {
      const currentBenefits = await tx.user.findUnique({
        where: { id: input.userId },
        select: { balance: true, rubleDiscount: true },
      });
      if (!currentBenefits) throw new WebOrderError("QUOTE_NOT_OWNED", "Профиль клиента не найден");
      if (input.quote.bonusRobux > currentBenefits.balance || discountRubles > currentBenefits.rubleDiscount) {
        throw new WebOrderError("QUOTE_UNAVAILABLE", "Бонус или скидка уже использованы — обновите цену");
      }
      const benefitsUpdated = await tx.user.updateMany({
        where: {
          id: input.userId,
          balance: currentBenefits.balance,
          rubleDiscount: currentBenefits.rubleDiscount,
        },
        data: {
          ...(input.quote.bonusRobux > 0 ? { balance: { decrement: input.quote.bonusRobux } } : {}),
          ...(discountRubles > 0 ? { rubleDiscount: 0 } : {}),
        },
      });
      if (benefitsUpdated.count !== 1) {
        throw new WebOrderError("QUOTE_UNAVAILABLE", "Бонус или скидка изменились — обновите цену");
      }
      if (input.quote.bonusRobux > 0) {
        // U3: списание идёт через единую точку — она же гарантирует запись в
        // леджер и идемпотентность. Баланс уже уменьшен `updateMany` выше
        // (там же атомарная проверка «бонус не изменился»), поэтому здесь
        // фиксируем только движение в журнале.
        await tx.bonusLedger.create({
          data: {
            userId: input.userId,
            deltaRobux: -input.quote.bonusRobux,
            balanceAfter: currentBenefits.balance - input.quote.bonusRobux,
            reason: BONUS_REASONS.WEB_ORDER_REDEMPTION,
            referenceId: input.quote.id,
            idempotencyKey: webOrderBonusKey(input.quote.id),
            metadata: { quoteId: input.quote.id },
          },
        });
      }
    }

    const order = await tx.wbOrder.create({
      data: {
        amount: input.quote.requestedRobux + input.quote.bonusRobux,
        gamepassUrl: `https://www.roblox.com/game-pass/${input.gamepassId}`,
        // U18: индексируемый ID — поиск заказа по геймпассу больше не идёт
        // через `gamepassUrl contains`, то есть без полного сканирования.
        gamepassId: input.gamepassId,
        status: "AWAITING_PAYMENT",
        platform: "WEB",
        userId: input.userId,
        wbCode: publicId,
        priceQuoteId: input.quote.id,
        publicOrderId: publicId,
        statusTokenHash: tokenHash,
        paymentAmountKopecks: input.quote.finalAmountKopecks,
        receiptEmail: input.receiptEmail,
        termsAcceptedAt: now,
        termsVersion: WEB_ORDER_TERMS_VERSION,
        termsIpAddress: input.termsIpAddress,
        termsUserAgent: input.termsUserAgent ?? null,
        // U3: фактически применённые бонус и скидка — без них компенсация при
        // неудачной оплате восстанавливала бы «примерно столько же».
        bonusAppliedRobux: input.quote.bonusRobux,
        discountAppliedKopecks: Math.max(0, input.quote.discountKopecks),
        webIdempotencyKey: input.idempotencyKey,
        isDirectOrder: true,
        orderSource: "SITE",
        robloxUsername: input.username,
        probableNick: input.username,
        probableNickAt: now,
      },
    });

    const attempt = await tx.paymentAttempt.create({
      data: {
        orderId: order.id,
        provider: "TBANK",
        publicOrderId: publicId,
        amountKopecks: input.quote.finalAmountKopecks,
        idempotencyKey: `tbank:init:${input.idempotencyKey}`,
      },
    });

    const event = await tx.orderEvent.create({
      data: {
        orderId: order.id,
        type: "WEB_ORDER_CREATED",
        idempotencyKey: `web-order-created:${order.id}`,
        payload: {
          publicOrderId: publicId,
          quoteId: input.quote.id,
          amountRobux: order.amount,
          amountKopecks: input.quote.finalAmountKopecks,
          bonusRobux: input.quote.bonusRobux,
          discountKopecks: input.quote.discountKopecks,
        },
      },
    });

    await tx.outboxMessage.create({
      data: {
        eventId: event.id,
        topic: "web.order.created",
        payload: { orderId: order.id, publicOrderId: publicId },
      },
    });

    return { order, attempt };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  return { ...result, statusToken: rawStatusToken };
}
