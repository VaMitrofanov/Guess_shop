import { prisma } from "@/lib/prisma";

/**
 * «Пульс» витрины 2.0 (15.11.2026): лента «Выдано сегодня», честный счётчик и
 * отзывы с Wildberries.
 *
 * Правила владельца (docs/storefront-2-plan.md, п. 6–7):
 * - в ленте только НАСТОЯЩИЕ выдачи на сайте (коды, подарки, геймпасс);
 *   строки WB не показываем, выдуманных не добавляем никогда;
 * - если за день меньше трёх выдач — вместо ленты счётчик по ВСЕМ каналам;
 * - средний балл отзывов не показываем (реальная средняя ≈3,9): только
 *   «больше N отзывов» и сами 5★ отзывы, отобранные ботом.
 * Ни имён, ни почт, ни номеров заказов — только номинал, способ и время.
 */

export type PulseFeedItem = {
  kind: "code" | "gift" | "gamepass";
  via: "email" | "account" | "chat" | "gift" | "roblox";
  denomination: number;
  at: string;
};

export type StorefrontPulse = {
  feed: PulseFeedItem[];
  todayCount: number;
  showFeed: boolean;
  /** `robux` — сколько получили покупатели (чистые); `gross` — цена выкупленных
   *  геймпассов (с комиссией Roblox 30 %) плюс номиналы кодов. На витрине — `gross`
   *  с подписью «прошло через RobloxBank» (решение владельца 15.11.2026: «грязные
   *  больше»), но НЕ «выдано покупателям» — покупатели получили `robux`. */
  totals: { orders: number; robux: number; gross: number };
  reviews: { id: string; name: string; text: string; date: string }[];
  reviewsTotal: number;
  /** Страница отзывов товара на WB (по самому свежему отобранному отзыву). */
  wbReviewsUrl: string | null;
  generatedAt: string;
};

const FEED_MIN = 3;
const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;

/** Полночь по Москве — в UTC (колонки без пояса, Prisma пишет UTC). */
export function moscowDayStart(now = new Date()): Date {
  const msk = new Date(now.getTime() + MSK_OFFSET_MS);
  return new Date(Date.UTC(msk.getUTCFullYear(), msk.getUTCMonth(), msk.getUTCDate()) - MSK_OFFSET_MS);
}

let cache: { at: number; value: StorefrontPulse } | null = null;
const TTL_MS = 60_000;

export async function storefrontPulse(now = new Date()): Promise<StorefrontPulse> {
  if (cache && now.getTime() - cache.at < TTL_MS) return cache.value;
  const since = moscowDayStart(now);
  const [codes, gamepasses, wbTotals, wbGross, codeTotals, reviews, reviewsTotal] = await Promise.all([
    prisma.codeOrder.findMany({
      where: { status: "ISSUED", issuedAt: { gte: since } },
      orderBy: { issuedAt: "desc" },
      take: 12,
      select: { denomination: true, issuedAt: true, deliveryMode: true, channel: true },
    }),
    prisma.wbOrder.findMany({
      where: { orderSource: "SITE", status: "COMPLETED", completedAt: { gte: since } },
      orderBy: { completedAt: "desc" },
      take: 12,
      select: { amount: true, completedAt: true },
    }),
    prisma.wbOrder.aggregate({ where: { status: "COMPLETED" }, _count: { _all: true }, _sum: { amount: true } }),
    prisma.$queryRaw<{ gross: bigint | null }[]>`SELECT SUM(CEIL(amount / 0.7))::bigint AS gross FROM "WbOrder" WHERE status = 'COMPLETED'`,
    prisma.codeOrder.aggregate({ where: { status: "ISSUED" }, _count: { _all: true }, _sum: { denomination: true } }),
    prisma.wbReview.findMany({
      where: { eligible: true, hidden: false },
      orderBy: { wbCreatedAt: "desc" },
      take: 24,
      select: { id: true, authorName: true, text: true, wbCreatedAt: true, nmId: true },
    }).catch(() => []),
    prisma.wbReview.count().catch(() => 0),
  ]);

  const feed: PulseFeedItem[] = [
    ...codes.map((order) => ({
      kind: order.deliveryMode === "GIFT" ? "gift" as const : "code" as const,
      via: order.deliveryMode === "GIFT" ? "gift" as const
        : order.channel === "TG" || order.channel === "VK" ? "chat" as const
        : order.deliveryMode === "ACCOUNT" ? "account" as const : "email" as const,
      denomination: order.denomination,
      at: (order.issuedAt ?? now).toISOString(),
    })),
    ...gamepasses.map((order) => ({
      kind: "gamepass" as const,
      via: "roblox" as const,
      denomination: order.amount,
      at: (order.completedAt ?? now).toISOString(),
    })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8);

  const value: StorefrontPulse = {
    feed,
    todayCount: codes.length + gamepasses.length,
    showFeed: codes.length + gamepasses.length >= FEED_MIN,
    totals: {
      orders: wbTotals._count._all + codeTotals._count._all,
      robux: (wbTotals._sum.amount ?? 0) + (codeTotals._sum.denomination ?? 0),
      gross: Number(wbGross[0]?.gross ?? 0) + (codeTotals._sum.denomination ?? 0),
    },
    reviews: reviews.map((review) => ({ id: review.id, name: review.authorName, text: review.text, date: review.wbCreatedAt.toISOString() })),
    reviewsTotal,
    wbReviewsUrl: reviews.find((review) => review.nmId)?.nmId ? `https://www.wildberries.ru/catalog/${reviews.find((review) => review.nmId)!.nmId}/feedbacks` : null,
    generatedAt: now.toISOString(),
  };
  cache = { at: now.getTime(), value };
  return value;
}
