import { z } from "zod";


const wbCodeEnv = process.env.WB_API_TOKEN || "";

// ── Zod Schemas ─────────────────────────────────────────────────────────────


const StockSchema = z.object({
  lastChangeDate:  z.string(),
  supplierArticle: z.string(),
  barcode:         z.string(),
  quantity:        z.number(),
  quantityFull:    z.number(),
  inWayToClient:   z.number().optional().default(0),
  inWayFromClient: z.number().optional().default(0),
  Price:    z.number(),
  Discount: z.number(),
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


export interface WbStock {
  article: string;
  quantity: number;
  quantityFull: number;
  inWayToClient: number;
  inWayFromClient: number;
  price: number;
}


export interface UnitEconInput {
  price:          number; // продажная цена ₽ (с учётом скидки продавца)
  denomination:   number; // номинал Robux
  commissionPct:  number; // 0–1
  taxRate:        number; // 0–1
  logisticsCost:  number; // ₽/ед
  storagePerUnit: number; // ₽/ед
  adCostPerUnit:  number; // ₽/ед
  kursRb:         number;
  kursUsd:        number;
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


export interface WbStockWithRunway extends WbStock {
  avgDailySales: number;
  runwayDays: number;
}



// ── Helper ───────────────────────────────────────────────────────────────────


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
  const grouped = new Map<string, { q: number, qf: number, p: number, toClient: number, fromClient: number }>();

  for (const s of stocks) {
    const existing = grouped.get(s.supplierArticle) || { q: 0, qf: 0, p: s.Price, toClient: 0, fromClient: 0 };
    existing.q += s.quantity;
    existing.qf += s.quantityFull;
    existing.toClient   += s.inWayToClient;
    existing.fromClient += s.inWayFromClient;
    grouped.set(s.supplierArticle, existing);
  }

  for (const [article, data] of grouped.entries()) {
    res.push({
      article,
      quantity: data.q,
      quantityFull: data.qf,
      inWayToClient:   data.toClient,
      inWayFromClient: data.fromClient,
      price: data.p,
    });
  }

  setToCache(cacheKey, res, 10 * 60 * 1000); // 10 min cache for stocks
  return res;
}


/**
 * Stocks enriched with runway (days of remaining inventory).
 * Runway = current_stock / avg_daily_orders over last 14 days.
 *
 * ⚠️ Продажи для среднего брались из кэша статистики, который заполняли только
 * экраны старого TG-хаба (удалены 11.11.2026; монитор их не вызывал). На проде
 * кэш был пуст всегда → runway = 999, и алерт «мало кодов» (runway < 7) не
 * срабатывал никогда. Поведение сохранено; починка — отдельной задачей.
 */
export async function getStocksWithRunway(): Promise<WbStockWithRunway[] | null> {
  const stocks = await getStocks();
  if (!stocks) return null;

  const avgMap = new Map<string, number>();

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


// ── WB Settings (unit economics global config) ───────────────────────────────


// ── Реализация report ─────────────────────────────────────────────────────────


// ── Advert statistics ─────────────────────────────────────────────────────────
// WB removed /adv/v1/promotion/adverts and /adv/v2/fullstats endpoints.
// Working endpoints: /adv/v1/promotion/count (IDs+statuses) + /adv/v1/budget?id=X


// ── Tariffs: category commission + logistics/storage ───────────────────────────
// These let the unit-economics calculator use REAL WB rates instead of hardcoded
// defaults, and forecast margin for products without sales history.



// ── Pure unit-economics math (shared by the product loop and the what-if calc) ──


/** Required selling price to hit a target net margin (0–1). 0 if unattainable. */
export function priceForTargetMargin(i: Omit<UnitEconInput, "price">, targetMargin: number): number {
  const robuxCost  = i.kursRb * i.kursUsd * i.denomination / 700;
  const fixedCosts = i.logisticsCost + i.storagePerUnit + i.adCostPerUnit + robuxCost;
  const k          = (1 - i.commissionPct) * (1 - i.taxRate) - targetMargin;
  return k > 0 ? Math.round(fixedCosts / k) : 0;
}

