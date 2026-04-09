"use client";

import { useState, useEffect } from "react";

interface PricingState {
  rubPerRobux: number;
  inventory: number;
  maxLimit: number;
  loading: boolean;
}

export function usePricing() {
  const FIXED_RATE = 0.65;

  const [pricing, setPricing] = useState<PricingState>({
    rubPerRobux: FIXED_RATE,
    inventory: 0,
    maxLimit: 0,
    loading: true,
  });

  useEffect(() => {
    fetch("/api/pricing")
      .then((r) => r.json())
      .then((data) => {
        setPricing({
          rubPerRobux: FIXED_RATE,
          inventory: data.inventory ?? 0,
          maxLimit: data.maxLimit ?? 0,
          loading: false,
        });
      })
      .catch(() => setPricing((p) => ({ ...p, rubPerRobux: FIXED_RATE, loading: false })));
  }, []);

  const getPrice = (amountRobux: number) =>
    Math.round(amountRobux * pricing.rubPerRobux);

  return { ...pricing, getPrice };
}
