import { NextRequest, NextResponse } from "next/server";
import { extractTwaUser } from "@/lib/twa-auth";
import { getAdvertData, getRealizData } from "@/lib/wb-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const PriceSchema = z.object({
  data: z.object({
    listGoods: z.array(z.object({
      nmID:       z.number(),
      vendorCode: z.string(),
      sizes: z.array(z.object({
        price:           z.number(),
        discountedPrice: z.number(),
        discount:        z.number().optional().default(0),
      })).min(1),
    })).optional().default([]),
  }),
});

export async function GET(req: NextRequest) {
  if (!await extractTwaUser(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // 1. DB-only data (always fast, never fails)
  const [settings, productCosts] = await Promise.all([
    (prisma as any).wbSettings.findFirst() as Promise<any>,
    (prisma as any).wbProductCost.findMany() as Promise<any[]>,
  ]);

  const kursRb    = settings?.kursRb    ?? 4;
  const kursUsd   = settings?.kursUsd   ?? 75;
  const fixedCost = settings?.fixedCost ?? 87.5;

  // 2. WB API data — fetch in parallel, each falls back to 0 if unavailable
  const token = process.env.WB_API_TOKEN ?? "";

  const [advertResult, realizResult, pricesResult] = await Promise.allSettled([
    getAdvertData(),
    getRealizData(4),
    token
      ? fetch("https://discounts-prices-api.wildberries.ru/api/v2/list/goods/filter?limit=100&offset=0", {
          cache: "no-store",
          headers: { Authorization: token },
        }).then(r => r.ok ? r.json() : null).catch(() => null)
      : Promise.resolve(null),
  ]);

  const cpo = advertResult.status === "fulfilled" ? (advertResult.value?.avgCpo ?? 0) : 0;
  const realiz = realizResult.status === "fulfilled" ? realizResult.value : null;
  const storagePerUnit = realiz && realiz.salesCount > 0 && realiz.totalStorage > 0
    ? Math.round((realiz.totalStorage / realiz.salesCount) * 10) / 10
    : 0;

  // Parse prices
  const products: { nmID: number; article: string; price: number; discountedPrice: number; discount: number }[] = [];
  if (pricesResult.status === "fulfilled" && pricesResult.value) {
    try {
      const raw = PriceSchema.parse(pricesResult.value);
      for (const g of raw.data.listGoods) {
        products.push({
          nmID:           g.nmID,
          article:        g.vendorCode,
          price:          g.sizes[0].price,
          discountedPrice: g.sizes[0].discountedPrice,
          discount:       g.sizes[0].discount,
        });
      }
    } catch { /* ignore parse errors, products stays empty */ }
  }

  // Build per-product cost map (article → commission/taxRate/denomination)
  const costByArticle = new Map<string, { commission: number; taxRate: number; denomination: number | null }>();
  for (const c of productCosts) {
    // try to match by nmID → article from products
    const prod = products.find(p => p.nmID === c.nmID);
    const article = prod?.article ?? c.vendorCode ?? String(c.nmID);
    costByArticle.set(article, {
      commission:  c.wbCommission  ?? 0.245,
      taxRate:     c.taxRate       ?? 0.07,
      denomination: c.denomination ?? null,
    });
  }

  return NextResponse.json({
    kursRb,
    kursUsd,
    fixedCost,
    cpo,
    storagePerUnit,
    products,
    costByArticle: Object.fromEntries(costByArticle),
  });
}
