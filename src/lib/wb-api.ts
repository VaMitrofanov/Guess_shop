import { z } from "zod";

async function fetchWb<T>(url: string, schema: z.ZodType<T>, options: RequestInit = {}): Promise<T | null> {
  const token = process.env.WB_API_TOKEN ?? "";
  if (!token) return null;
  try {
    const res = await fetch(url, {
      cache: "no-store",
      ...options,
      headers: { Authorization: token, "Content-Type": "application/json", ...options.headers },
    });
    if (!res.ok) return null;
    return schema.parse(await res.json());
  } catch { return null; }
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

const FullStatsSchema = z.array(z.object({
  advertId: z.number(),
  views:    z.number().optional().default(0),
  clicks:   z.number().optional().default(0),
  ctr:      z.number().optional().default(0),
  sum:      z.number().optional().default(0),
  orders:   z.number().optional().default(0),
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

// ── Public API ─────────────────────────────────────────────────────────────

export interface TwaStats30d {
  orders: z.infer<typeof OrderSchema>[];
  sales:  z.infer<typeof SaleSchema>[];
}

export async function getStats30d(): Promise<TwaStats30d | null> {
  const dateFrom = new Date(Date.now() - 30 * 864e5).toISOString().split(".")[0] + "Z";
  const [orders, sales] = await Promise.all([
    fetchWb(`https://statistics-api.wildberries.ru/api/v1/supplier/orders?dateFrom=${encodeURIComponent(dateFrom)}&flag=0`, z.array(OrderSchema)),
    (async () => { await new Promise(r => setTimeout(r, 1500)); return fetchWb(`https://statistics-api.wildberries.ru/api/v1/supplier/sales?dateFrom=${encodeURIComponent(dateFrom)}`, z.array(SaleSchema)); })(),
  ]);
  if (!orders || !sales) return null;
  return { orders, sales };
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
  const raw = await fetchWb(
    "https://statistics-api.wildberries.ru/api/v1/supplier/stocks?dateFrom=2023-01-01T00:00:00Z",
    z.array(StockSchema)
  );
  if (!raw) return null;

  const grouped = new Map<string, TwaStockItem>();
  for (const s of raw) {
    const ex = grouped.get(s.supplierArticle) ?? { article: s.supplierArticle, quantity: 0, quantityFull: 0, inWayToClient: 0, inWayFromClient: 0, price: s.Price };
    ex.quantity += s.quantity;
    ex.quantityFull += s.quantityFull;
    ex.inWayToClient += s.inWayToClient;
    ex.inWayFromClient += s.inWayFromClient;
    grouped.set(s.supplierArticle, ex);
  }
  return [...grouped.values()];
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
  byArticle: { article: string; sales: number; payout: number; commPct: number; logPerUnit: number; retPct: number }[];
}

export async function getRealizData(weeks = 4): Promise<TwaRealizData | null> {
  const dateTo   = new Date().toISOString().split("T")[0];
  const dateFrom = new Date(Date.now() - weeks * 7 * 864e5).toISOString().split("T")[0];

  const rows = await fetchWb(
    `https://statistics-api.wildberries.ru/api/v5/supplier/reportDetailByPeriod?dateFrom=${dateFrom}&dateTo=${dateTo}&rrdid=0`,
    z.array(RealizRowSchema)
  );
  if (!rows || rows.length === 0) return null;

  let salesCount = 0, returnCount = 0;
  let totalRevenue = 0, totalPayout = 0, totalLogistics = 0, totalStorage = 0, totalPenalties = 0;
  const byArt = new Map<string, { sales: number; returns: number; revenue: number; payout: number; logistics: number; commSum: number }>();

  for (const row of rows) {
    const doc  = row.doc_type_name.toLowerCase();
    const oper = row.supplier_oper_name.toLowerCase();
    const key  = row.sa_name || String(row.nm_id);

    if (!key || key === "0") {
      if (oper.includes("хранение") || row.storage_fee > 0) totalStorage += row.storage_fee;
      else if (oper.includes("штраф")) totalPenalties += Math.abs(row.penalty) + Math.abs(row.deduction);
      continue;
    }

    const a = byArt.get(key) ?? { sales: 0, returns: 0, revenue: 0, payout: 0, logistics: 0, commSum: 0 };

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
      totalStorage += row.storage_fee;
    } else if (doc.includes("штраф") || oper.includes("штраф")) {
      totalPenalties += Math.abs(row.penalty) + Math.abs(row.deduction);
    }
    byArt.set(key, a);
  }

  return {
    period: { from: dateFrom, to: dateTo },
    salesCount, returnCount, totalRevenue, totalPayout, totalLogistics, totalStorage, totalPenalties,
    byArticle: [...byArt.entries()].map(([article, a]) => ({
      article, sales: a.sales, payout: Math.round(a.payout),
      commPct:    a.revenue > 0 ? Math.round(((a.revenue - a.payout) / a.revenue) * 1000) / 10 : 0,
      logPerUnit: a.sales > 0 ? Math.round(a.logistics / a.sales) : 0,
      retPct:     a.sales > 0 ? Math.round((a.returns / a.sales) * 100) : 0,
    })).sort((a, b) => b.payout - a.payout),
  };
}
