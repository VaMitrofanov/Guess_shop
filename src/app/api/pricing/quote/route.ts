import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { createPriceQuote } from "@/lib/price-quote";
import { CUSTOM_MAX, CUSTOM_MIN } from "@/lib/retail-pricing";

export const dynamic = "force-dynamic";

const QuoteSchema = z.object({
  amountRobux: z.number().int().min(CUSTOM_MIN).max(CUSTOM_MAX),
});

export async function POST(req: NextRequest) {
  const { ok, retryAfter } = rateLimit(`pricing-quote:${clientIp(req)}`, 10, 1 / 6);
  if (!ok) {
    return NextResponse.json(
      { error: "Слишком много запросов котировки. Попробуйте через минуту." },
      { status: 429, headers: { "retry-after": String(retryAfter) } },
    );
  }

  const parsed = QuoteSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Некорректная сумма заказа" }, { status: 400 });
  }

  try {
    const session = await auth();
    const userId = (session?.user as { id?: string } | undefined)?.id;
    const { quote, calculated } = await createPriceQuote(parsed.data.amountRobux, userId);

    return NextResponse.json(
      {
        quoteId: quote.id,
        policyVersion: calculated.policyVersion,
        requestedRobux: calculated.requestedRobux,
        bonusRobux: calculated.bonusRobux,
        gamepassPriceRobux: calculated.gamepassPriceRobux,
        baseAmountKopecks: calculated.baseAmountKopecks,
        discountKopecks: calculated.discountKopecks,
        finalAmountKopecks: calculated.finalAmountKopecks,
        expiresAt: quote.expiresAt.toISOString(),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    console.error("[pricing/quote] unable to create quote", error);
    return NextResponse.json({ error: "Котировка временно недоступна" }, { status: 503 });
  }
}
