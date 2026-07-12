import { NextResponse } from "next/server";
import {
  CUSTOM_MAX,
  CUSTOM_MIN,
  DIRECT_PACKS,
  DIRECT_PRICES,
  RETAIL_PRICING_POLICY_VERSION,
} from "@/lib/retail-pricing";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    policyVersion: RETAIL_PRICING_POLICY_VERSION,
    currency: "RUB",
    minRobux: CUSTOM_MIN,
    maxRobux: CUSTOM_MAX,
    packs: DIRECT_PACKS.map((amountRobux) => ({
      amountRobux,
      rubles: DIRECT_PRICES[amountRobux],
    })),
    tiers: [
      { from: CUSTOM_MIN, to: 499, rubPerRobux: 1, smallOrderSurcharge: 60 },
      { from: 500, to: 999, rubPerRobux: 0.9, smallOrderSurcharge: 0 },
      { from: 1000, to: 1499, rubPerRobux: 0.8, smallOrderSurcharge: 0 },
      { from: 1500, to: CUSTOM_MAX, rubPerRobux: 0.7, smallOrderSurcharge: 0 },
    ],
  });
}
