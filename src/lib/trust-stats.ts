import { getCommunityAudienceMetrics } from "@/lib/admin-audience";
import { storefrontPulse } from "@/lib/storefront-pulse";

/**
 * 🛡 Цифры доверия для страницы оплаты родителю (15.11.2026, владелец:
 * «время играет на нас — данные должны обновляться»). Всё живое:
 * отзывы WB (бот обновляет раз в час), выдачи и Robux — из «пульса» витрины,
 * подписчики канала и группы — запросом к Telegram/ВК. Кэш в памяти — час;
 * если источник не ответил, показываем последнее известное значение.
 */

export type TrustStats = {
  reviewsTotal: number;
  wbReviewsUrl: string | null;
  orders: number;
  robuxGross: number;
  tgMembers: number | null;
  vkMembers: number | null;
  reviews: { id: string; name: string; text: string }[];
};

let cache: { at: number; value: TrustStats } | null = null;
const TTL_MS = 60 * 60 * 1000;

export async function trustStats(): Promise<TrustStats | null> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  try {
    const [pulse, communities] = await Promise.all([
      storefrontPulse(),
      getCommunityAudienceMetrics().catch(() => []),
    ]);
    const tg = communities.find((c) => c.platform === "TG")?.members ?? cache?.value.tgMembers ?? null;
    const vk = communities.find((c) => c.platform === "VK")?.members ?? cache?.value.vkMembers ?? null;
    const value: TrustStats = {
      reviewsTotal: pulse.reviewsTotal,
      wbReviewsUrl: pulse.wbReviewsUrl,
      orders: pulse.totals.orders,
      robuxGross: pulse.totals.gross ?? pulse.totals.robux,
      tgMembers: tg,
      vkMembers: vk,
      // Короткие и содержательные — для родителя три отзыва, а не лента.
      reviews: pulse.reviews.filter((review) => review.text.length >= 25).slice(0, 3).map(({ id, name, text }) => ({ id, name, text })),
    };
    cache = { at: Date.now(), value };
    return value;
  } catch (error) {
    console.warn("[trust-stats]", (error as Error)?.message);
    return cache?.value ?? null;
  }
}
