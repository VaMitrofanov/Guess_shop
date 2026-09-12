import { PriceQuoteStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  BONUS_MIN_PACK,
  CUSTOM_MAX,
  CUSTOM_MIN,
  directPrice,
  RETAIL_PRICING_POLICY_VERSION,
} from "@/lib/retail-pricing";

export const PRICE_QUOTE_TTL_MS = 15 * 60 * 1000;

export type QuoteCustomerBenefits = {
  balance?: number | null;
  bonusExpiresAt?: Date | null;
  rubleDiscount?: number | null;
};

export type CalculatedPriceQuote = {
  policyVersion: typeof RETAIL_PRICING_POLICY_VERSION;
  requestedRobux: number;
  bonusRobux: number;
  gamepassPriceRobux: number;
  baseAmountKopecks: number;
  discountKopecks: number;
  finalAmountKopecks: number;
};

/**
 * Calculates the complete customer-facing quote without I/O. Both the quote
 * endpoint and later order creation use this one function, so an authenticated
 * customer's bot bonus/discount cannot diverge from their web total.
 */
export function calculatePriceQuote(
  requestedRobux: number,
  customer?: QuoteCustomerBenefits | null,
  now = new Date(),
): CalculatedPriceQuote {
  if (!Number.isInteger(requestedRobux) || requestedRobux < CUSTOM_MIN || requestedRobux > CUSTOM_MAX) {
    throw new RangeError(`Robux amount must be an integer between ${CUSTOM_MIN} and ${CUSTOM_MAX}`);
  }

  const bonusIsActive = !!customer?.balance &&
    (!customer.bonusExpiresAt || customer.bonusExpiresAt > now);
  const bonusRobux = bonusIsActive && requestedRobux >= BONUS_MIN_PACK
    ? Math.max(0, customer.balance ?? 0)
    : 0;
  const baseAmountKopecks = Math.round(directPrice(requestedRobux) * 100);
  // The bot policy has no promo expiry gate: an operator removes the one-shot
  // discount at redemption. Keeping that rule here preserves channel parity.
  const discountKopecks = Math.min(baseAmountKopecks, Math.max(0, customer?.rubleDiscount ?? 0) * 100);

  return {
    policyVersion: RETAIL_PRICING_POLICY_VERSION,
    requestedRobux,
    bonusRobux,
    gamepassPriceRobux: Math.ceil((requestedRobux + bonusRobux) / 0.7),
    baseAmountKopecks,
    discountKopecks,
    finalAmountKopecks: baseAmountKopecks - discountKopecks,
  };
}

export async function createPriceQuote(requestedRobux: number, userId?: string | null) {
  const now = new Date();
  const [policy, customer] = await Promise.all([
    prisma.pricingPolicy.findFirst({
      where: {
        version: RETAIL_PRICING_POLICY_VERSION,
        isActive: true,
        validFrom: { lte: now },
        OR: [{ validUntil: null }, { validUntil: { gt: now } }],
      },
      select: { id: true, version: true },
    }),
    userId
      ? prisma.user.findUnique({
          where: { id: userId },
          select: { balance: true, bonusExpiresAt: true, rubleDiscount: true },
        })
      : Promise.resolve(null),
  ]);

  if (!policy) {
    throw new Error("The active retail pricing policy is unavailable");
  }

  const calculated = calculatePriceQuote(requestedRobux, customer, now);
  const expiresAt = new Date(now.getTime() + PRICE_QUOTE_TTL_MS);

  // U12: анонимную котировку невозможно потребить — `validateCheckoutQuote`
  // требует совпадения `quote.userId` с текущим пользователем. Раньше такие
  // строки всё равно писались в БД, и неаутентифицированный POST безлимитно
  // наливал `PriceQuote` в прод (ретенции для них не было). Теперь до логина
  // отдаём расчёт без записи.
  if (!userId) {
    return {
      quote: {
        id: null,
        expiresAt,
        userId: null,
        status: PriceQuoteStatus.ACTIVE,
      },
      calculated,
      persisted: false as const,
    };
  }

  const quote = await prisma.priceQuote.create({
    data: {
      userId: userId ?? null,
      policyId: policy.id,
      policyVersion: policy.version,
      requestedRobux: calculated.requestedRobux,
      bonusRobux: calculated.bonusRobux,
      baseAmountKopecks: calculated.baseAmountKopecks,
      discountKopecks: calculated.discountKopecks,
      finalAmountKopecks: calculated.finalAmountKopecks,
      status: PriceQuoteStatus.ACTIVE,
      expiresAt,
    },
  });

  return { quote, calculated, persisted: true as const };
}
