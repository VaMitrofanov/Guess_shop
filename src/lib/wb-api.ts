import { z } from "zod";

function getWbToken(): string {
  // Strip surrounding quotes/whitespace that Coolify's UI can silently inject
  return (process.env.WB_API_TOKEN ?? "").trim().replace(/^["'`]|["'`]$/g, "").trim();
}

async function fetchWb<T>(url: string, schema: z.ZodType<T>, options: RequestInit = {}): Promise<T | null> {
  const token = getWbToken();
  if (!token) return null;
  try {
    const res = await fetch(url, {
      cache: "no-store",
      ...options,
      headers: { Authorization: token, "Content-Type": "application/json", ...options.headers },
    });
    if (!res.ok) {
      const path = url.replace(/^https?:\/\/[^/]+/, "").split("?")[0];
      console.error(`[wb-api] ${res.status} ${path}`);
      return null;
    }
    const parsed = schema.safeParse(await res.json());
    if (!parsed.success) {
      const path = url.replace(/^https?:\/\/[^/]+/, "").split("?")[0];
      console.error(`[wb-api] schema error ${path}:`, parsed.error.issues[0]);
    }
    return parsed.success ? parsed.data : null;
  } catch (e: any) {
    const path = url.replace(/^https?:\/\/[^/]+/, "").split("?")[0];
    console.error(`[wb-api] fetch error ${path}:`, e?.message ?? e);
    return null;
  }
}

// ── Schemas ────────────────────────────────────────────────────────────────

const OrderSchema = z.object({
  date: z.string(),
  supplierArticle: z.string(),
  priceWithDisc: z.number(),
  isCancel: z.boolean(),
});

const SaleSchema = z.object({
  date: z.string(),
  supplierArticle: z.string(),
  priceWithDisc: z.number(),
});

const StockSchema = z.object({
  supplierArticle: z.string(),
  quantity: z.number(),
  quantityFull: z.number(),
  inWayToClient: z.number().optional().default(0),
  inWayFromClient: z.number().optional().default(0),
  Price: z.number(),
});

const AdvertCountSchema = z.object({
  all: z.number().optional().default(0),
  adverts: z.array(z.object({
    type:   z.number().optional().default(0),
    status: z.number().optional().default(0),
    count:  z.number().optional().default(0),
    advert_list: z.array(z.object({ advertId: z.number() })).optional().default([]),
  })).optional().default([]),
});

const BudgetSchema = z.object({ total: z.number().optional().default(0) });

const FullStatsNmSchema = z.object({
  nmId: z.number(),
  sum:  z.number().optional().default(0),
});

const FullStatsSchema = z.array(z.object({
  advertId: z.number(),
  views:    z.number().optional().default(0),
  clicks:   z.number().optional().default(0),
  ctr:      z.number().optional().default(0),
  sum:      z.number().optional().default(0),
  orders:   z.number().optional().default(0),
  days: z.array(z.object({
    apps: z.array(z.object({
      nms: z.array(FullStatsNmSchema).optional().default([]),
    })).optional().default([]),
  })).optional().default([]),
}));

const RealizRowSchema = z.object({
  nm_id:                     z.number().optional().default(0),
  sa_name:                   z.string().optional().default(""),
  doc_type_name:             z.string().optional().default(""),
  quantity:                  z.number().optional().default(0),
  retail_price_withdisc_rub: z.number().optional().default(0),
  ppvz_for_pay:              z.number().optional().default(0),
  delivery_rub:              z.number().optional().default(0),
  ppvz_sales_commission:     z.number().optional().default(0),
  storage_fee:               z.number().optional().default(0),
  penalty:                   z.number().optional().default(0),
  deduction:                 z.number().optional().default(0),
  supplier_oper_name:        z.string().optional().default(""),
  sale_dt:                   z.string().optional().default(""),
});

// ── In-memory cache (survives across requests, resets on container restart) ─

const TTL = 90_000; // WB statistics API: ~1 req/minute per endpoint
const ADV_TTL = 120_000; // advert fullstats: generous TTL to avoid 429
type CacheEntry<T> = { data: T; ts: number };
const cache: {
  stats?:   CacheEntry<TwaStats30d>;
  stocks?:  CacheEntry<TwaStockItem[]>;
  advert?:  CacheEntry<AdvertPeriodData> & { fromDate: string };
  realiz?:  CacheEntry<TwaRealizData>;
} = {};

// ── Public API ─────────────────────────────────────────────────────────────

export interface TwaStats30d {
  orders: z.infer<typeof OrderSchema>[];
  sales:  z.infer<typeof SaleSchema>[];
}

export async function getStats30d(): Promise<TwaStats30d | null> {
  if (cache.stats && Date.now() - cache.stats.ts < TTL) return cache.stats.data;

  const dateFrom = new Date(Date.now() - 30 * 864e5).toISOString().split(".")[0] + "Z";
  const [orders, sales] = await Promise.all([
    fetchWb(`https://statistics-api.wildberries.ru/api/v1/supplier/orders?dateFrom=${encodeURIComponent(dateFrom)}&flag=0`, z.array(OrderSchema)),
    (async () => { await new Promise(r => setTimeout(r, 1500)); return fetchWb(`https://statistics-api.wildberries.ru/api/v1/supplier/sales?dateFrom=${encodeURIComponent(dateFrom)}`, z.array(SaleSchema)); })(),
  ]);

  if (orders && sales) {
    cache.stats = { data: { orders, sales }, ts: Date.now() };
    return cache.stats.data;
  }
  // Return stale cache on 429 / temporary failure rather than showing "API unavailable"
  return cache.stats?.data ?? null;
}

export interface TwaStockItem {
  article: string;
  quantity: number;
  quantityFull: number;
  inWayToClient: number;
  inWayFromClient: number;
  price: number;
}

export async function getStocks(): Promise<TwaStockItem[] | null> {
  if (cache.stocks && Date.now() - cache.stocks.ts < TTL) return cache.stocks.data;

  const raw = await fetchWb(
    "https://statistics-api.wildberries.ru/api/v1/supplier/stocks?dateFrom=2023-01-01T00:00:00Z",
    z.array(StockSchema)
  );
  if (!raw) return cache.stocks?.data ?? null;

  const grouped = new Map<string, TwaStockItem>();
  for (const s of raw) {
    const ex = grouped.get(s.supplierArticle) ?? { article: s.supplierArticle, quantity: 0, quantityFull: 0, inWayToClient: 0, inWayFromClient: 0, price: s.Price };
    ex.quantity += s.quantity;
    ex.quantityFull += s.quantityFull;
    ex.inWayToClient += s.inWayToClient;
    ex.inWayFromClient += s.inWayFromClient;
    grouped.set(s.supplierArticle, ex);
  }
  const result = [...grouped.values()];
  cache.stocks = { data: result, ts: Date.now() };
  return result;
}

export interface TwaAdvertData {
  totalActive: number;
  totalPaused: number;
  totalBudget: number;
  totalSpend7d: number;
  totalViews7d: number;
  totalClicks7d: number;
  totalOrders7d: number;
  avgCtr: number;
  avgCpo: number;
  campaigns: { id: number; status: number; balance: number; spend7d: number; orders7d: number }[];
}

export async function getAdvertData(): Promise<TwaAdvertData | null> {
  const countData = await fetchWb("https://advert-api.wildberries.ru/adv/v1/promotion/count", AdvertCountSchema);
  if (!countData || countData.adverts.length === 0) return null;

  const allCampaigns: { id: number; status: number }[] = [];
  let totalActive = 0, totalPaused = 0;
  for (const g of countData.adverts) {
    if (g.status === 11) totalActive += g.count;
    if (g.status === 9)  totalPaused += g.count;
    for (const c of g.advert_list) allCampaigns.push({ id: c.advertId, status: g.status });
  }

  // Budget per campaign
  let totalBudget = 0;
  const campaigns: TwaAdvertData["campaigns"] = [];
  for (const camp of allCampaigns.slice(0, 20)) {
    await new Promise(r => setTimeout(r, 300));
    const b = await fetchWb(`https://advert-api.wildberries.ru/adv/v1/budget?id=${camp.id}`, BudgetSchema);
    const balance = b?.total ?? 0;
    totalBudget += balance;
    campaigns.push({ id: camp.id, status: camp.status, balance, spend7d: 0, orders7d: 0 });
  }

  // 7-day fullstats
  let totalSpend7d = 0, totalViews7d = 0, totalClicks7d = 0, totalOrders7d = 0;
  if (allCampaigns.length > 0) {
    const endDate   = new Date().toISOString().split("T")[0];
    const beginDate = new Date(Date.now() - 7 * 864e5).toISOString().split("T")[0];
    const ids       = allCampaigns.slice(0, 50).map(c => c.id).join(",");
    await new Promise(r => setTimeout(r, 300));
    const fs = await fetchWb(`https://advert-api.wildberries.ru/adv/v3/fullstats?ids=${ids}&beginDate=${beginDate}&endDate=${endDate}`, FullStatsSchema);
    if (fs) {
      const sm = new Map<number, typeof fs[0]>();
      for (const s of fs) { sm.set(s.advertId, s); totalSpend7d += s.sum; totalViews7d += s.views; totalClicks7d += s.clicks; totalOrders7d += s.orders; }
      for (const c of campaigns) { const s = sm.get(c.id); if (s) { c.spend7d = s.sum; c.orders7d = s.orders; } }
    }
  }

  return {
    totalActive, totalPaused, totalBudget,
    totalSpend7d, totalViews7d, totalClicks7d, totalOrders7d,
    avgCtr:  totalViews7d  > 0 ? Math.round((totalClicks7d / totalViews7d) * 1000) / 10 : 0,
    avgCpo:  totalOrders7d > 0 ? Math.round(totalSpend7d / totalOrders7d) : 0,
    campaigns,
  };
}

export interface TwaRealizData {
  period: { from: string; to: string };
  salesCount:     number;
  returnCount:    number;
  totalRevenue:   number;
  totalPayout:    number;
  totalLogistics: number;
  totalStorage:   number;
  totalPenalties: number;
  byArticle: { article: string; sales: number; payout: number; commPct: number; logPerUnit: number; retPct: number; storagePerUnit: number }[];
}

export interface AdvertPeriodData {
  spend:           number;
  spendByNmId:     Record<number, number>; // nmId → ₽ spent in period
  advertisedNmIds: number[];               // nmIds with any spend > 0
}

// Returns ad spend breakdown from fromDate to today across all campaigns.
export async function getAdvertDataForPeriod(fromDate: string): Promise<AdvertPeriodData | null> {
  if (cache.advert && cache.advert.fromDate === fromDate && Date.now() - cache.advert.ts < ADV_TTL) return cache.advert.data;

  const countData = await fetchWb("https://advert-api.wildberries.ru/adv/v1/promotion/count", AdvertCountSchema);
  if (!countData || countData.adverts.length === 0) return null;

  const ids = countData.adverts.flatMap(g => g.advert_list.map(a => a.advertId)).slice(0, 50);
  if (ids.length === 0) return { spend: 0, spendByNmId: {}, advertisedNmIds: [] };

  const endDate = new Date().toISOString().split("T")[0];
  await new Promise(r => setTimeout(r, 300));
  const fs = await fetchWb(
    `https://advert-api.wildberries.ru/adv/v3/fullstats?ids=${ids.join(",")}&beginDate=${fromDate}&endDate=${endDate}`,
    FullStatsSchema
  );
  if (!fs) return cache.advert?.data ?? null;

  let spend = 0;
  const spendByNmId: Record<number, number> = {};
  for (const campaign of fs) {
    spend += campaign.sum;
    for (const day of campaign.days) {
      for (const app of day.apps) {
        for (const nm of app.nms) {
          spendByNmId[nm.nmId] = (spendByNmId[nm.nmId] ?? 0) + nm.sum;
        }
      }
    }
  }

  const advertisedNmIds = Object.entries(spendByNmId)
    .filter(([, s]) => s > 0)
    .map(([id]) => Number(id));

  const result: AdvertPeriodData = { spend, spendByNmId, advertisedNmIds };
  cache.advert = { data: result, ts: Date.now(), fromDate };
  return result;
}

// Thin wrapper for ad-attr route (only needs total spend)
export async function getAdvertSpendSince(fromDate: string): Promise<number | null> {
  const data = await getAdvertDataForPeriod(fromDate);
  return data ? data.spend : null;
}

export async function getRealizData(weeks = 4): Promise<TwaRealizData | null> {
  if (cache.realiz && Date.now() - cache.realiz.ts < TTL) return cache.realiz.data;

  const dateTo   = new Date().toISOString().split("T")[0];
  const dateFrom = new Date(Date.now() - weeks * 7 * 864e5).toISOString().split("T")[0];

  const rows = await fetchWb(
    `https://statistics-api.wildberries.ru/api/v5/supplier/reportDetailByPeriod?dateFrom=${dateFrom}&dateTo=${dateTo}&rrdid=0`,
    z.array(RealizRowSchema)
  );
  if (!rows) return cache.realiz?.data ?? null;
  if (rows.length === 0) return null;

  let salesCount = 0, returnCount = 0;
  let totalRevenue = 0, totalPayout = 0, totalLogistics = 0, totalStorage = 0, totalPenalties = 0;
  const byArt = new Map<string, { sales: number; returns: number; revenue: number; payout: number; logistics: number; commSum: number; storage: number }>();

  for (const row of rows) {
    const doc  = row.doc_type_name.toLowerCase();
    const oper = row.supplier_oper_name.toLowerCase();
    const key  = row.sa_name || String(row.nm_id);

    if (!key || key === "0") {
      if (oper.includes("хранение") || row.storage_fee > 0) totalStorage += row.storage_fee;
      else if (oper.includes("штраф")) totalPenalties += Math.abs(row.penalty) + Math.abs(row.deduction);
      continue;
    }

    const a = byArt.get(key) ?? { sales: 0, returns: 0, revenue: 0, payout: 0, logistics: 0, commSum: 0, storage: 0 };

    if (doc.includes("продажа")) {
      const qty = Math.abs(row.quantity) || 1;
      const rev = row.retail_price_withdisc_rub * qty;
      a.sales     += qty; a.revenue += rev; a.payout += row.ppvz_for_pay;
      a.logistics += row.delivery_rub;
      a.commSum   += rev - row.ppvz_for_pay - row.delivery_rub;
      salesCount  += qty; totalRevenue += rev; totalPayout += row.ppvz_for_pay; totalLogistics += row.delivery_rub;
    } else if (doc.includes("возврат")) {
      const qty = Math.abs(row.quantity) || 1;
      a.returns += qty; returnCount += qty;
      totalPayout += row.ppvz_for_pay;
    } else if (oper.includes("хранение") || row.storage_fee > 0) {
      a.storage    += row.storage_fee;
      totalStorage += row.storage_fee;
    } else if (doc.includes("штраф") || oper.includes("штраф")) {
      totalPenalties += Math.abs(row.penalty) + Math.abs(row.deduction);
    }
    byArt.set(key, a);
  }

  const realiz: TwaRealizData = {
    period: { from: dateFrom, to: dateTo },
    salesCount, returnCount, totalRevenue, totalPayout, totalLogistics, totalStorage, totalPenalties,
    byArticle: [...byArt.entries()].map(([article, a]) => ({
      article, sales: a.sales, payout: Math.round(a.payout),
      commPct:       a.revenue > 0 ? Math.round(((a.revenue - a.payout) / a.revenue) * 1000) / 10 : 0,
      logPerUnit:    a.sales > 0 ? Math.round(a.logistics / a.sales) : 0,
      retPct:        a.sales > 0 ? Math.round((a.returns / a.sales) * 100) : 0,
      storagePerUnit: a.sales > 0 ? Math.round((a.storage / a.sales) * 10) / 10 : 0,
    })).sort((a, b) => b.payout - a.payout),
  };
  cache.realiz = { data: realiz, ts: Date.now() };
  return realiz;
}
