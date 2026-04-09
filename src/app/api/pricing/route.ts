import { NextResponse } from "next/server";
import { getStorefrontPricing } from "@/lib/pricing";

export const dynamic = "force-dynamic";

const FIXED_RATE_RUB = 0.65;

export async function GET() {
  try {
    const pricing = await getStorefrontPricing();
    return NextResponse.json({
      rubPerRobux: FIXED_RATE_RUB,
      usdToRub: pricing.usdToRub,
      provider: pricing.provider,
      inventory: pricing.inventory,
      maxLimit: pricing.maxLimit,
    });
  } catch (err) {
    console.error("[Pricing API]", err);
    return NextResponse.json({ error: "Pricing unavailable" }, { status: 500 });
  }
}
