import { NextRequest, NextResponse } from "next/server";
import { extractTwaUser } from "@/lib/twa-auth";
import { z } from "zod";

const PriceSchema = z.object({
  data: z.object({
    listGoods: z.array(z.object({
      nmID:        z.number(),
      vendorCode:  z.string(),
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

  const token = process.env.WB_API_TOKEN ?? "";
  if (!token) return NextResponse.json({ error: "No WB token", items: [] });

  try {
    const res = await fetch(
      "https://discounts-prices-api.wildberries.ru/api/v2/list/goods/filter?limit=100&offset=0",
      { cache: "no-store", headers: { Authorization: token } }
    );
    if (!res.ok) return NextResponse.json({ error: `WB ${res.status}`, items: [] });

    const raw  = PriceSchema.parse(await res.json());
    const items = raw.data.listGoods.map(g => ({
      nmID:           g.nmID,
      article:        g.vendorCode,
      price:          g.sizes[0].price,
      discountedPrice: g.sizes[0].discountedPrice,
      discount:       g.sizes[0].discount,
    }));
    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ error: "parse error", items: [] });
  }
}
