import { NextResponse } from "next/server";
import { CODE_DENOMINATIONS, CODE_DISCOUNT_TIERS, CODE_PRICES, quoteCode } from "@/lib/codes-pricing";
import { availableStock } from "@/lib/codes/stock";
import { codesSalesOpen } from "@/lib/codes/orders";
import { viewerCodeDiscount } from "@/lib/codes/referral";
import { claimReferralFromCookies, noStore, sessionUserId } from "@/lib/codes/http";
import { prisma } from "@/lib/prisma";
import { codesBackorderEnabled, codesInstantDelivery } from "@/lib/codes/fulfillment";
import { TG_CHANNEL_URL, VK_GROUP_URL } from "@/lib/codes/subscription";
import { codesHitDenomination } from "../../../../../bots/shared/codes-shop";

export const dynamic = "force-dynamic";

/**
 * Витрина кодов: номиналы, базовая цена, наличие (да/нет — не остаток) и
 * персональная скидка вошедшего. Цена, которую покажет интерфейс, — та же,
 * что сервер потом запишет в заказ.
 */
export async function GET() {
  const userId = await sessionUserId();
  if (userId) await claimReferralFromCookies(userId);
  const [stock, discount, account] = await Promise.all([
    availableStock().catch(() => new Map<number, number>()),
    viewerCodeDiscount(userId),
    userId ? prisma.user.findUnique({ where: { id: userId }, select: { email: true } }) : Promise.resolve(null),
  ]);
  const salesOpen = codesSalesOpen();
  const backorder = codesBackorderEnabled();
  return NextResponse.json({
    salesOpen,
    packs: CODE_DENOMINATIONS.map((denomination) => {
      const own = quoteCode(denomination, discount.percent);
      return {
        denomination,
        baseAmountKopecks: CODE_PRICES[denomination] * 100,
        finalAmountKopecks: own.finalAmountKopecks,
        signupAmountKopecks: quoteCode(denomination, 1).finalAmountKopecks,
        // Ручной режим: склад пуст, а купить можно — код выдадим после оплаты.
        available: salesOpen && (backorder || (stock.get(denomination) ?? 0) > 0),
      };
    }),
    viewer: {
      registered: discount.registered,
      hasEmail: Boolean(account?.email),
      discountPercent: discount.percent,
      invitedCount: discount.invitedCount,
      next: discount.progress?.next ?? null,
      subscribed: discount.subscription?.subscribed ?? false,
      subscriptionVia: discount.subscription?.via ?? null,
    },
    channels: { tg: TG_CHANNEL_URL, vk: VK_GROUP_URL },
    tiers: CODE_DISCOUNT_TIERS,
    hit: codesHitDenomination(),
    instant: codesInstantDelivery(),
  }, { headers: noStore });
}
