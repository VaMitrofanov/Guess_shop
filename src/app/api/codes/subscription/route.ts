import { NextRequest, NextResponse } from "next/server";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { viewerCodeDiscount } from "@/lib/codes/referral";
import { noStore, sessionUserId } from "@/lib/codes/http";

export const dynamic = "force-dynamic";

/** «Я подписался» — проверить подписку на канал/группу сейчас же (скидка 1 %). */
export async function POST(req: NextRequest) {
  const limit = rateLimit(`codes-sub:${clientIp(req)}`, 10, 1 / 6);
  if (!limit.ok) return NextResponse.json({ error: "Слишком часто — подождите минуту." }, { status: 429 });
  const userId = await sessionUserId();
  if (!userId) return NextResponse.json({ error: "Войдите в аккаунт." }, { status: 401 });
  const discount = await viewerCodeDiscount(userId, { forceSubscriptionCheck: true });
  return NextResponse.json({
    subscribed: discount.subscription?.subscribed ?? false,
    via: discount.subscription?.via ?? "none",
    discountPercent: discount.percent,
  }, { headers: noStore });
}
