import { z } from "zod";

const wbCodeEnv = process.env.WB_API_TOKEN || "";

// ── Zod Schemas ──────────────────────────────────────────────────────────────

const OrderSchema = z.object({
  date: z.string(),
  lastChangeDate: z.string(),
  supplierArticle: z.string(),
  barcode: z.string(),
  totalPrice: z.number(),
  discountPercent: z.number(),
  priceWithDisc: z.number(),
  isCancel: z.boolean(),
});

const SaleSchema = z.object({
  date: z.string(),
  lastChangeDate: z.string(),
  supplierArticle: z.string(),
  barcode: z.string(),
  totalPrice: z.number(),
  discountPercent: z.number(),
  priceWithDisc: z.number(),
});

const StockSchema = z.object({
  lastChangeDate: z.string(),
  supplierArticle: z.string(),
  barcode: z.string(),
  quantity: z.number(),
  quantityFull: z.number(),
  Price: z.number(),
  Discount: z.number(),
});

const AdvertCountSchema = z.object({
  campCount: z.number().optional().default(0),
});

const CardsListSchema = z.object({
  cards: z.array(
    z.object({
      nmID: z.number(),
      vendorCode: z.string(),
      title: z.string().optional().default(""),
      photos: z.array(z.object({ big: z.string() })).optional().default([]),
    })
  ).optional().default([]),
});

// ── Types ────────────────────────────────────────────────────────────────────

export interface TodayStats {
  ordersCount: number;
  ordersSum: number;
  salesCount: number;
  salesSum: number;
}

export interface WbStock {
  article: string;
  quantity: number;
  price: number;
}

export interface WbProduct {
  nmID: number;
  vendorCode: string;
  title: string;
}

// ── Helper ───────────────────────────────────────────────────────────────────

async function fetchWb<T>(url: string, schema: z.ZodType<T>, headers: any = {}): Promise<T | null> {
  if (!wbCodeEnv) return null;
  
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: wbCodeEnv,
        ...headers,
      },
    });
    
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        console.error(`WB API Auth Error: ${url} -> ${res.status}`);
        return null;
      }
      return null;
    }
    
    const data = await res.json();
    return schema.parse(data);
  } catch (err) {
    console.error(`WB API Error for ${url}:`, err);
    return null;
  }
}

// ── API Methods ──────────────────────────────────────────────────────────────

/**
 * Get orders and sales for today.
 */
export async function getTodayStats(): Promise<TodayStats | null> {
  if (!wbCodeEnv) return null;

  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const dateFrom = `${year}-${month}-${day}`;

  const [ordersRaw, salesRaw] = await Promise.all([
    fetchWb(`https://statistics-api.wildberries.ru/api/v1/supplier/orders?dateFrom=${dateFrom}`, z.array(OrderSchema)),
    fetchWb(`https://statistics-api.wildberries.ru/api/v1/supplier/sales?dateFrom=${dateFrom}`, z.array(SaleSchema)),
  ]);

  // If both failed or token invalid
  if (ordersRaw === null && salesRaw === null) return null;

  const orders = ordersRaw || [];
  const sales = salesRaw || [];

  const activeOrders = orders.filter(o => !o.isCancel);

  return {
    ordersCount: activeOrders.length,
    ordersSum: activeOrders.reduce((acc, o) => acc + o.priceWithDisc, 0),
    salesCount: sales.length,
    salesSum: sales.reduce((acc, s) => acc + s.priceWithDisc, 0),
  };
}

/**
 * Get current stocks. Grouped by supplierArticle.
 */
export async function getStocks(): Promise<WbStock[] | null> {
  if (!wbCodeEnv) return null;

  // Stocks API requires dateFrom, we can use a date from the past 
  const dateFrom = "2023-01-01";
  
  const stocks = await fetchWb(
    `https://statistics-api.wildberries.ru/api/v1/supplier/stocks?dateFrom=${dateFrom}`, 
    z.array(StockSchema)
  );

  if (!stocks) return null;

  const res: WbStock[] = [];
  const grouped = new Map<string, { q: number, p: number }>();
  
  for (const s of stocks) {
    const existing = grouped.get(s.supplierArticle) || { q: 0, p: s.Price };
    existing.q += s.quantity; // Or quantityFull depending on logic, but quantity is safe
    grouped.set(s.supplierArticle, existing);
  }

  for (const [article, data] of grouped.entries()) {
    res.push({
      article,
      quantity: data.q,
      price: data.p,
    });
  }

  return res;
}

/**
 * Get active ad campaigns status. (We just get the count for now)
 */
export async function getCampaignsStatus(): Promise<string | null> {
  if (!wbCodeEnv) return null;

  // Advert API has /adv/v1/promotion/count endpoint
  try {
    const res = await fetchWb(`https://advert-api.wildberries.ru/adv/v1/promotion/count`, z.any());
    if (!res) return null;
    
    // Attempt to extract some info, advert api returns { adverts: [...] } or { campCount: X }
    // As a simple fallback:
    if (res.adverts && Array.isArray(res.adverts)) {
        return `Активно кампаний: ${res.adverts.length}`;
    }
    return `Подключено ✅`;
  } catch {
    return "Ошибка загрузки ❌";
  }
}

/**
 * Get list of products (cards).
 */
export async function getProducts(): Promise<WbProduct[] | null> {
  if (!wbCodeEnv) return null;

  const body = {
    settings: {
      cursor: { limit: 100 },
      filter: { withPhoto: -1 }
    }
  };

  try {
    const res = await fetch("https://suppliers-api.wildberries.ru/content/v2/get/cards/list", {
      method: "POST",
      headers: {
        Authorization: wbCodeEnv,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) return null;
    const data = await res.json();
    const parsed = CardsListSchema.parse(data);

    return parsed.cards.map(c => ({
      nmID: c.nmID,
      vendorCode: c.vendorCode,
      title: c.title,
    }));
  } catch (err) {
    console.error("WB API Error (Products):", err);
    return null;
  }
}
