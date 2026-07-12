"use client";

import { useEffect, useState } from "react";
import {
  DIRECT_PACKS,
  DIRECT_PRICES,
  RETAIL_PRICING_POLICY_VERSION,
  directPrice,
  getRetailPriceBreakdown,
} from "@/lib/retail-pricing";

interface PricingState {
  policyVersion: string;
  packs: { amountRobux: number; rubles: number }[];
  loading: boolean;
}

export function usePricing() {
  const [pricing, setPricing] = useState<PricingState>({
    policyVersion: RETAIL_PRICING_POLICY_VERSION,
    packs: DIRECT_PACKS.map((amountRobux) => ({ amountRobux, rubles: DIRECT_PRICES[amountRobux] })),
    loading: false,
  });

  useEffect(() => {
    fetch("/api/pricing")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("pricing unavailable"))))
      .then((data) => {
        setPricing({
          policyVersion: data.policyVersion ?? RETAIL_PRICING_POLICY_VERSION,
          packs: Array.isArray(data.packs)
            ? data.packs
            : DIRECT_PACKS.map((amountRobux) => ({ amountRobux, rubles: DIRECT_PRICES[amountRobux] })),
          loading: false,
        });
      })
      .catch(() => setPricing((p) => ({ ...p, loading: false })));
  }, []);

  const getPrice = (amountRobux: number) => directPrice(amountRobux);

  return { ...pricing, getPrice, getBreakdown: getRetailPriceBreakdown };
}
