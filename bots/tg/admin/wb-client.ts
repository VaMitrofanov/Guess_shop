import { z } from "zod";

const wbCodeEnv = process.env.WB_API_TOKEN || "";

// ── Zod Schemas ─────────────────────────────────────────────────────────────

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

const FeedbackItemSchema = z.object({
  id: z.string(),
  text: z.string().optional().default(""),
  productValuation: z.number().optional(),
  createdDate: z.string(),
  userName: z.string().optional().default("Аноним"),
  productDetails: z.object({
    nmId: z.number().optional(),
    supplierArticle: z.string().optional().default(""),
  }).optional(),
});

const FeedbacksResponseSchema = z.object({
  data: z.object({
    feedbacks: z.array(FeedbackItemSchema).optional().default([]),
    countUnanswered: z.number().optional().default(0),
  }).optional(),
});

const QuestionsResponseSchema = z.object({
  data: z.object({
    questions: z.array(FeedbackItemSchema).optional().default([]),
    countUnanswered: z.number().optional().default(0),
  }).optional(),
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

// ── Cache mechanism ─────────────────────────────────────────────────────────

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const wbCache = new Map<string, CacheEntry<any>>();

function getFromCache<T>(key: string): T | null {
  const entry = wbCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    wbCache.delete(key);
    return null;
  }
  return entry.data;
}

function setToCache<T>(key: string, data: T, ttlMs: number = 5 * 60 * 1000): void {
  wbCache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

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

export interface WbReview {
  id: string;
  text: string;
  stars?: number;
  date: string;
  author: string;
  article: string;
  nmId?: number;
  kind: "review" | "question";
}

export interface WbTopProduct {
  article: string;
  sum: number;
  count: number;
}

export interface WbStockWithRunway extends WbStock {
  avgDailySales: number;
  runwayDays: number;
}

export interface WbDayStats {
  date: string;        // "DD.MM" for display
  dateRaw: string;     // "YYYY-MM-DD" for comparison
  count: number;
  sum: number;
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

// ── Aggregated Statistics ────────────────────────────────────────────────────

let lastKnownStats: any = null;

/**
 * Fetches and caches orders/sales for the last 30 days.
 * This prevents 429 errors by combining today/weekly/recent requests.
 */
async function getAggregatedStats(): Promise<{ orders: z.infer<typeof OrderSchema>[], sales: z.infer<typeof SaleSchema>[] } | null> {
  const cacheKey = "wb_stats_30d";
  const cached = getFromCache<any>(cacheKey);
  if (cached) return cached;

  const dateFrom = formatDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
  
  // Sequential fetching to avoid burst 429
  const ordersRaw = await fetchWb(`https://statistics-api.wildberries.ru/api/v1/supplier/orders?dateFrom=${encodeURIComponent(dateFrom)}&flag=0`, z.array(OrderSchema));
  
  // Brief pause to satisfy WB rate limiter
  await new Promise(r => setTimeout(r, 2000));

  const salesRaw = await fetchWb(`https://statistics-api.wildberries.ru/api/v1/supplier/sales?dateFrom=${encodeURIComponent(dateFrom)}`, z.array(SaleSchema));

  if (!ordersRaw || !salesRaw) {
    // If we hit 429 or other error, fallback to last known good data
    if (lastKnownStats) {
      console.log("WB Statistics API Limit reached. Using last known stats fallback.");
      return lastKnownStats;
    }
    return null;
  }

  const result = {
    orders: ordersRaw || [],
    sales: salesRaw || [],
  };

  lastKnownStats = result;
  setToCache(cacheKey, result, 10 * 60 * 1000); // Increased to 10 min cache
  return result;
}

// ── API Methods ──────────────────────────────────────────────────────────────

/**
 * Get orders and sales for today.
 */
export async function getTodayStats(): Promise<TodayStats | null> {
  const aggregated = await getAggregatedStats();
  if (!aggregated) return null;

  const todayStr = new Date().toISOString().split('T')[0];
  
  const orders = aggregated.orders.filter(o => o.date.startsWith(todayStr) && !o.isCancel);
  const sales = aggregated.sales.filter(s => s.date.startsWith(todayStr));

  return {
    ordersCount: orders.length,
    ordersSum: orders.reduce((acc, o) => acc + o.priceWithDisc, 0),
    salesCount: sales.length,
    salesSum: sales.reduce((acc, s) => acc + s.priceWithDisc, 0),
  };
}

/**
 * Get orders and sales for the last 7 days.
 */
export async function getWeeklyStats(): Promise<{ orders: number, sales: number } | null> {
  const aggregated = await getAggregatedStats();
  if (!aggregated) return null;

  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  
  const orders = aggregated.orders.filter(o => new Date(o.date).getTime() >= sevenDaysAgo && !o.isCancel);
  const sales = aggregated.sales.filter(s => new Date(s.date).getTime() >= sevenDaysAgo);

  return {
    orders: orders.length,
    sales: sales.length,
  };
}

/**
 * Get the most recent 100 orders.
 */
export async function getRecentOrders(): Promise<any[] | null> {
    const aggregated = await getAggregatedStats();
    if (!aggregated) return null;
    
    return [...aggregated.orders]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 100);
}

/**
 * Get Marketplace (FBS) orders.
 */
export async function getFbsOrders(): Promise<any[] | null> {
    const cacheKey = "wb_fbs_orders";
    const cached = getFromCache<any[]>(cacheKey);
    if (cached) return cached;

    if (!wbCodeEnv) return null;
    
    // 1. Get NEW orders
    const newRes = await fetchWb(`https://marketplace-api.wildberries.ru/api/v3/orders/new`, z.object({ orders: z.array(z.any()) }));
    const newOrders = newRes?.orders || [];
    
    // 2. Get IN-PROCESS orders
    const procRes = await fetchWb(`https://marketplace-api.wildberries.ru/api/v3/orders?limit=50&next=0`, z.object({ orders: z.array(z.any()) }));
    const procOrders = procRes?.orders || [];
    
    const result = [...newOrders, ...procOrders].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    setToCache(cacheKey, result, 2 * 60 * 1000); // 2 min cache for FBS (more frequent updates needed)
    return result;
}

/**
 * Get current stocks. Grouped by supplierArticle.
 */
export async function getStocks(): Promise<WbStock[] | null> {
  const cacheKey = "wb_stocks";
  const cached = getFromCache<WbStock[]>(cacheKey);
  if (cached) return cached;

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

  setToCache(cacheKey, res, 10 * 60 * 1000); // 10 min cache for stocks
  return res;
}

/**
 * Get active ad campaigns status.
 */
export async function getCampaignsStatus(): Promise<string | null> {
  const cacheKey = "wb_campaigns";
  const cached = getFromCache<string>(cacheKey);
  if (cached) return cached;

  if (!wbCodeEnv) return null;

  try {
    const res = await fetchWb(`https://advert-api.wildberries.ru/adv/v1/promotion/count`, z.any());
    if (!res) return null;
    
    let result = "Подключено ✅";
    if (res.adverts && Array.isArray(res.adverts)) {
        const active = res.adverts.filter((a: any) => a.status === 9 || a.status === 11).length;
        result = `Активно: ${active} / Всего: ${res.adverts.length}`;
    }
    
    setToCache(cacheKey, result, 10 * 60 * 1000); // 10 min cache
    return result;
  } catch {
    return "Ошибка загрузки ❌";
  }
}

/**
 * Get list of products with their prices.
 */
export async function getProducts(): Promise<WbProduct[] | null> {
  const cacheKey = "wb_products";
  const cached = getFromCache<WbProduct[]>(cacheKey);
  if (cached) return cached;

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

  const result = cardsRaw.cards.map(c => {
    const priceData = priceMap.get(c.nmID);
    return {
      nmID: c.nmID,
      vendorCode: c.vendorCode,
      title: c.title,
      price: priceData?.p,
      discountedPrice: priceData?.dp,
    };
  });

  setToCache(cacheKey, result, 15 * 60 * 1000); // 15 min cache
  return result;
}

// ── Sync analytics helpers (use lastKnownStats cache, no extra API calls) ───

/** Top N products by revenue for today — derived from cached 30d stats. */
export function getTopProducts(limit = 5): WbTopProduct[] {
  if (!lastKnownStats) return [];
  const todayStr = new Date().toISOString().split("T")[0];
  const byArticle = new Map<string, { sum: number; count: number }>();
  for (const o of lastKnownStats.orders) {
    if (!o.date.startsWith(todayStr) || o.isCancel) continue;
    const e = byArticle.get(o.supplierArticle) ?? { sum: 0, count: 0 };
    e.sum += o.priceWithDisc;
    e.count++;
    byArticle.set(o.supplierArticle, e);
  }
  return [...byArticle.entries()]
    .map(([article, d]) => ({ article, ...d }))
    .sort((a, b) => b.sum - a.sum)
    .slice(0, limit);
}

/** Stats for yesterday — derived from cached 30d stats. */
export function getYesterdayStats(): TodayStats | null {
  if (!lastKnownStats) return null;
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const str = d.toISOString().split("T")[0];
  const orders = lastKnownStats.orders.filter((o: any) => o.date.startsWith(str) && !o.isCancel);
  const sales  = lastKnownStats.sales.filter((s: any) => s.date.startsWith(str));
  return {
    ordersCount: orders.length,
    ordersSum:   orders.reduce((a: number, o: any) => a + o.priceWithDisc, 0),
    salesCount:  sales.length,
    salesSum:    sales.reduce((a: number, s: any) => a + s.priceWithDisc, 0),
  };
}

/** Stats for the previous 7-day window (days -14..-8) — for weekly delta. */
export function getPrevWeekStats(): { orders: number; salesSum: number } | null {
  if (!lastKnownStats) return null;
  const now = Date.now();
  const from = now - 14 * 864e5;
  const to   = now - 7  * 864e5;
  const orders = lastKnownStats.orders.filter((o: any) => {
    const t = new Date(o.date).getTime();
    return t >= from && t < to && !o.isCancel;
  });
  return { orders: orders.length, salesSum: orders.reduce((a: number, o: any) => a + o.priceWithDisc, 0) };
}

/** Daily breakdown for the last N days — for bar chart. */
export function getDailyBreakdown(days: number): WbDayStats[] {
  const result: WbDayStats[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date();
    day.setDate(day.getDate() - i);
    const raw = day.toISOString().split("T")[0];
    const dayOrders = lastKnownStats?.orders.filter((o: any) => o.date.startsWith(raw) && !o.isCancel) ?? [];
    result.push({
      date:    day.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" }),
      dateRaw: raw,
      count:   dayOrders.length,
      sum:     dayOrders.reduce((a: number, o: any) => a + o.priceWithDisc, 0),
    });
  }
  return result;
}

/**
 * Stocks enriched with runway (days of remaining inventory).
 * Runway = current_stock / avg_daily_orders over last 14 days.
 */
export async function getStocksWithRunway(): Promise<WbStockWithRunway[] | null> {
  const stocks = await getStocks();
  if (!stocks) return null;

  // avg daily orders per article from last 14 days
  const avgMap = new Map<string, number>();
  if (lastKnownStats) {
    const cutoff = Date.now() - 14 * 864e5;
    const byArticle = new Map<string, number>();
    for (const o of lastKnownStats.orders) {
      if (new Date(o.date).getTime() < cutoff || o.isCancel) continue;
      byArticle.set(o.supplierArticle, (byArticle.get(o.supplierArticle) ?? 0) + 1);
    }
    for (const [article, total] of byArticle.entries()) {
      avgMap.set(article, total / 14);
    }
  }

  return stocks.map(s => {
    const avg = avgMap.get(s.article) ?? 0;
    const runway = avg > 0 ? Math.round(s.quantity / avg) : 999;
    return { ...s, avgDailySales: Math.round(avg * 10) / 10, runwayDays: runway };
  }).sort((a, b) => a.runwayDays - b.runwayDays);
}

// ── Reviews & Questions ─────────────────────────────────────────────────────

export async function getUnansweredReviews(): Promise<WbReview[]> {
  const cacheKey = "wb_reviews";
  const cached = getFromCache<WbReview[]>(cacheKey);
  if (cached) return cached;
  if (!wbCodeEnv) return [];

  const [fbRes, qRes] = await Promise.all([
    fetchWb(
      "https://feedbacks-api.wildberries.ru/api/v1/feedbacks?isAnswered=false&take=10&skip=0&order=dateDesc",
      FeedbacksResponseSchema
    ),
    (async () => {
      await new Promise(r => setTimeout(r, 1500));
      return fetchWb(
        "https://feedbacks-api.wildberries.ru/api/v1/questions?isAnswered=false&take=10&skip=0&order=dateDesc",
        QuestionsResponseSchema
      );
    })(),
  ]);

  const reviews: WbReview[] = (fbRes?.data?.feedbacks ?? []).map(f => ({
    id: f.id, text: f.text, stars: f.productValuation,
    date: f.createdDate, author: f.userName ?? "Аноним",
    article: f.productDetails?.supplierArticle ?? "",
    nmId: f.productDetails?.nmId,
    kind: "review" as const,
  }));

  const questions: WbReview[] = (qRes?.data?.questions ?? []).map(q => ({
    id: q.id, text: q.text, stars: undefined,
    date: q.createdDate, author: q.userName ?? "Аноним",
    article: q.productDetails?.supplierArticle ?? "",
    nmId: q.productDetails?.nmId,
    kind: "question" as const,
  }));

  const result = [...reviews, ...questions]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  setToCache(cacheKey, result, 5 * 60 * 1000);
  return result;
}

export async function answerReview(id: string, text: string, isQuestion: boolean): Promise<boolean> {
  if (!wbCodeEnv) return false;
  const url = isQuestion
    ? "https://feedbacks-api.wildberries.ru/api/v1/questions"
    : "https://feedbacks-api.wildberries.ru/api/v1/feedbacks";
  try {
    const res = await fetch(url, {
      method: "PATCH",
      headers: { Authorization: wbCodeEnv, "Content-Type": "application/json" },
      body: JSON.stringify(isQuestion ? { id, text, state: "wbGoodsQA" } : { id, text }),
    });
    if (!res.ok) {
      console.error(`WB Answer ${isQuestion ? "question" : "review"} error: ${res.status} ${await res.text()}`);
      return false;
    }
    wbCache.delete("wb_reviews");
    return true;
  } catch (err) {
    console.error("WB answerReview error:", err);
    return false;
  }
}

// ── Push notification state ─────────────────────────────────────────────────

interface WbPushState {
  fbsCount: number;
  reviewCount: number;
  lowStockArticles: string[];
}
let lastPushState: WbPushState | null = null;

// Hourly FBS digest: accumulate delta between flushes (avoids spam at high volume)
let pendingFbsDelta  = 0;
let lastFbsDigestAt  = 0;
const FBS_DIGEST_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

export function captureNotifyState(fbsCount: number, reviewCount: number, lowStock: string[]): WbPushState | null {
  const prev = lastPushState;
  lastPushState = { fbsCount, reviewCount, lowStockArticles: lowStock };
  return prev;
}

/**
 * Accumulate new FBS orders into the hourly digest bucket.
 * Returns the batch count to send (non-zero only once per hour),
 * or 0 if the digest window hasn't elapsed yet.
 */
export function flushFbsDigest(newOrders: number): number {
  pendingFbsDelta += Math.max(0, newOrders);
  if (pendingFbsDelta === 0) return 0;
  const now = Date.now();
  if (now - lastFbsDigestAt < FBS_DIGEST_INTERVAL_MS) return 0;
  const batch = pendingFbsDelta;
  pendingFbsDelta  = 0;
  lastFbsDigestAt  = now;
  return batch;
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


