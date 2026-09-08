import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { BONUS_REASONS, applyBonusDeltaTx, directOrderBonusKey } from "@/lib/bonus-ledger";
import { hashStatusToken } from "@/lib/canonical-web-order";
import { deterministicBotPublicOrderId, deterministicBotStatusToken } from "@/lib/bot-payment-auth";
import { getGamepassById } from "@/lib/roblox";
import { expectedGamepassPrice } from "../../bots/shared/gamepass-plan";
import { passFitsAmount } from "../../bots/shared/direct-requote";

export const BOT_ORDER_TERMS_VERSION = "2026-08-09";
export const DIRECT_INTENT_TTL_MS = 24 * 60 * 60_000;

export type BotPaymentMethod = "SITE" | "BOT_ACQUIRING" | "MANUAL_TRANSFER";
export type BotPlatform = "TG" | "VK";

export class BotPaymentError extends Error {
  constructor(
    public readonly code: "NOT_FOUND" | "ALREADY_PROCESSED" | "EXPIRED" | "BENEFITS_CHANGED" | "CONFIGURATION" | "GAMEPASS_CHANGED",
    message: string,
  ) {
    super(message);
    this.name = "BotPaymentError";
  }
}

function directCode() {
  return `DIR-${crypto.randomBytes(6).toString("hex").slice(0, 8).toUpperCase()}`;
}

function actorMatches(intent: { platform: BotPlatform; user: { tgId: string | null; vkId: string | null } }, platform: BotPlatform, subject: string) {
  return intent.platform === platform && (platform === "TG" ? intent.user.tgId === subject : intent.user.vkId === subject);
}

