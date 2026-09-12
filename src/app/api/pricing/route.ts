import { NextResponse } from "next/server";
import {
  CUSTOM_MAX,
  CUSTOM_MIN,
  DIRECT_PACKS,
  DIRECT_PRICES,
  RETAIL_PRICING_POLICY_VERSION,
  ACQUIRING_MIN_RUB,
  ACQUIRING_RATE,
  USN_INCOME_RATE,
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
    deductions: {
      usnIncomePct: USN_INCOME_RATE * 100,
      acquiringPct: ACQUIRING_RATE * 100,
      acquiringMinRub: ACQUIRING_MIN_RUB,
      dolyamiIncluded: false,
      separateReceiptFeeIncluded: false,
    },
    targetNetCurve: [
      { amountRobux: 1, rubPerRobux: 3 },
      { amountRobux: 10, rubPerRobux: 2 },
      { amountRobux: 50, rubPerRobux: 1.6 },
      { amountRobux: 100, rubPerRobux: 1.3 },
      { amountRobux: 500, rubPerRobux: 1 },
      { amountRobux: 1000, rubPerRobux: 0.9 },
      { amountRobux: 3000, rubPerRobux: 0.8 },
      { amountRobux: 5000, rubPerRobux: 0.7 },
    ],
    rounding: "whole-ruble-up",
  });
}
