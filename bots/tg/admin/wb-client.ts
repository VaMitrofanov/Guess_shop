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

const PriceSchema = z.object({
  data: z.object({
    listGoods: z.array(z.object({
      nmID: z.number(),
      vendorCode: z.string(),
      sizes: z.array(z.object({
        price: z.number(),
        discountedPrice: z.number(),
      })),
    })).optional().default([]),
  }),
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
  price?: number;
  discountedPrice?: number;
}

// ── Helper ───────────────────────────────────────────────────────────────────

function formatDate(date: Date): string {
  return date.toISOString().split(".")[0] + "Z";
}

async function fetchWb<T>(url: string, schema: z.ZodType<T>, options: RequestInit = {}): Promise<T | null> {
  if (!wbCodeEnv) return null;
  
  try {
    const res = await fetch(url, {
      ...options,
      headers: {
        Authorization: wbCodeEnv,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });
    
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        console.error(`WB API Auth Error: ${url} -> ${res.status}`);
      } else {
        const errText = await res.text().catch(() => "");
        console.error(`WB API HTTP ${res.status} for ${url}: ${errText}`);
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
  const dateFrom = formatDate(new Date(now.getFullYear(), now.getMonth(), now.getDate()));

  const [ordersRaw, salesRaw] = await Promise.all([
    fetchWb(`https://statistics-api.wildberries.ru/api/v1/supplier/orders?dateFrom=${encodeURIComponent(dateFrom)}&flag=0`, z.array(OrderSchema)),
    fetchWb(`https://statistics-api.wildberries.ru/api/v1/supplier/sales?dateFrom=${encodeURIComponent(dateFrom)}`, z.array(SaleSchema)),
  ]);

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
 * Get orders and sales for the last 7 days.
 */
export async function getWeeklyStats(): Promise<{ orders: number, sales: number } | null> {
  if (!wbCodeEnv) return null;

  const now = new Date();
  const dateFrom = formatDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7));

  const [ordersRaw, salesRaw] = await Promise.all([
    fetchWb(`https://statistics-api.wildberries.ru/api/v1/supplier/orders?dateFrom=${encodeURIComponent(dateFrom)}&flag=0`, z.array(OrderSchema)),
    fetchWb(`https://statistics-api.wildberries.ru/api/v1/supplier/sales?dateFrom=${encodeURIComponent(dateFrom)}`, z.array(SaleSchema)),
  ]);

  if (ordersRaw === null && salesRaw === null) return null;

  return {
    orders: (ordersRaw || []).filter(o => !o.isCancel).length,
    sales: (salesRaw || []).length,
  };
}

/**
 * Get the most recent 100 orders.
 */
export async function getRecentOrders(): Promise<any[] | null> {
    if (!wbCodeEnv) return null;
    const dateFrom = formatDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
    const orders = await fetchWb(`https://statistics-api.wildberries.ru/api/v1/supplier/orders?dateFrom=${encodeURIComponent(dateFrom)}&flag=0`, z.array(z.any()));
    if (!orders) return null;
    return orders.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 100);
}

/**
 * Get Marketplace (FBS) orders.
 */
export async function getFbsOrders(): Promise<any[] | null> {
    if (!wbCodeEnv) return null;
    
    // 1. Get NEW orders
    const newRes = await fetchWb(`https://marketplace-api.wildberries.ru/api/v3/orders/new`, z.object({ orders: z.array(z.any()) }));
    const newOrders = newRes?.orders || [];
    
    // 2. Get IN-PROCESS orders
    const procRes = await fetchWb(`https://marketplace-api.wildberries.ru/api/v3/orders?limit=50&next=0`, z.object({ orders: z.array(z.any()) }));
    const procOrders = procRes?.orders || [];
    
    return [...newOrders, ...procOrders].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

/**
 * Get current stocks. Grouped by supplierArticle.
 */
export async function getStocks(): Promise<WbStock[] | null> {
  if (!wbCodeEnv) return null;

  const dateFrom = "2023-01-01T00:00:00Z";
  const stocks = await fetchWb(
    `https://statistics-api.wildberries.ru/api/v1/supplier/stocks?dateFrom=${dateFrom}`, 
    z.array(StockSchema)
  );

  if (!stocks) return null;

  const res: WbStock[] = [];
  const grouped = new Map<string, { q: number, p: number }>();
  
  for (const s of stocks) {
    const existing = grouped.get(s.supplierArticle) || { q: 0, p: s.Price };
    existing.q += s.quantity;
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
 * Get active ad campaigns status.
 */
export async function getCampaignsStatus(): Promise<string | null> {
  if (!wbCodeEnv) return null;

  try {
    const res = await fetchWb(`https://advert-api.wildberries.ru/adv/v1/promotion/count`, z.any());
    if (!res) return null;
    
    if (res.adverts && Array.isArray(res.adverts)) {
        const active = res.adverts.filter((a: any) => a.status === 9 || a.status === 11).length;
        return `Активно: ${active} / Всего: ${res.adverts.length}`;
    }
    return `Подключено ✅`;
  } catch {
    return "Ошибка загрузки ❌";
  }
}

/**
 * Get list of products with their prices.
 */
export async function getProducts(): Promise<WbProduct[] | null> {
  if (!wbCodeEnv) return null;

  // 1. Get cards from Content API
  const cardsRaw = await fetchWb("https://content-api.wildberries.ru/content/v2/get/cards/list", CardsListSchema, {
    method: "POST",
    body: JSON.stringify({
      settings: { cursor: { limit: 100 }, filter: { withPhoto: -1 } }
    })
  });

  if (!cardsRaw || !cardsRaw.cards) return null;

  // 2. Get prices from Price API
  const pricesRaw = await fetchWb("https://discounts-prices-api.wildberries.ru/api/v2/list/goods/filter?limit=100&offset=0", PriceSchema);
  
  const priceMap = new Map<number, { p: number, dp: number }>();
  if (pricesRaw?.data?.listGoods) {
    for (const g of pricesRaw.data.listGoods) {
      if (g.sizes && g.sizes[0]) {
        priceMap.set(g.nmID, {
          p: g.sizes[0].price,
          dp: g.sizes[0].discountedPrice
        });
      }
    }
  }

  return cardsRaw.cards.map(c => {
    const priceData = priceMap.get(c.nmID);
    return {
      nmID: c.nmID,
      vendorCode: c.vendorCode,
      title: c.title,
      price: priceData?.p,
      discountedPrice: priceData?.dp,
    };
  });
}

/**
 * Update price for a product.
 * @param nmID Product ID
 * @param price New price (base)
 * @param discount New discount percentage
 */
export async function updatePrice(nmID: number, price: number): Promise<boolean> {
  if (!wbCodeEnv) return false;

  try {
    const res = await fetch("https://discounts-prices-api.wildberries.ru/api/v2/upload/price", {
      method: "POST",
      headers: {
        Authorization: wbCodeEnv,
        "Content-Type": "application/json"
      },
      body: JSON.stringify([{
        nmID,
        price
      }])
    });

    if (!res.ok) {
        const err = await res.text();
        console.error(`WB Price Update Error: ${res.status} - ${err}`);
        return false;
    }
    return true;
  } catch (err) {
    console.error("WB API Error (Update Price):", err);
    return false;
  }
}