export async function findExistingBotOrder(intentId: string, platform: BotPlatform, subject: string) {
  const order = await prisma.wbOrder.findUnique({
    where: { webIdempotencyKey: `direct-intent:${intentId}` },
    include: {
      user: { select: { tgId: true, vkId: true } },
      paymentAttempts: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!order) return null;
  const owns = platform === "TG" ? order.user.tgId === subject : order.user.vkId === subject;
  if (!owns || order.platform !== platform) throw new BotPaymentError("NOT_FOUND", "Заявка не найдена");
  return order;
}

/**
 * Пасс заявки всё ещё тот, за который человек собирается платить?
 *
 * Бросает `GAMEPASS_CHANGED` с текстом для покупателя. Молчит (пропускает),
 * только если Roblox недоступен: отказывать в оплате из-за нашей недоступности
 * нельзя — на этот случай остаётся прайс-гард выкупа.
 */
async function assertIntentGamepassStillValid(intentId: string, platform: BotPlatform, subject: string) {
  const intent = await prisma.directIntent.findUnique({
    where: { id: intentId },
    include: { user: { select: { tgId: true, vkId: true } } },
  });
  if (!intent || !actorMatches(intent as never, platform, subject)) return;
  const gamepassId = intent.gamepassId ?? intent.gamepassUrl?.match(/game-pass(?:es)?\/(\d+)/)?.[1];
  if (!gamepassId) return;

  const pass = await getGamepassById(String(gamepassId)).catch(() => null);
  // Roblox молчит — не наш повод не пускать оплату.
  if (!pass || !pass.price) return;

  if (pass.isForSale === false) {
    throw new BotPaymentError("GAMEPASS_CHANGED", "Геймпасс снят с продажи — включи «Item for sale» и оформи заказ заново");
  }
  if (!passFitsAmount(pass.price, intent.totalAmount)) {
    const need = expectedGamepassPrice(intent.totalAmount);
    throw new BotPaymentError(
      "GAMEPASS_CHANGED",
      `Цена геймпасса изменилась: сейчас ${pass.price} R$, а для ${intent.totalAmount} R$ нужен пасс на ${need} R$. Поправь цену и оформи заказ заново`,
    );
  }
  if (intent.robloxUsername && pass.creatorName
      && pass.creatorName.toLowerCase() !== intent.robloxUsername.toLowerCase()) {
    throw new BotPaymentError("GAMEPASS_CHANGED", "Геймпасс принадлежит другому аккаунту Roblox — оформи заказ заново со своим");
  }

  /* Уже выкупленный нами пасс второй раз не продаётся: Roblox ответит
     `AlreadyOwned`, а другой донор заплатил бы за то, что у нас уже есть.
     Клиент Kratos01395 привязал к заказу на 200 R$ пасс, купленный нами
     четырьмя днями раньше по другому заказу (08.09.2026). */
  const reused = await prisma.wbOrder.findFirst({
    where: { gamepassId: String(gamepassId), status: "COMPLETED", isTest: false },
    select: { wbCode: true },
  }).catch(() => null);
  if (reused) {
    throw new BotPaymentError(
      "GAMEPASS_CHANGED",
      "Этот геймпасс уже выкуплен по прошлому заказу — создай новый и оформи заказ заново",
    );
  }
}

export async function createCanonicalBotOrder(input: {
  intentId: string;
  platform: BotPlatform;
  subject: string;
  receiptEmail: string;
  method: BotPaymentMethod;
  manualConfigVersion?: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const publicOrderId = deterministicBotPublicOrderId(input.intentId);
  const statusToken = deterministicBotStatusToken(input.intentId);
  const statusTokenHash = hashStatusToken(statusToken);

  const existing = await findExistingBotOrder(input.intentId, input.platform, input.subject);
  if (existing) return { order: existing, attempt: existing.paymentAttempts[0], attemptCount: existing.paymentAttempts.length, statusToken, alreadyExists: true };

  /* Пасс перепроверяется ПЕРЕД созданием заказа — тем же правилом, что и на
     сайте (`validateCheckoutGamepass`). До 08.09.2026 бот копировал пасс из
     заявки как есть: ни цены, ни владельца, ни «в продаже». Заявка живёт до
     суток, и за это время цену можно поднять — ровно этот вектор закрывал
     прайс-гард выкупа, но там он срабатывает, когда деньги уже приняты.
     Проверка стоит до транзакции: ходить в Roblox из неё нельзя. */
  await assertIntentGamepassStillValid(input.intentId, input.platform, input.subject);

  const result = await prisma.$transaction(async (tx) => {
    const intent = await tx.directIntent.findUnique({
      where: { id: input.intentId },
      include: { user: { select: { id: true, tgId: true, vkId: true, rubleDiscount: true } } },
    });
    if (!intent || !actorMatches(intent as never, input.platform, input.subject)) {
      throw new BotPaymentError("NOT_FOUND", "Заявка не найдена");
    }
    if (intent.status !== "PENDING") throw new BotPaymentError("ALREADY_PROCESSED", "Заявка уже обработана");
    if (now.getTime() - intent.createdAt.getTime() > DIRECT_INTENT_TTL_MS) {
      await tx.directIntent.update({ where: { id: intent.id }, data: { status: "EXPIRED" } });
      throw new BotPaymentError("EXPIRED", "Заявка просрочена — оформи новую");
    }

    const consumed = await tx.directIntent.updateMany({
      where: { id: intent.id, status: "PENDING" },
      data: { status: "CONSUMED" },
    });
    if (consumed.count !== 1) throw new BotPaymentError("ALREADY_PROCESSED", "Заявка уже обрабатывается");

    const order = await tx.wbOrder.create({
      data: {
        amount: intent.totalAmount,
        gamepassUrl: intent.gamepassUrl,
        gamepassId: intent.gamepassId,
        robloxUsername: intent.robloxUsername,
        probableNick: intent.robloxUsername,
        probableNickAt: now,
        status: input.method === "MANUAL_TRANSFER" ? "PAYMENT_PENDING" : "AWAITING_PAYMENT",
        platform: input.platform,
        userId: intent.userId,
        wbCode: directCode(),
        publicOrderId,
        statusTokenHash,
        paymentAmountKopecks: intent.rublePrice * 100,
        receiptEmail: input.receiptEmail.toLowerCase(),
        termsAcceptedAt: now,
        termsVersion: BOT_ORDER_TERMS_VERSION,
        termsUserAgent: `BOT/${input.platform}`,
        bonusAppliedRobux: intent.bonus,
        discountAppliedKopecks: intent.rubleDiscount * 100,
        webIdempotencyKey: `direct-intent:${intent.id}`,
        isDirectOrder: true,
        orderSource: "DIRECT",
        saleAmountKopecks: intent.rublePrice * 100,
        paymentDetails: input.method === "MANUAL_TRANSFER"
          ? `MANUAL_TRANSFER:${input.manualConfigVersion ?? "unversioned"}`
          : null,
      },
    });

    if (intent.bonus > 0) {
      const bonus = await applyBonusDeltaTx(tx, {
        userId: intent.userId,
        deltaRobux: -intent.bonus,
        reason: BONUS_REASONS.DIRECT_ORDER_REDEMPTION,
        referenceId: order.id,
        idempotencyKey: directOrderBonusKey(order.id),
        metadata: { intentId: intent.id, platform: input.platform },
      });
      if (!bonus.applied && bonus.reason === "insufficient") {
        throw new BotPaymentError("BENEFITS_CHANGED", "Бонус изменился — оформи заявку заново");
      }
      await tx.user.update({
        where: { id: intent.userId },
        data: { reviewBonusGrantedAt: null, bonusExpiresAt: null, reviewReminderLevel: 0 },
      });
    }
    if (intent.rubleDiscount > 0) {
      const discount = await tx.user.updateMany({
        where: { id: intent.userId, rubleDiscount: { gte: intent.rubleDiscount } },
        data: { rubleDiscount: { decrement: intent.rubleDiscount } },
      });
      if (discount.count !== 1) throw new BotPaymentError("BENEFITS_CHANGED", "Скидка изменилась — оформи заявку заново");
    }

    const provider = input.method === "MANUAL_TRANSFER" ? "MANUAL_TRANSFER" : "TBANK";
    const attempt = await tx.paymentAttempt.create({
      data: {
        orderId: order.id,
        provider,
        publicOrderId: input.method === "MANUAL_TRANSFER" ? `${publicOrderId}-M1` : publicOrderId,
        amountKopecks: intent.rublePrice * 100,
        idempotencyKey: `${provider.toLowerCase()}:intent:${intent.id}`,
        status: input.method === "MANUAL_TRANSFER" ? "INITIATED" : "CREATED",
        initiatedAt: input.method === "MANUAL_TRANSFER" ? now : null,
      },
    });

    await tx.consentEvidence.create({
      data: {
        userId: intent.userId,
        type: "ORDER_TERMS_AND_PRIVACY",
        documentVersion: BOT_ORDER_TERMS_VERSION,
        source: `BOT_${input.platform}`,
        userAgent: `BOT/${input.platform}`,
      },
    });
    const event = await tx.orderEvent.create({
      data: {
        orderId: order.id,
        type: "BOT_ORDER_CREATED",
        idempotencyKey: `bot-order-created:${intent.id}`,
        payload: { intentId: intent.id, platform: input.platform, method: input.method, provider },
      },
    });
    await tx.outboxMessage.create({
      data: {
        eventId: event.id,
        topic: "bot.order.created",
        payload: { orderId: order.id, publicOrderId, platform: input.platform, method: input.method },
      },
    });
    return { order, attempt };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  return { ...result, attemptCount: 1, statusToken, alreadyExists: false };
}
