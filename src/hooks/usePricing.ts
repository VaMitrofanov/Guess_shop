"use client";

import { useState, useEffect } from "react";

interface PricingState {
  rubPerRobux: number;
  inventory: number;
  maxLimit: number;
  loading: boolean;
}

export function usePricing() {
  const [pricing, setPricing] = useState<PricingState>({
    rubPerRobux: 0.85,
    inventory: 0,
    maxLimit: 0,
    loading: true,
  });

  useEffect(() => {
    fetch("/api/pricing")
      .then((r) => r.json())
      .then((data) => {
        if (data.rubPerRobux) {
          setPricing({
            rubPerRobux: data.rubPerRobux,
            inventory: data.inventory,
            maxLimit: data.maxLimit,
            loading: false,
          });
        }
      })
      .catch(() => setPricing((p) => ({ ...p, loading: false })));
  }, []);

  const getPrice = (amountRobux: number) =>
    Math.round(amountRobux * pricing.rubPerRobux);

  return { ...pricing, getPrice };
}
