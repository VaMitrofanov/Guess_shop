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
  // The operational feed contains both sales (S…) and returns (R…). Keep the
  // identifier even though the dashboard only uses this feed as a pulse.
  saleID: z.string().optional().default(""),
  srid: z.string().optional().default(""),
  sticker: z.string().optional().default(""),
});

const WbWarehouseStockSchema = z.object({
  nmId: z.number(),
  chrtId: z.number().optional().default(0),
  warehouseId: z.number().optional().default(0),
  warehouseName: z.string().optional().default(""),
  regionName: z.string().optional().default(""),
  quantity: z.number(),
  inWayToClient: z.number().optional().default(0),
  inWayFromClient: z.number().optional().default(0),
});

const WbWarehouseStocksResponseSchema = z.object({
  data: z.object({
    items: z.array(WbWarehouseStockSchema).optional().default([]),
  }).optional().default({ items: [] }),
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

const WbMoneySchema = z.union([z.number(), z.string()]).optional().default(0).transform(value => {
  const parsed = typeof value === "number" ? value : Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
});

// POST /finance/v1/sales-reports/detailed is the current finance API. Its
// money fields are strings, unlike the retired statistics v5 endpoint.
const RealizRowSchema = z.object({
  rrdId:                   z.number().optional().default(0),
  nmId:                    z.number().optional().default(0),
  vendorCode:              z.string().optional().default(""),
  docTypeName:             z.string().optional().default(""),
  quantity:                z.number().optional().default(0),
  retailPriceWithDisc:     WbMoneySchema,
  forPay:                  WbMoneySchema,
  deliveryService:         WbMoneySchema,
  ppvzSalesCommission:     WbMoneySchema,
  paidStorage:             WbMoneySchema,
  penalty:                 WbMoneySchema,
  deduction:               WbMoneySchema,
  additionalPayment:       WbMoneySchema,
  sellerOperName:          z.string().optional().default(""),
  saleDt:                  z.string().optional().default(""),
  srid:                    z.string().optional().default(""),
});

const SalesFunnelProductSchema = z.object({
  product: z.object({
    nmId: z.number(),
    vendorCode: z.string().optional().default(""),
  }),
  statistic: z.object({
    selected: z.object({
      orderCount: z.number().optional().default(0),
      buyoutCount: z.number().optional().default(0),
      buyoutSum: z.number().optional().default(0),
      cancelCount: z.number().optional().default(0),
      conversions: z.object({
        buyoutPercent: z.number().optional().default(0),
      }).optional().default({ buyoutPercent: 0 }),
    }).optional().default({
      orderCount: 0,
      buyoutCount: 0,
      buyoutSum: 0,
      cancelCount: 0,
      conversions: { buyoutPercent: 0 },
    }),
  }).optional().default({
    selected: { orderCount: 0, buyoutCount: 0, buyoutSum: 0, cancelCount: 0, conversions: { buyoutPercent: 0 } },
  }),
});

const SalesFunnelResponseSchema = z.object({
  data: z.object({
    products: z.array(SalesFunnelProductSchema).optional().default([]),
  }).optional().default({ products: [] }),
});

const NmReportCardSchema = z.object({
  nmID:        z.number(),
  vendorCode:  z.string().optional().default(""),
  statistics: z.array(z.object({
    selectedPeriod: z.object({
      openCardCount:   z.number().optional().default(0),
      addToCartCount:  z.number().optional().default(0),
      ordersCount:     z.number().optional().default(0),
      ordersSumRub:    z.number().optional().default(0),
      buyoutsCount:    z.number().optional().default(0),
      conversions: z.object({
        addToCartPercent:     z.number().optional().default(0),
        cartToOrderPercent:   z.number().optional().default(0),
        orderToBuyoutPercent: z.number().optional().default(0),
      }).optional(),
    }).optional(),
  })).optional().default([]),
});

const NmReportSchema = z.object({
  data: z.object({
    cards: z.array(NmReportCardSchema).optional().default([]),
  }).optional(),
});

const GoodItemSchema = z.object({
  nmID:             z.number(),
  vendorCode:       z.string().optional().default(""),
  // WB v2 nests price/discountedPrice inside sizes[]; discount stays top-level.
  price:            z.number().optional().default(0),
  discount:         z.number().optional().default(0),
  discountedPrice:  z.number().optional().default(0),
  sizes:            z.array(z.object({
    price:           z.number().optional().default(0),
    discountedPrice: z.number().optional().default(0),
    discount:        z.number().optional().default(0),
  })).optional().default([]),
});

const GoodsListSchema = z.object({
  data: z.object({
    listGoods: z.array(GoodItemSchema).optional().default([]),
  }).optional(),
});

const FeedbackItemSchema = z.object({
  id:               z.string(),
  text:             z.string().optional().default(""),
  pros:             z.string().optional().default(""),
  cons:             z.string().optional().default(""),
  productValuation: z.number().optional().default(0),
  createdDate:      z.string().optional().default(""),
  productDetails:   z.union([
    z.object({ supplierArticle: z.string().optional().default("") }),
    z.array(z.object({ supplierArticle: z.string().optional().default("") })),
  ]).optional().default({ supplierArticle: "" }),
  answer:           z.object({ text: z.string() }).nullable().optional(),
});

const FeedbacksResponseSchema = z.object({
  data: z.object({
    countUnanswered: z.number().optional().default(0),
    feedbacks:       z.array(FeedbackItemSchema).optional().default([]),
  }).optional(),
});

const QuestionItemSchema = z.object({
  id:          z.string(),
  text:        z.string().optional().default(""),
  createdDate: z.string().optional().default(""),
  productDetails: z.union([
    z.object({ supplierArticle: z.string().optional().default("") }),
    z.array(z.object({ supplierArticle: z.string().optional().default("") })),
  ]).optional().default({ supplierArticle: "" }),
  answer:      z.object({ text: z.string() }).nullable().optional(),
});

const QuestionsResponseSchema = z.object({
  data: z.object({
    countUnanswered: z.number().optional().default(0),
    questions:       z.array(QuestionItemSchema).optional().default([]),
  }).optional(),
});

const SupplySchema = z.object({
  id:        z.string(),
  done:      z.boolean().optional().default(false),
  createdAt: z.string().optional().default(""),
  closedAt:  z.string().nullable().optional(),
  name:      z.string().optional().default(""),
  cargoType: z.number().optional().default(0),
});

const SuppliesResponseSchema = z.object({
  supplies: z.array(SupplySchema).optional().default([]),
});

// ── In-memory cache (survives across requests, resets on container restart) ─

const TTL = 300_000; // WB statistics API: rate-limited per seller, 5-min cache reduces 429s
const ADV_TTL = 120_000; // advert fullstats: generous TTL to avoid 429
type CacheEntry<T> = { data: T; ts: number };
const cache: {
  stats?:    CacheEntry<TwaStats30d>;
  stocks?:   CacheEntry<TwaStockItem[]>;
  advert?:   CacheEntry<AdvertPeriodData> & { fromDate: string };
  realiz?:   CacheEntry<TwaRealizData> & { weeks: number };
  funnel?:   CacheEntry<NmFunnelItem[]>;
  feedback?: CacheEntry<FeedbackSummary>;
  supplies?: CacheEntry<TwaSupply[]>;
  goods?:    CacheEntry<TwaGoodItem[]>;
} = {};

// ── Public API ─────────────────────────────────────────────────────────────

export interface TwaStats30d {
  orders: z.infer<typeof OrderSchema>[];
  sales:  z.infer<typeof SaleSchema>[];
}

export async function getStats30d(): Promise<TwaStats30d | null> {
  if (cache.stats && Date.now() - cache.stats.ts < TTL) return cache.stats.data;

  const dateFrom = new Date(Date.now() - 30 * 864e5).toISOString().split(".")[0] + "Z";
  const orders = await fetchWb(
    `https://statistics-api.wildberries.ru/api/v1/supplier/orders?dateFrom=${encodeURIComponent(dateFrom)}&flag=0`,
    z.array(OrderSchema),
  );
  await new Promise(r => setTimeout(r, 2000));
  const sales = await fetchWb(
    `https://statistics-api.wildberries.ru/api/v1/supplier/sales?dateFrom=${encodeURIComponent(dateFrom)}`,
    z.array(SaleSchema),
  );

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

  // The old statistics /supplier/stocks method was retired by WB. The current
  // endpoint is warehouse-granular and deliberately does not include price or
  // vendorCode, so join it with the catalog response by nmId.
  const [raw, goods] = await Promise.all([
    fetchWb(
      "https://seller-analytics-api.wildberries.ru/api/analytics/v1/stocks-report/wb-warehouses",
      WbWarehouseStocksResponseSchema,
      {
        method: "POST",
        body: JSON.stringify({ nmIds: [], chrtIds: [], limit: 250_000, offset: 0 }),
      },
    ),
    getGoods(),
  ]);
  if (!raw) return cache.stocks?.data ?? null;

  const goodsByNmId = new Map((goods ?? []).map(g => [g.nmID, g]));

  const grouped = new Map<string, TwaStockItem>();
  for (const s of raw.data.items) {
    const product = goodsByNmId.get(s.nmId);
    const article = product?.article || String(s.nmId);
    const ex = grouped.get(article) ?? {
      article,
      quantity: 0,
      // Kept for the existing TWA contract. The replacement API has no
      // quantityFull equivalent; do not silently treat in-transit goods as
      // sellable stock.
      quantityFull: 0,
      inWayToClient: 0,
      inWayFromClient: 0,
      price: product?.discountedPrice ?? 0,
    };
    ex.quantity += s.quantity;
    ex.quantityFull += s.quantity;
    ex.inWayToClient += s.inWayToClient;
    ex.inWayFromClient += s.inWayFromClient;
    grouped.set(article, ex);
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
  totalAdditionalPayments: number;
  byArticle: { article: string; sales: number; payout: number; commPct: number; logPerUnit: number; retPct: number; storagePerUnit: number; penaltyPerUnit: number }[];
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
  if (cache.realiz && cache.realiz.weeks === weeks && Date.now() - cache.realiz.ts < TTL) return cache.realiz.data;

  const dateTo   = new Date().toISOString().split("T")[0];
  const dateFrom = new Date(Date.now() - weeks * 7 * 864e5).toISOString().split("T")[0];

  const rows = await fetchWb(
    "https://finance-api.wildberries.ru/api/finance/v1/sales-reports/detailed",
    z.array(RealizRowSchema),
    {
      method: "POST",
      body: JSON.stringify({
        dateFrom,
        dateTo,
        limit: 100_000,
        rrdId: 0,
        period: "weekly",
        fields: [
          "rrdId", "nmId", "vendorCode", "docTypeName", "quantity",
          "retailPriceWithDisc", "forPay", "deliveryService", "ppvzSalesCommission",
          "paidStorage", "penalty", "deduction", "additionalPayment",
          "sellerOperName", "saleDt", "srid",
        ],
      }),
    },
  );
  if (!rows) return cache.realiz?.data ?? null;
  if (rows.length === 0) return null;

  let salesCount = 0, returnCount = 0;
  let totalRevenue = 0, totalPayout = 0, totalLogistics = 0, totalStorage = 0, totalPenalties = 0, totalAdditionalPayments = 0;
  const byArt = new Map<string, {
    sales: number; returns: number; revenue: number; payout: number;
    logistics: number; storage: number; penalties: number;
  }>();

  for (const row of rows) {
    const doc  = row.docTypeName.toLowerCase();
    const oper = row.sellerOperName.toLowerCase();
    const key  = row.vendorCode || (row.nmId > 0 ? String(row.nmId) : "");
    const penalties = Math.abs(row.penalty) + Math.abs(row.deduction);

    // Financial operations arrive as separate lines. Count every fee exactly
    // once, whether WB attached it to a sale, a logistics event, or a general
    // retention. Product-level allocation is only made when WB supplied an SKU.
    totalLogistics += row.deliveryService;
    totalStorage += row.paidStorage;
    totalPenalties += penalties;
    totalAdditionalPayments += row.additionalPayment;

    if (!key) continue;
    const a = byArt.get(key) ?? { sales: 0, returns: 0, revenue: 0, payout: 0, logistics: 0, storage: 0, penalties: 0 };
    a.logistics += row.deliveryService;
    a.storage += row.paidStorage;
    a.penalties += penalties;

    if (doc.includes("продажа") && oper.includes("продажа")) {
      const qty = Math.abs(row.quantity) || 1;
      const rev = row.retailPriceWithDisc * qty;
      a.sales += qty;
      a.revenue += rev;
      a.payout += row.forPay;
      salesCount += qty;
      totalRevenue += rev;
      totalPayout += row.forPay;
    } else if (doc.includes("возврат")) {
      const qty = Math.abs(row.quantity) || 1;
      a.returns += qty;
      returnCount += qty;
      totalPayout += row.forPay;
    }
    byArt.set(key, a);
  }

  const realiz: TwaRealizData = {
    period: { from: dateFrom, to: dateTo },
    salesCount, returnCount, totalRevenue, totalPayout, totalLogistics, totalStorage, totalPenalties, totalAdditionalPayments,
    byArticle: [...byArt.entries()].map(([article, a]) => ({
      article, sales: a.sales, payout: Math.round(a.payout),
      // Effective marketplace deduction after separately accounted logistics.
      // It includes WB commission and acquiring; it is intentionally not
      // presented as the catalog tariff.
      commPct:       a.revenue > 0 ? Math.round(((a.revenue - a.payout - a.logistics) / a.revenue) * 1000) / 10 : 0,
      logPerUnit:    a.sales > 0 ? Math.round(a.logistics / a.sales) : 0,
      retPct:        a.sales > 0 ? Math.round((a.returns / a.sales) * 100) : 0,
      storagePerUnit: a.sales > 0 ? Math.round((a.storage / a.sales) * 10) / 10 : 0,
      penaltyPerUnit: a.sales > 0 ? Math.round((a.penalties / a.sales) * 10) / 10 : 0,
    })).sort((a, b) => b.payout - a.payout),
  };
  cache.realiz = { data: realiz, ts: Date.now(), weeks };
  return realiz;
}

export interface NmFunnelItem {
  article:   string;
  orders:    number;
  buyouts:   number;
  revenue:   number;
  pctBuyout: number;
  retPct:    number;
}

export interface TwaGoodItem {
  nmID:            number;
  article:         string;
  price:           number;
  discount:        number;
  discountedPrice: number;
}

export interface FeedbackSummary {
  unansweredFeedbacks: number;
  unansweredQuestions: number;
  items: {
    id: string; type: "feedback" | "question";
    text: string; rating?: number;
    date: string; article: string; answered: boolean;
  }[];
}

export interface TwaSupply {
  id: string; done: boolean;
  createdAt: string; closedAt: string | null;
  name: string; cargoType: number;
}

const FUNNEL_TTL   = 20 * 60_000;
const FEEDBACK_TTL =  5 * 60_000;
const SUPPLY_TTL   = 10 * 60_000;
const GOODS_TTL    = 10 * 60_000;

export async function getGoods(): Promise<TwaGoodItem[] | null> {
  if (cache.goods && Date.now() - cache.goods.ts < GOODS_TTL) return cache.goods.data;
  const token = getWbToken();
  if (!token) return null;
  try {
    const res = await fetch(
      "https://discounts-prices-api.wildberries.ru/api/v2/list/goods/filter?limit=100&offset=0",
      { cache: "no-store", headers: { Authorization: token } },
    );
    if (!res.ok) { console.error(`[wb-api] goods ${res.status}`); return cache.goods?.data ?? null; }
    const parsed = GoodsListSchema.safeParse(await res.json());
    if (!parsed.success) return cache.goods?.data ?? null;
    const result: TwaGoodItem[] = (parsed.data.data?.listGoods ?? []).map(g => {
      const sz = g.sizes?.[0];
      return {
        nmID: g.nmID, article: g.vendorCode,
        price:           sz?.price           || g.price,
        discount:        g.discount          || sz?.discount || 0,
        discountedPrice: sz?.discountedPrice || g.discountedPrice,
      };
    });
    cache.goods = { data: result, ts: Date.now() };
    return result;
  } catch (e: any) {
    console.error("[wb-api] goods error:", e?.message);
    return cache.goods?.data ?? null;
  }
}

export async function getNmFunnel(): Promise<NmFunnelItem[] | null> {
  if (cache.funnel && Date.now() - cache.funnel.ts < FUNNEL_TTL) return cache.funnel.data;

  const [goods, realiz] = await Promise.all([getGoods(), getRealizData()]);
  const nmIds = (goods ?? []).map(g => g.nmID);
  if (nmIds.length === 0) return cache.funnel?.data ?? null;

  // Use completed UTC days: the current day is still mutable in WB, while a
  // 30-day card should be reproducible throughout the day.
  const dateEnd = new Date(Date.now() - 864e5);
  const selectedStart = new Date(dateEnd.getTime() - 29 * 864e5);
  const pastEnd = new Date(selectedStart.getTime() - 864e5);
  const pastStart = new Date(pastEnd.getTime() - 29 * 864e5);
  const formatDate = (date: Date) => date.toISOString().split("T")[0];
  const raw = await fetchWb(
    "https://seller-analytics-api.wildberries.ru/api/analytics/v3/sales-funnel/products",
    SalesFunnelResponseSchema,
    {
      method: "POST",
      body: JSON.stringify({
        selectedPeriod: { start: formatDate(selectedStart), end: formatDate(dateEnd) },
        pastPeriod: { start: formatDate(pastStart), end: formatDate(pastEnd) },
        nmIds,
        brandNames: [],
        subjectIds: [],
        tagIds: [],
        skipDeletedNm: false,
        orderBy: { field: "orderCount", mode: "desc" },
        limit: 1_000,
        offset: 0,
      }),
    },
  );
  if (!raw) return cache.funnel?.data ?? null;

  const retByArticle = new Map<string, number>(
    (realiz?.byArticle ?? []).map(a => [a.article, a.retPct])
  );

  const result: NmFunnelItem[] = raw.data.products
    .map(item => ({
      article: item.product.vendorCode || String(item.product.nmId),
      orders: item.statistic.selected.orderCount,
      buyouts: item.statistic.selected.buyoutCount,
      revenue: item.statistic.selected.buyoutSum,
      // WB calculates this from completed outcomes, so active deliveries do
      // not create impossible 100%+ ratios.
      pctBuyout: item.statistic.selected.conversions.buyoutPercent,
      retPct: retByArticle.get(item.product.vendorCode || String(item.product.nmId)) ?? 0,
    }))
    .filter(item => item.orders > 0 || item.buyouts > 0)
    .sort((a, b) => b.orders - a.orders);

  cache.funnel = { data: result, ts: Date.now() };
  return result;
}

function extractArticle(pd: unknown): string {
  if (Array.isArray(pd)) return (pd[0] as any)?.supplierArticle ?? "";
  return (pd as any)?.supplierArticle ?? "";
}

function feedbackText(f: { text: string; pros?: string; cons?: string }): string {
  if (f.text) return f.text;
  const parts: string[] = [];
  if (f.pros) parts.push(f.pros);
  if (f.cons) parts.push(`Минусы: ${f.cons}`);
  return parts.join("\n") || "";
}

export async function getFeedbackSummary(): Promise<FeedbackSummary | null> {
  if (cache.feedback && Date.now() - cache.feedback.ts < FEEDBACK_TTL) return cache.feedback.data;
  const token = getWbToken();
  if (!token) return null;
  try {
    const hdrs = { cache: "no-store" as const, headers: { Authorization: token } };
    const [fbUnanswered, fbAnswered, qUnanswered, qAnswered] = await Promise.all([
      fetch("https://feedbacks-api.wildberries.ru/api/v1/feedbacks?isAnswered=false&take=30&skip=0", hdrs).catch(() => null),
      fetch("https://feedbacks-api.wildberries.ru/api/v1/feedbacks?isAnswered=true&take=30&skip=0",  hdrs).catch(() => null),
      fetch("https://feedbacks-api.wildberries.ru/api/v1/questions?isAnswered=false&take=30&skip=0", hdrs).catch(() => null),
      fetch("https://feedbacks-api.wildberries.ru/api/v1/questions?isAnswered=true&take=30&skip=0",  hdrs).catch(() => null),
    ]);
    const fbUJson = fbUnanswered?.ok ? FeedbacksResponseSchema.safeParse(await fbUnanswered.json()) : null;
    const fbAJson = fbAnswered?.ok   ? FeedbacksResponseSchema.safeParse(await fbAnswered.json())   : null;
    const qUJson  = qUnanswered?.ok  ? QuestionsResponseSchema.safeParse(await qUnanswered.json())  : null;
    const qAJson  = qAnswered?.ok    ? QuestionsResponseSchema.safeParse(await qAnswered.json())    : null;
    const fbUData = fbUJson?.success ? fbUJson.data.data : null;
    const fbAData = fbAJson?.success ? fbAJson.data.data : null;
    const qUData  = qUJson?.success  ? qUJson.data.data  : null;
    const qAData  = qAJson?.success  ? qAJson.data.data  : null;
    const seen = new Set<string>();
    const allFb = [...(fbUData?.feedbacks ?? []), ...(fbAData?.feedbacks ?? [])];
    const allQ  = [...(qUData?.questions  ?? []), ...(qAData?.questions  ?? [])];
    const items = [
      ...allFb.filter(f => { if (seen.has(f.id)) return false; seen.add(f.id); return true; }).map(f => ({
        id: f.id, type: "feedback" as const,
        text: feedbackText(f), rating: f.productValuation,
        date: f.createdDate,
        article: extractArticle(f.productDetails),
        answered: !!f.answer?.text,
      })),
      ...allQ.filter(q => { if (seen.has(q.id)) return false; seen.add(q.id); return true; }).map(q => ({
        id: q.id, type: "question" as const,
        text: q.text, rating: undefined,
        date: q.createdDate,
        article: extractArticle(q.productDetails),
        answered: !!q.answer?.text,
      })),
    ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const result: FeedbackSummary = {
      unansweredFeedbacks: fbUData?.countUnanswered ?? 0,
      unansweredQuestions:  qUData?.countUnanswered ?? 0,
      items,
    };
    cache.feedback = { data: result, ts: Date.now() };
    return result;
  } catch (e: any) {
    console.error("[wb-api] feedback error:", e?.message);
    return cache.feedback?.data ?? null;
  }
}

export async function getSupplies(): Promise<TwaSupply[] | null> {
  if (cache.supplies && Date.now() - cache.supplies.ts < SUPPLY_TTL) return cache.supplies.data;
  const token = getWbToken();
  if (!token) return null;
  try {
    const res = await fetch(
      "https://marketplace-api.wildberries.ru/api/v3/supplies?limit=10&next=0",
      { cache: "no-store", headers: { Authorization: token } },
    );
    if (!res.ok) { console.error(`[wb-api] supplies ${res.status}`); return cache.supplies?.data ?? null; }
    const parsed = SuppliesResponseSchema.safeParse(await res.json());
    if (!parsed.success) return cache.supplies?.data ?? null;
    const result: TwaSupply[] = parsed.data.supplies.map(s => ({
      ...s, closedAt: s.closedAt ?? null,
    }));
    cache.supplies = { data: result, ts: Date.now() };
    return result;
  } catch (e: any) {
    console.error("[wb-api] supplies error:", e?.message);
    return cache.supplies?.data ?? null;
  }
}
