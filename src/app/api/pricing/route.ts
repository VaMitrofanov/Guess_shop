import { NextResponse } from "next/server";
import { getStorefrontPricing } from "@/lib/pricing";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const pricing = await getStorefrontPricing();
    return NextResponse.json({
      rubPerRobux: pricing.finalRubPerRobux,
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
