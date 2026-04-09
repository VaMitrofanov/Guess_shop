import { prisma } from "@/lib/prisma";

export interface PricingData {
  rateUSD: number;
  usdToRub: number;
  finalRubPerRobux: number;
  provider: string;
  inventory: number;
  maxLimit: number;
}

const ROBLOX_TAX        = 0.30; // Roblox takes 30% commission on gamepass sales
const CONVERSION_MARKUP = 0.01; // +1% currency conversion correction
const MARGIN_MARKUP     = 0.10; // +10% our net margin

/**
 * Calculates the final RUB price per 1 NET (clean) Robux.
 *
 * Supplier sells GROSS robux. After Roblox 30% gamepass tax,
 * the buyer only receives 70% of the gross amount.
 *
 * Formula:
 *   netRobux        = 1000 * (1 - 0.30) = 700
 *   rubCostPerUnit  = rateUSD * usdToRub        (cost to buy 1000 gross R$)
 *   rubPerNetRobux  = rubCostPerUnit / 700       (cost per 1 clean R$)
 *   withConversion  = rubPerNetRobux * 1.01
 *   final           = withConversion * 1.10
 *
 * Example: rateUSD=4.3, usdToRub=80.2
 *   rubCostPerUnit = 344.86 RUB
 *   rubPerNetRobux = 344.86 / 700 = 0.493
 *   withConversion = 0.498
 *   final          = 0.547 RUB per clean R$
 *   → 1000 clean R$ ≈ 547 RUB
 */
export function calcFinalRubPerRobux(rateUSD: number, usdToRub: number): number {
  if (rateUSD <= 0 || usdToRub <= 0) return 0;

  const netRobuxPerUnit = 1000 * (1 - ROBLOX_TAX); // 700 net robux
  const rubCostPerUnit  = rateUSD * usdToRub;        // RUB cost for 1000 gross R$
  const rubPerNetRobux  = rubCostPerUnit / netRobuxPerUnit;
  const withConversion  = rubPerNetRobux * (1 + CONVERSION_MARKUP);
  const final           = withConversion * (1 + MARGIN_MARKUP);

  return Math.round(final * 100) / 100;
}

/**
 * Loads the best available market rate from DB and returns
 * the computed storefront price per 1 clean Robux.
 *
 * Retries once on ETIMEDOUT to handle Neon cold-start (free tier
 * suspends the DB after ~5 min of inactivity).
 */
export async function getStorefrontPricing(minInventory = 100): Promise<PricingData> {
  const DEFAULT_RATE_RUB = 0.65;
  const FALLBACK: PricingData = {
    rateUSD: 0, usdToRub: 90,
    finalRubPerRobux: DEFAULT_RATE_RUB,
    provider: "error-fallback", inventory: 0, maxLimit: 0,
  };

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const [rates, settings] = await Promise.all([
        prisma.marketRate.findMany({
          where: { inventory: { gte: minInventory } },
          orderBy: { rateUSD: "asc" },
        }),
        prisma.globalSettings.findUnique({ where: { id: "global" } }),
      ]);

      const usdToRub = settings?.usdToRub ?? 90.0;

      if (rates.length === 0) {
        return {
          rateUSD: 0, usdToRub,
          finalRubPerRobux: DEFAULT_RATE_RUB,
          provider: "fallback", inventory: 0, maxLimit: 0,
        };
      }

      const best = rates[0];
      return {
        rateUSD: best.rateUSD,
        usdToRub,
        finalRubPerRobux: calcFinalRubPerRobux(best.rateUSD, usdToRub),
        provider: best.provider,
        inventory: best.inventory,
        maxLimit: best.maxLimit,
      };

    } catch (err: any) {
      const isTimeout =
        err?.code === "ETIMEDOUT" ||
        err?.message?.includes("timeout") ||
        err?.message?.includes("ETIMEDOUT");

      if (isTimeout && attempt < 2) {
        console.warn("[Pricing] Neon cold-start timeout, retrying in 1.5s...");
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }

      console.error(`[Pricing] DB error (attempt ${attempt}):`, err);
      return FALLBACK;
    }
  }

  return FALLBACK;
}

/**
 * Calculate total RUB cost for a given amount of clean Robux.
 * Used by API routes and the frontend calculator.
 */
export function calculateOrderPrice(amountRobux: number, rubPerRobux: number): number {
  if (amountRobux <= 0 || rubPerRobux <= 0) return 0;
  return Math.round(amountRobux * rubPerRobux);
}