import { revalidateTag } from "next/cache";
import { after, NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-access";
import { prisma } from "@/lib/prisma";
import { notifyOrderCompleted, notifyOrderRejected, notifyRebind, notifyGamepassAttached, notifyGpWatchPing, notifyRegionalPriceNeeded } from "@/lib/twa-notify";
import { searchForSalePassesByNick } from "@/lib/roblox-gamepass-search";
import { getGamepassById } from "@/lib/roblox";
import { BuyoutError, parseGamepassId, purchaseGamepassWithCookie, resolveGamepass, resolveGamepassForBuyer, verifyGamepassOwnership, type ResolvedGamepass } from "@/lib/roblox-buyout";
import { browserFailureMessage, isBrowserInfrastructureFailure } from "@/lib/browser-purchase";
import { buildGamepassPurchaseScript, gamepassPageUrl } from "@/lib/roblox-purchase-script";
import { BUYOUT_ERROR_LEGACY_PURCHASE_FLOW, BUYOUT_ERROR_REGIONAL_PRICE, BUYOUT_ERROR_ROBLOX_PLUS_FLOW, PRICE_TOL, checkGamepassPrice, expectedGamepassPrice, sellerMatchesOrder } from "@/lib/purchase-guard";
import { buildOrderProfitSnapshot } from "@/lib/order-profit";
import { appendOrderAudit, buildRestoreToBuyoutData } from "@/lib/order-recovery";
import { recordOrderStatusChange } from "@/lib/order-status-event";
import { notifyRetailBuyoutAdmins } from "@/lib/buyout-admin-notify";
import { generateDirectCode } from "@/lib/twa-direct";
import { directPrice } from "@/lib/retail-pricing";
import { PAID_BUYOUT_SCOPE, PAID_BUYOUT_SQL, isUnpaidDirect } from "@/lib/buyout-queue";
import {
  assertSplitCoversOrder,
  buildSplitParts,
  describeSplitProgress,
  nextUnpurchasedPart,
  partPriceMatches,
  splitChargedTotal,
  splitIsComplete,
  SplitError,
  type StoredPart,
} from "@/lib/order-gamepass-split";
import {
  ATTENTION_BUYOUT_HOURS, ATTENTION_LINK_DAYS, NEW_CUTOFF_HOURS, STALE_LINK_DAYS,
  buildTabWhere, isGamepassExportTab, loadGamepassExport, orderByForTab,
  type FilterTab,
} from "@/lib/order-queue";
import {
  NOT_HELD_SQL, assertOrderNotHeld, heldRefusal, holdByCode, normalizeHoldCode, releaseByCode,
} from "@/lib/order-hold";
import {
  buildNarrowWhere, isNarrowed, loadOrderSlices, parseNarrow, type OrderSlicesPayload,
} from "@/lib/order-slices";
import { resolveWbOrderSource } from "../../../../../bots/shared/wb-order-source";

const VALID_STATUSES = ["AWAITING_PAYMENT", "PAYMENT_PENDING", "AWAITING_GAMEPASS", "PENDING", "IN_PROGRESS", "COMPLETED", "REJECTED", "ERROR"] as const;
type OrderStatus = typeof VALID_STATUSES[number];
// «Ждут ссылку»: первые N карточек — самые свежие (клиент ещё тёплый), дальше
// хвост очереди от самых старых к новым.
const AWAITING_LINK_HEAD = 5;
// «Требуют внимания» (секция на вкладке «Все»): пороги просроченности —
// в @/lib/order-queue, общие с веб-админкой.
const ATTENTION_TAKE = 50;

let cachedCounts: {
  data: Record<string, number>;
  sums: Record<string, number>;
  oldest: Record<string, string | null>;
  /** Шапка среза: деньги, полосы, препятствия, возраст, «сегодня». */
  slices: OrderSlicesPayload;
  ts: number;
} | null = null;
const COUNT_CACHE_TTL = 30_000;

// ── П5: живая цена геймпасса для карточек очереди (кэш product-info) ────────
const gpInfoCache = new Map<string, { price: number | null; isForSale: boolean; ts: number }>();
const GP_INFO_TTL = 10 * 60_000;

function gpIdOf(url: string | null | undefined): string | null {
  const m = url?.match(/game-pass(?:es)?\/(\d+)/);
  return m ? m[1] : null;
}

async function getGpInfoCached(gpId: string): Promise<{ price: number | null; isForSale: boolean } | null> {
  const hit = gpInfoCache.get(gpId);
  if (hit && Date.now() - hit.ts < GP_INFO_TTL) return hit;
  const urls = [
    `https://apis.roblox.com/game-passes/v1/game-passes/${gpId}/product-info`,
    `https://apis.roproxy.com/game-passes/v1/game-passes/${gpId}/product-info`,
  ];
  for (const url of urls) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (r.ok) {
        const j: any = await r.json().catch(() => null);
        if (!j) continue;
        const entry = { price: j.PriceInRobux ?? null, isForSale: j.IsForSale ?? false, ts: Date.now() };
        gpInfoCache.set(gpId, entry);
        return entry;
      }
    } catch { /* try next */ }
  }
  return null;
}

/* ── Данные пасса для ПРИВЯЗКИ (не для покупки) ──────────────────────────────
   Привязать разбиение и выкупить его — разные по цене ошибки, и источник
   данных у них поэтому разный.

   03.09.2026: разбиение спрашивало пасс только у серверного браузера
   (`resolveGamepassForBuyer`), а тот лежал — и вся операция падала с «Браузерный
   сервис выкупа недоступен». При этом разбиение НИЧЕГО не тратит: оно лишь
   записывает, какими пассами закрывается заказ. Деньги стережёт покупка, и она
   заново спрашивает донорскую цену и заново прогоняет ЦЕНА-СТОП и ПРОДАВЕЦ-СТОП
   прямо перед списанием — то есть уронить привязку из-за упавшего браузера
   значит потерять работу админа, ничего не выиграв в безопасности.

   Порядок источников: донорская цена (она точнее — видит региональную), потом
   публичная карточка через мост (`getGamepassById`; с российского хоста прямой
   путь до Roblox не работает вовсе, см. `roblox-bridge.ts`). Если не ответил
   никто — `info: null`, и вызывающий сам решает, что делать с непроверенной
   частью.
   ────────────────────────────────────────────────────────────────────────── */
interface BindingInfo {
  name: string;
  /** Цена, которую платит донор (у неё бывает региональная скидка). */
  price: number;
  /** Цена продавца — по ней и сверяется номинал части. */
  basePrice: number | null;
  sellerName: string | null;
  isForSale: boolean;
}

/** Сколько ждём каждый источник: разбиение — операция «на глазах», не крон. */
const BINDING_DONOR_BUDGET_MS = 20_000;
const BINDING_PUBLIC_BUDGET_MS = 15_000;

/** Ждать ответ не дольше бюджета; провал и таймаут неразличимы — оба `null`. */
function withBudget<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      () => { clearTimeout(timer); resolve(null); },
    );
  });
}

async function resolveGamepassForBinding(
  gamepassId: string,
  cookie: string | null | undefined,
): Promise<{ info: BindingInfo | null; reason: string | null }> {
  let reason: string | null = null;
  if (cookie) {
    // Бюджет здесь не роскошь: preflight серверного браузера ждёт ответа до
    // 70 секунд, и лежащий браузер иначе держал бы модалку разбиения минуту
    // на каждый уникальный пасс.
    const donor = await withBudget(
      resolveGamepassForBuyer(gamepassId, cookie).then(
        (value) => ({ value, error: null as string | null }),
        (err: unknown) => ({ value: null, error: err instanceof Error ? err.message : "Roblox не ответил" }),
      ),
      BINDING_DONOR_BUDGET_MS,
    );
    if (donor?.value) {
      const info = donor.value;
      return {
        info: {
          name: info.name ?? "Gamepass",
          price: info.price,
          basePrice: info.basePriceInRobux ?? info.price,
          sellerName: info.sellerName,
          isForSale: info.isForSale,
        },
        reason: null,
      };
    }
    reason = donor?.error ?? "донор не ответил вовремя";
  }

  const publicInfo = await withBudget(getGamepassById(gamepassId), BINDING_PUBLIC_BUDGET_MS);
  if (publicInfo) {
    return {
      info: {
        name: publicInfo.name ?? "Gamepass",
        price: publicInfo.price,
        basePrice: publicInfo.price,
        sellerName: publicInfo.creatorName ?? null,
        isForSale: publicInfo.isForSale !== false,
      },
      reason: null,
    };
  }
  return { info: null, reason: reason ?? "Roblox не ответил ни через донора, ни публично" };
}

// Дописать аудит-строку к adminNote (обрезка до 2000, как в attach-gamepass);
// одна и та же пометка повторно не дублируется (как annotateOnce автовыкупа).
async function appendAdminNote(orderId: string, line: string): Promise<void> {
  try {
    const o = await (prisma as any).wbOrder.findUnique({ where: { id: orderId }, select: { adminNote: true } });
    if (o?.adminNote?.includes(line)) return;
    const prefix = o?.adminNote ? `${o.adminNote}\n` : "";
    await (prisma as any).wbOrder.update({
      where: { id: orderId },
      data: { adminNote: `${prefix}${line}`.slice(0, 2000) },
    });
  } catch { /* best-effort: аудит не должен ронять выкуп */ }
}

/** Find a safe full-price pass owned by the same seller for this donor. */
async function findFullPriceReplacement(
  order: any,
  cookie: string,
  currentGpId: string,
  // У разбитого заказа замену ищем под номинал ЧАСТИ, а не всего заказа:
  // иначе на месте пасса за 1429 окажется пасс за 4286 и покупатель получит
  // втрое больше оплаченного.
  expectedAmount: number = order.amount,
): Promise<{ info: ResolvedGamepass; resolvedName: string } | null> {
  const nick = order.robloxUsername ?? order.probableNick;
  if (!nick) return null;
  const found = await searchForSalePassesByNick(nick).catch(() => null);
  if (!found || found.status !== "ok") return null;

  const expected = Math.ceil(expectedAmount / 0.7);
  const plausible = found.passes.filter((pass) =>
    String(pass.gamepassId) !== currentGpId && Math.abs(pass.price - expected) <= 2,
  );
  if (plausible.length === 0) return null;

  const [referenced, splitReferenced] = await Promise.all([
    (prisma as any).wbOrder.findMany({
      where: {
        id: { not: order.id },
        status: { in: ["AWAITING_PAYMENT", "PAYMENT_PENDING", "AWAITING_GAMEPASS", "PENDING", "IN_PROGRESS", "ERROR"] },
        gamepassUrl: { not: null },
      },
      select: { gamepassUrl: true },
    }),
    // Части разбитых заказов — включая ДРУГИЕ части этого же заказа. Повтор
    // пасса в разбиении admin ставит осознанно и разводит по донорам; замена
    // же выбирается автоматом, и совпади она с соседней частью — один донор
    // получил бы тот же пасс дважды и AlreadyOwned. Поэтому автозамена сюда
    // не смотрит.
    (prisma as any).wbOrderGamepass.findMany({
      where: {
        OR: [
          { orderId: order.id },
          { order: { status: { in: ["AWAITING_GAMEPASS", "PENDING", "IN_PROGRESS", "ERROR"] } } },
        ],
      },
      select: { gamepassId: true },
    }),
  ]);
  const usedIds = new Set<string>([
    ...referenced.map((row: any) => gpIdOf(row.gamepassUrl)).filter(Boolean),
    ...splitReferenced.map((row: any) => String(row.gamepassId)),
  ]);

  for (const pass of plausible) {
    const passId = String(pass.gamepassId);
    if (usedIds.has(passId)) continue;
    let info: ResolvedGamepass;
    try {
      info = await resolveGamepassForBuyer(passId, cookie);
    } catch {
      continue;
    }
    if (!info.isForSale || info.hasUnsafeBuyerPrice) continue;
    if (!checkGamepassPrice(order.amount, info.price, info.basePriceInRobux).ok) continue;
    if (!sellerMatchesOrder(found.resolvedName, info.sellerName)) continue;
    // null means the ownership check itself is unavailable: fail closed.
    if (await verifyGamepassOwnership(cookie, passId) !== false) continue;
    return { info, resolvedName: found.resolvedName };
  }
  return null;
}

// Серьёзность внутри «Требуют внимания»: ошибка → подвисший выкуп →
// прямой ждёт оплату → давно ждут ссылку. Внутри группы — старые сверху
// (сортировка стабильная, базовый порядок createdAt asc сохраняется).
function attentionRank(o: { status: string }): number {
  if (o.status === "ERROR") return 0;
  if (o.status === "PENDING" || o.status === "IN_PROGRESS") return 1;
  if (o.status === "AWAITING_PAYMENT" || o.status === "PAYMENT_PENDING") return 2;
  return 3;
}

export async function GET(req: NextRequest) {
  // A1/A4: единый гейт — принимает и Bearer-пропуск TWA, и веб-сессию админа.
  // Не вторая дверь: оба доказательства сходятся к одному правилу (`ADMIN_IDS`).
  if (!await requireAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const tab         = (searchParams.get("status") ?? "ALL") as FilterTab | OrderStatus;

  if (searchParams.get("export") === "gamepass-ids") {
    return NextResponse.json(await loadGamepassExport(isGamepassExportTab(tab) ? tab : "BUYOUT"));
  }

  const page        = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const limit       = Math.min(50, Math.max(5, parseInt(searchParams.get("limit") ?? "20", 10)));
  const skip        = (page - 1) * limit;
  const qRaw        = (searchParams.get("q") ?? "").trim();
  const q           = qRaw.length >= 2 ? qRaw : "";
  const skipCounts  = searchParams.get("skipCounts") === "1";
  const lite        = searchParams.get("lite") === "1";
  const sourceFilter = searchParams.get("source") as string | null;

  const isVirtualTab = ["WORK", "ALL", "BUYOUT", "DIRECT", "AVITO", "NEW", "ERROR", "AWAITING_LINK", "STALE_LINK", "DONE", "REJECTED", "FAVORITES", "ATTENTION", "HELD"].includes(tab);
  const tabWhere = isVirtualTab
    ? buildTabWhere(tab as FilterTab)
    : (VALID_STATUSES.includes(tab as any) ? { status: tab } : {});
  const orderBy = isVirtualTab ? orderByForTab(tab as FilterTab) : { createdAt: "desc" as const };

  let searchWhere: any = {};
  if (q) {
    const qClean = q.replace(/^@/, "");
    const qDigits = q.replace(/\D/g, "");
    const isNumericId = qDigits.length >= 4 && qDigits.length / q.length >= 0.8;
    const orClauses: any[] = [
      { gamepassUrl:    { contains: q,           mode: "insensitive" } },
      { robloxUsername: { contains: qClean,      mode: "insensitive" } },
      // adminNote держит «вероятные» ники ([НИК? дата] ник) — ищем и по ним.
      { adminNote:      { contains: qClean,      mode: "insensitive" } },
      { wbCode:         { contains: q.toUpperCase() } },
      { id:             { endsWith: q.toLowerCase() } },
      { user: { name:     { contains: q,         mode: "insensitive" } } },
      { user: { username: { contains: qClean,    mode: "insensitive" } } },
    ];
    if (isNumericId) {
      orClauses.push({ user: { tgId: { contains: qDigits } } });
      orClauses.push({ user: { vkId: { contains: qDigits } } });
      // U18: цифровой запрос — это ID геймпасса, ищем по индексу.
      orClauses.push({ gamepassId: qDigits });
    }
    searchWhere = { OR: orClauses };
  }

  const notTest = { isTest: false };
  const sourceWhere = sourceFilter && ["WB", "DIRECT", "AVITO", "MANUAL", "SITE"].includes(sourceFilter)
    ? { orderSource: sourceFilter }
    : {};
  // Сужение из шапки среза: тап по полосе источника, корзине возраста,
  // причине-препятствию или номиналу. Это фильтр поверх среза, а не другой
  // срез — границы вкладки (`tabWhere`) остаются в силе.
  const narrow = parseNarrow(searchParams);
  const narrowed = isNarrowed(narrow);
  const narrowWhere = narrowed && isVirtualTab ? buildNarrowWhere(tab as FilterTab, narrow) : {};
  const where = q
    ? { AND: [notTest, tabWhere, sourceWhere, narrowWhere, searchWhere] }
    : { AND: [notTest, tabWhere, sourceWhere, narrowWhere] };

  const take = skipCounts ? limit + 1 : limit;
  const userInclude = {
    user: { select: {
      tgId: true, vkId: true, name: true, username: true,
      balance: true, reviewBonusGrantedAt: true,
    } },
    paymentAttempts: {
      orderBy: { createdAt: "desc" as const }, take: 1,
      select: { status: true, amountKopecks: true, refundedAmountKopecks: true },
    },
    // Части разбитого выкупа: карточка обязана показывать, сколько уже куплено,
    // иначе «выкуплено 1 из 3» выглядит как незакрытый заказ без объяснения.
    splitGamepasses: {
      orderBy: { position: "asc" as const },
      select: { id: true, gamepassId: true, amount: true, position: true, chargedPrice: true, purchasedAt: true },
    },
  };

  let ordersPromise: Promise<any[]>;
  if (tab === "ATTENTION") {
    // Секция небольшая по природе — берём одним куском (без пагинации)
    // и ранжируем по серьёзности уже в памяти.
    ordersPromise = (prisma as any).wbOrder
      .findMany({ where, orderBy, take: ATTENTION_TAKE, include: userInclude })
      // Ручной приоритет выше серьёзности: его для того и ставят руками.
      .then((rows: any[]) => rows.sort((a, b) =>
        (a.priorityAt ? 0 : 1) - (b.priorityAt ? 0 : 1) || attentionRank(a) - attentionRank(b)));
  } else if (tab === "AWAITING_LINK" && !q) {
    ordersPromise = fetchAwaitingLinkHybrid(where, skip, take, userInclude);
  } else {
    ordersPromise = (prisma as any).wbOrder.findMany({ where, orderBy, skip, take, include: userInclude });
  }

  const emptyCounts = {
    total: 0,
    counts: null as Record<string, number> | null,
    sums: null as Record<string, number> | null,
    oldest: null as Record<string, string | null> | null,
    slices: null as OrderSlicesPayload | null,
  };
  const countsPromise = skipCounts
    ? Promise.resolve(emptyCounts)
    : (async () => {
        if (!q) {
          // Сужение режет ленту, но не чипы: счётчики срезов остаются полными
          // (иначе тап по полосе «DBS 4» обнулял бы число, по которому в неё
          // и зашли), а `total` обязан считать именно суженную выборку —
          // на нём стоит пагинация.
          const narrowTotal = narrowed
            ? await (prisma as any).wbOrder.count({ where })
            : null;
          if (cachedCounts && Date.now() - cachedCounts.ts < COUNT_CACHE_TTL) {
            return { total: narrowTotal ?? tabTotal(tab, cachedCounts.data), counts: cachedCounts.data, sums: cachedCounts.sums, oldest: cachedCounts.oldest, slices: cachedCounts.slices };
          }
          // Шапка среза идёт тем же кэшем, что и счётчики: оба читают ту же
          // таблицу тем же предикатом, и разъехавшийся TTL означал бы «14» в
          // чипе против «13 заказов» в шапке под ним.
          const slicesPromise = loadOrderSlices();
          // Заявки прямых заказов (DirectIntent, «ожидаем реквизиты») живут 24ч;
          // бейдж вкладки «Прямой» = заказы + заявки (клиент складывает сам).
          const intentsPromise: Promise<number> = (prisma as any).directIntent.count({
            where: { status: "PENDING", createdAt: { gt: new Date(Date.now() - 24 * 3600_000) } },
          }).catch(() => 0);
          const rows: any[] = await (prisma as any).$queryRawUnsafe(`
            SELECT
              COUNT(*) FILTER (WHERE "isFavorite" = false AND ${NOT_HELD_SQL} AND (
                status = 'ERROR'
                OR (status IN ('PENDING','IN_PROGRESS') AND ${PAID_BUYOUT_SQL} AND "orderSource" != 'AVITO')
                OR (status = 'AWAITING_GAMEPASS' AND "createdAt" <= NOW() - INTERVAL '${NEW_CUTOFF_HOURS} hours')
              ))::int AS "WORK",
              COUNT(*)::int AS "ALL",
              COUNT(*) FILTER (WHERE ${PAID_BUYOUT_SQL} AND ${NOT_HELD_SQL} AND "orderSource" != 'AVITO' AND "isFavorite" = false AND (status IN ('PENDING','IN_PROGRESS') OR (status = 'ERROR' AND "buyoutErrorCode" IN ('REGIONAL_PRICE','ROBLOX_PLUS_FLOW'))))::int AS "BUYOUT",
              COUNT(*) FILTER (WHERE "isDirectOrder" = true AND ${NOT_HELD_SQL} AND status IN ('PENDING','IN_PROGRESS','AWAITING_PAYMENT','PAYMENT_PENDING','ERROR') AND "isFavorite" = false)::int AS "DIRECT",
              COUNT(*) FILTER (WHERE "orderSource" = 'AVITO' AND ${NOT_HELD_SQL} AND status IN ('PENDING','IN_PROGRESS','AWAITING_GAMEPASS','ERROR') AND "isFavorite" = false)::int AS "AVITO",
              COUNT(*) FILTER (WHERE status = 'AWAITING_GAMEPASS' AND ${NOT_HELD_SQL} AND "createdAt" > NOW() - INTERVAL '${NEW_CUTOFF_HOURS} hours' AND "isFavorite" = false)::int AS "NEW",
              COUNT(*) FILTER (WHERE status = 'ERROR' AND ${NOT_HELD_SQL} AND "isFavorite" = false)::int AS "ERROR",
              COUNT(*) FILTER (WHERE status = 'AWAITING_GAMEPASS' AND ${NOT_HELD_SQL} AND "createdAt" <= NOW() - INTERVAL '${NEW_CUTOFF_HOURS} hours' AND "isFavorite" = false)::int AS "AWAITING_LINK",
              COUNT(*) FILTER (WHERE status = 'AWAITING_GAMEPASS' AND ${NOT_HELD_SQL} AND "createdAt" <= NOW() - INTERVAL '${STALE_LINK_DAYS} days' AND "isFavorite" = false)::int AS "STALE_LINK",
              COUNT(*) FILTER (WHERE status = 'COMPLETED')::int AS "DONE",
              COUNT(*) FILTER (WHERE status = 'REJECTED')::int AS "REJECTED",
              COUNT(*) FILTER (WHERE "isFavorite" = true)::int AS "FAVORITES",
              COUNT(*) FILTER (WHERE "isFavorite" = false AND ${NOT_HELD_SQL} AND (
                status = 'ERROR'
                OR (status IN ('PENDING','IN_PROGRESS') AND ${PAID_BUYOUT_SQL} AND "orderSource" != 'AVITO' AND "pendingAt" <= NOW() - INTERVAL '${ATTENTION_BUYOUT_HOURS} hours')
                OR ("isDirectOrder" = true AND status IN ('AWAITING_PAYMENT','PAYMENT_PENDING'))
                OR (status = 'AWAITING_GAMEPASS' AND "createdAt" <= NOW() - INTERVAL '${ATTENTION_LINK_DAYS} days')
              ))::int AS "ATTENTION",
              COUNT(*) FILTER (WHERE "heldAt" IS NOT NULL)::int AS "HELD",
              COALESCE(SUM(amount) FILTER (WHERE ${PAID_BUYOUT_SQL} AND "orderSource" != 'AVITO' AND "isFavorite" = false AND (status IN ('PENDING','IN_PROGRESS') OR (status = 'ERROR' AND "buyoutErrorCode" IN ('REGIONAL_PRICE','ROBLOX_PLUS_FLOW')))), 0)::int AS "SUM_BUYOUT",
              COALESCE(SUM(amount) FILTER (WHERE "isDirectOrder" = true AND status IN ('PENDING','IN_PROGRESS','AWAITING_PAYMENT','PAYMENT_PENDING','ERROR') AND "isFavorite" = false), 0)::int AS "SUM_DIRECT",
              COALESCE(SUM(amount) FILTER (WHERE "orderSource" = 'AVITO' AND status IN ('PENDING','IN_PROGRESS','AWAITING_GAMEPASS','ERROR') AND "isFavorite" = false), 0)::int AS "SUM_AVITO",
              COALESCE(SUM(amount) FILTER (WHERE status = 'AWAITING_GAMEPASS' AND "isFavorite" = false), 0)::int AS "SUM_AWAITING_LINK",
              COALESCE(SUM(amount) FILTER (WHERE status = 'AWAITING_GAMEPASS' AND ${NOT_HELD_SQL} AND "createdAt" <= NOW() - INTERVAL '${STALE_LINK_DAYS} days' AND "isFavorite" = false), 0)::int AS "SUM_STALE_LINK",
              COALESCE(SUM(amount) FILTER (WHERE status = 'AWAITING_GAMEPASS' AND "createdAt" > NOW() - INTERVAL '${NEW_CUTOFF_HOURS} hours' AND "isFavorite" = false), 0)::int AS "SUM_NEW",
              COALESCE(SUM(amount) FILTER (WHERE status = 'ERROR' AND ${NOT_HELD_SQL} AND "isFavorite" = false), 0)::int AS "SUM_ERROR",
              COALESCE(SUM(amount) FILTER (WHERE "heldAt" IS NOT NULL), 0)::int AS "SUM_HELD",
              MIN("pendingAt") FILTER (WHERE status IN ('PENDING','IN_PROGRESS') AND ${PAID_BUYOUT_SQL} AND "orderSource" != 'AVITO' AND "isFavorite" = false) AS "OLDEST_BUYOUT",
              MIN("createdAt") FILTER (WHERE status = 'AWAITING_GAMEPASS' AND "createdAt" <= NOW() - INTERVAL '${NEW_CUTOFF_HOURS} hours' AND "isFavorite" = false) AS "OLDEST_AWAITING_LINK",
              MIN("createdAt") FILTER (WHERE status = 'AWAITING_GAMEPASS' AND "createdAt" <= NOW() - INTERVAL '${STALE_LINK_DAYS} days' AND "isFavorite" = false) AS "OLDEST_STALE_LINK"
            FROM "WbOrder"
            WHERE "isTest" = false
          `);
          const r = rows[0] ?? {};
          const counts: Record<string, number> = {};
          const sums: Record<string, number> = {};
          for (const k of ["WORK", "ALL", "BUYOUT", "DIRECT", "AVITO", "NEW", "ERROR", "AWAITING_LINK", "STALE_LINK", "DONE", "REJECTED", "FAVORITES", "ATTENTION", "HELD"] as const)
            counts[k] = Number(r[k] ?? 0);
          counts["INTENTS"] = await intentsPromise;
          for (const k of ["BUYOUT", "DIRECT", "AVITO", "AWAITING_LINK", "STALE_LINK", "NEW", "ERROR", "HELD"] as const)
            sums[k] = Number(r[`SUM_${k}`] ?? 0);
          const oldest: Record<string, string | null> = {
            BUYOUT: r["OLDEST_BUYOUT"] ? new Date(r["OLDEST_BUYOUT"]).toISOString() : null,
            AWAITING_LINK: r["OLDEST_AWAITING_LINK"] ? new Date(r["OLDEST_AWAITING_LINK"]).toISOString() : null,
            STALE_LINK: r["OLDEST_STALE_LINK"] ? new Date(r["OLDEST_STALE_LINK"]).toISOString() : null,
          };
          const slices = await slicesPromise;
          cachedCounts = { data: counts, sums, oldest, slices, ts: Date.now() };
          return { total: narrowTotal ?? tabTotal(tab, counts), counts, sums, oldest, slices };
        }
        const cnt = await (prisma as any).wbOrder.count({ where });
        return { ...emptyCounts, total: cnt };
      })();

  const [rawOrders, { total, counts, sums, oldest, slices }] = await Promise.all([ordersPromise, countsPromise]);
  const hasMore = skipCounts && rawOrders.length > limit;
  const orders = hasMore ? rawOrders.slice(0, limit) : rawOrders;
  const finalTotal = skipCounts
    ? skip + orders.length + (hasMore ? limit : 0)
    : total;

  if (!lite) {
    const pageTgIds       = new Set<string>();
    const pageVkIds       = new Set<string>();
    const pageRobloxNicks = new Set<string>();
    for (const o of orders) {
      if (o.user?.tgId)       pageTgIds.add(String(o.user.tgId));
      if (o.user?.vkId)       pageVkIds.add(String(o.user.vkId));
      if (o.robloxUsername)   pageRobloxNicks.add(String(o.robloxUsername));
    }
    const clusterOrClauses: any[] = [];
    if (pageTgIds.size      > 0) clusterOrClauses.push({ user: { tgId: { in: [...pageTgIds] } } });
    if (pageVkIds.size      > 0) clusterOrClauses.push({ user: { vkId: { in: [...pageVkIds] } } });
    if (pageRobloxNicks.size > 0) clusterOrClauses.push({ robloxUsername: { in: [...pageRobloxNicks] } });

    const completedWbOrders = orders.filter((o: any) => o.status === "COMPLETED" && !o.isDirectOrder);
    const wbCodeValues     = completedWbOrders.map((o: any) => o.wbCode as string);
    const uniqueUserIds    = [...new Set<string>(completedWbOrders.map((o: any) => o.userId as string))];

    const [clusterOrders, codeRecords, firstOrderRows] = await Promise.all([
      clusterOrClauses.length > 0
        ? (prisma as any).wbOrder.findMany({
            where: { OR: clusterOrClauses },
            select: { createdAt: true, robloxUsername: true, user: { select: { tgId: true, vkId: true } } },
          })
        : [],
      completedWbOrders.length > 0
        ? (prisma as any).wbCode.findMany({
            where: { code: { in: wbCodeValues } },
            select: { code: true, reviewBonusClaimed: true },
          })
        : [],
      completedWbOrders.length > 0
        ? (prisma as any).wbOrder.groupBy({
            by: ["userId"],
            where: { userId: { in: uniqueUserIds }, status: "COMPLETED", isDirectOrder: false },
            _min: { createdAt: true },
          })
        : [],
    ]);

    for (const order of orders) {
      const myTg     = order.user?.tgId     ?? null;
      const myVk     = order.user?.vkId     ?? null;
      const myRoblox = order.robloxUsername ?? null;
      if (!myTg && !myVk && !myRoblox) {
        order.userOrderNumber = 1;
        order.userOrderTotal  = 1;
        continue;
      }
      const myCreated = new Date(order.createdAt).getTime();
      let cnt = 0, earlier = 0;
      for (const c of clusterOrders) {
        const match =
          (myTg     && c.user?.tgId === myTg) ||
          (myVk     && c.user?.vkId === myVk) ||
          (myRoblox && c.robloxUsername === myRoblox);
        if (!match) continue;
        cnt++;
        if (new Date(c.createdAt).getTime() < myCreated) earlier++;
      }
      order.userOrderNumber = earlier + 1;
      order.userOrderTotal  = cnt;
    }

    if (completedWbOrders.length > 0) {
      const reviewClaimedMap = new Map<string, boolean>(
        codeRecords.map((c: any) => [c.code as string, c.reviewBonusClaimed as boolean])
      );
      const firstCreatedByUser = new Map<string, number>(
        firstOrderRows
          .filter((r: any) => r._min?.createdAt)
          .map((r: any) => [r.userId as string, new Date(r._min.createdAt).getTime()])
      );
      for (const order of orders) {
        if (order.status === "COMPLETED" && !order.isDirectOrder) {
          const firstAt = firstCreatedByUser.get(order.userId);
          const isFirstOrder = firstAt !== undefined && new Date(order.createdAt).getTime() === firstAt;
          order.reviewStatus = isFirstOrder
            ? (reviewClaimedMap.get(order.wbCode) === true ? "SUBMITTED" : "PENDING")
            : null;
        } else {
          order.reviewStatus = null;
        }
      }
    }
  }

  const vkEnrichOrders = orders.filter((o: any) =>
    o.user?.vkId && (!o.user.name || o.user.name === "VK User" || !o.user.username)
  );
  if (vkEnrichOrders.length > 0 && process.env.VK_TOKEN) {
    void enrichVkUsers(vkEnrichOrders);
  }

  // ATTENTION отдаётся одним куском (до ATTENTION_TAKE) — пагинации нет.
  const pages = tab === "ATTENTION" ? 1 : Math.ceil(finalTotal / limit);
  const profitSummary = tab === "DONE" && !skipCounts
    ? await (prisma as any).wbOrder.aggregate({
        where,
        _sum: { profitKopecks: true },
        _count: { profitKopecks: true },
      })
    : null;
  return NextResponse.json({ orders, total: finalTotal, counts, sums, oldest, slices, profitSummary, page, pages });
}

function tabTotal(tab: string, counts: Record<string, number>): number {
  return counts[tab] ?? counts["ALL"] ?? 0;
}

// «Ждут ссылку»: голова = AWAITING_LINK_HEAD самых свежих (desc), хвост = все
// остальные от самых старых (asc). Собирается на сервере, чтобы порядок
// переживал пагинацию; окно страницы [skip, skip+take) режется по обеим частям.
async function fetchAwaitingLinkHybrid(where: any, skip: number, take: number, include: any): Promise<any[]> {
  // ⚡ Поднятые руками идут перед всем остальным. Эта вкладка собирается не
  // одним `orderBy`, а склейкой «свежие сверху + хвост от старых», поэтому
  // приоритет приходится вносить сюда явно — иначе он работал бы во всех
  // очередях, кроме этой, и правило «поднятый заказ первый» стало бы ложью.
  const pinned: any[] = await (prisma as any).wbOrder.findMany({
    where: { ...where, priorityAt: { not: null } },
    orderBy: { priorityAt: "desc" },
    take: AWAITING_LINK_HEAD,
    include,
  });
  const head: any[] = await (prisma as any).wbOrder.findMany({
    where: pinned.length > 0 ? { ...where, id: { notIn: pinned.map(p => p.id) } } : where,
    orderBy: { createdAt: "desc" },
    take: AWAITING_LINK_HEAD,
    include,
  });
  const prefix = [...pinned, ...head];
  const prefixSlice = prefix.slice(skip, skip + take);
  const tailTake = take - prefixSlice.length;
  if (tailTake <= 0) return prefixSlice;
  const tail: any[] = await (prisma as any).wbOrder.findMany({
    where: { ...where, id: { notIn: prefix.map(h => h.id) } },
    orderBy: { createdAt: "asc" },
    skip: Math.max(0, skip - prefix.length),
    take: tailTake,
    include,
  });
  return [...prefixSlice, ...tail];
}

async function enrichVkUsers(orders: any[]) {
  try {
    const vkIds = [...new Set<string>(orders.map((o: any) => String(o.user.vkId)))];
    const params = new URLSearchParams({
      user_ids:     vkIds.join(","),
      fields:       "first_name,last_name,screen_name",
      access_token: process.env.VK_TOKEN!,
      v:            "5.131",
    });
    const vkRes = await fetch("https://api.vk.com/method/users.get", {
      method:  "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body:    params.toString(),
    });
    const vkJson = (await vkRes.json()) as any;
    const map = new Map<string, { name: string; username?: string }>();
    for (const u of (vkJson?.response ?? [])) {
      if (!u?.id || !u?.first_name) continue;
      const fullName = [u.first_name, u.last_name].filter(Boolean).join(" ");
      const username = u.screen_name && u.screen_name !== `id${u.id}` ? String(u.screen_name) : undefined;
      map.set(String(u.id), { name: fullName, username });
    }
    const userIdsToPersist = new Set<string>();
    for (const o of orders) {
      const v = o.user?.vkId ? map.get(String(o.user.vkId)) : null;
      if (!v) continue;
      userIdsToPersist.add(o.userId);
    }
    await Promise.allSettled([...userIdsToPersist].map(async (uid: string) => {
      const order = orders.find((o: any) => o.userId === uid);
      if (!order?.user?.vkId) return;
      const v = map.get(String(order.user.vkId));
      if (!v) return;
      await (prisma as any).user.update({
        where: { id: uid },
        data: {
          name: v.name,
          ...(v.username ? { username: v.username } : {}),
        },
      });
    }));
  } catch { /* non-fatal */ }
}

export async function POST(req: NextRequest) {
  const actor = await requireAdmin(req);
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body?.action)
    return NextResponse.json({ error: "action required" }, { status: 400 });

  // Инвалидация выполняется после mutation-response: команда не ждёт purge,
  // но следующий dashboard/users read не остаётся на старом snapshot.
  after(() => {
    revalidateTag("admin-operational", "max");
    revalidateTag("admin-finance", "max");
    revalidateTag("admin-audience", "max");
  });

  const { action, orderId, reason } = body;

  if (action === "create-avito") {
    const { amount, gamepassUrl, robloxUsername, note } = body;
    const saleRubles = Number(body.saleRubles);
    if (!amount || typeof amount !== "number" || amount < 1)
      return NextResponse.json({ error: "amount обязателен (число > 0)" }, { status: 400 });
    if (!Number.isFinite(saleRubles) || saleRubles <= 0)
      return NextResponse.json({ error: "saleRubles обязателен для точной прибыли Авито" }, { status: 400 });

    // Дедуп: на этот геймпасс уже есть активный заказ → 409, пока менеджер
    // явно не подтвердит повтор (force: true). COMPLETED/REJECTED не блокируют.
    const gpMatch = String(gamepassUrl ?? "").match(/game-pass(?:es)?\/(\d+)/);
    if (gpMatch && body.force !== true) {
      const candidates = await (prisma as any).wbOrder.findMany({
        where: {
          isTest: false,
          status: { in: ["AWAITING_GAMEPASS", "PENDING", "IN_PROGRESS"] },
          // U18: точное сравнение по индексу вместо `contains` + постфильтра.
          gamepassId: gpMatch[1],
        },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { wbCode: true, status: true, orderSource: true, createdAt: true },
      });
      const existing = candidates[0];
      if (existing) {
        return NextResponse.json(
          {
            error: `На этот геймпасс уже есть активный заказ ${existing.wbCode}`,
            existing: { wbCode: existing.wbCode, status: existing.status, orderSource: existing.orderSource, createdAt: existing.createdAt },
          },
          { status: 409 },
        );
      }
    }

    const code = `AV-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

    const settings = await (prisma as any).globalSettings.findUnique({ where: { id: "global" } });

    const created = await (prisma as any).wbOrder.create({
      data: {
        amount,
        gamepassUrl: gamepassUrl || null,
        robloxUsername: robloxUsername || null,
        status: gamepassUrl ? "PENDING" : "AWAITING_GAMEPASS",
        platform: "TG",
        wbCode: code,
        isDirectOrder: false,
        orderSource: "AVITO",
        saleAmountKopecks: Math.round(saleRubles * 100),
        adminNote: note || null,
        pendingAt: gamepassUrl ? new Date() : null,
        purchaserUsername: settings?.robloxAccountName ?? null,
        user: {
          connectOrCreate: {
            where: { tgId: "admin" },
            create: { tgId: "admin", name: "Admin (Avito)" },
          },
        },
      },
    });
    cachedCounts = null;
    return NextResponse.json({ ok: true, order: created });
  }

  // П4 (PLAN «+7»): живая валидация полей модалки «➕ Создать заказ».
  // Ничего не создаёт; предупреждения (цена/продавец) НЕ блокируют создание.
  if (action === "manual-validate") {
    const out: any = {};

    /* Совпадение — это не ошибка, а развилка.
       Форма создания и форма правки — одни и те же поля с разными правами, и
       когда введённое уже принадлежит живому заказу, единственное разумное
       продолжение — открыть его. Раньше сервер сообщал о совпадении текстом
       («по коду уже есть заказ»), из которого нельзя было никуда пойти:
       закрывай форму, ищи заказ в списке, открывай правку. Отдаём сам заказ —
       ровно те поля, которые нужны шапке-цели, чтобы переключиться без второго
       запроса. Решение остаётся за человеком: сервер не выбирает за него. */
    const MATCH_SELECT = {
      id: true, wbCode: true, status: true, amount: true, robloxUsername: true,
      gamepassUrl: true, isDirectOrder: true, paidAt: true,
      heldAt: true, heldReason: true, createdAt: true, pendingAt: true,
      user: { select: { tgId: true, vkId: true, username: true, name: true } },
    } as const;

    const toMatch = (row: any) => row && ({
      orderId: row.id,
      wbCode: row.wbCode,
      status: row.status,
      amount: row.amount,
      robloxUsername: row.robloxUsername,
      gamepassUrl: row.gamepassUrl,
      isDirectOrder: row.isDirectOrder,
      // Неоплаченный прямой правится, но в очередь выкупа не идёт — форма
      // обязана сказать об этом до нажатия, а не после отказа сервера.
      unpaidDirect: isUnpaidDirect(row),
      heldAt: row.heldAt ? row.heldAt.toISOString() : null,
      heldReason: row.heldReason ?? null,
      // `edit-order` живёт только в этих статусах — не даём форме предложить
      // правку там, где сервер откажет.
      editable: ["PENDING", "AWAITING_GAMEPASS", "ERROR", "REJECTED"].includes(row.status),
      client: row.user?.username ? `@${row.user.username}`
        : row.user?.name ?? (row.user?.tgId ? `TG ${row.user.tgId}` : row.user?.vkId ? `VK ${row.user.vkId}` : null),
      createdAt: row.createdAt?.toISOString() ?? null,
      pendingAt: row.pendingAt?.toISOString() ?? null,
    });

    const rawCode = String(body.wbCode ?? "").trim().toUpperCase();
    if (rawCode) {
      if (!/^[A-Z0-9]{7}$/.test(rawCode)) {
        out.code = { ok: false, error: "Код — 7 символов A-Z/0-9" };
      } else {
        const codeRow = await (prisma as any).wbCode.findUnique({
          where: { code: rawCode },
          select: {
            denomination: true, isTest: true,
            user: { select: { id: true, tgId: true, vkId: true, name: true, username: true } },
          },
        });
        if (!codeRow) out.code = { ok: false, error: "Код не найден" };
        else if (codeRow.isTest) out.code = { ok: false, error: "Тестовый код" };
        else {
          const orderOnCode = await (prisma as any).wbOrder.findFirst({
            where: { wbCode: rawCode },
            select: MATCH_SELECT,
          });
          const holdOnCode = await (prisma as any).orderHold.findUnique({
            where: { wbCode: rawCode }, select: { reason: true, releasedAt: true },
          });
          if (orderOnCode) {
            out.code = {
              ok: false,
              error: `По коду уже есть заказ (${orderOnCode.status})`,
              existing: toMatch(orderOnCode),
            };
          } else if (holdOnCode && !holdOnCode.releasedAt) {
            // Заморозка на коде без заказа: сказать об этом надо до нажатия,
            // а не отказом сервера после.
            out.code = { ok: false, error: `❄️ Код заморожен: ${holdOnCode.reason}`, frozen: true };
          } else {
            out.code = { ok: true, denomination: codeRow.denomination, claimedBy: codeRow.user ?? null };
          }
        }
      }
    }

    const gpRaw = String(body.gamepassUrl ?? "").trim();
    const gpId = gpRaw.match(/game-pass(?:es)?\/(\d+)/)?.[1] ?? (/^\d{4,}$/.test(gpRaw) ? gpRaw : null);
    if (gpRaw && !gpId) out.gamepass = { error: "Нужна ссылка roblox.com/game-pass/<id> или ID" };
    else if (gpId) {
      const amount = Number(body.amount) || out.code?.denomination || 0;
      const expected = amount > 0 ? Math.ceil(amount / 0.7) : null;
      const info = await getGpInfoCached(gpId);
      const candidates = await (prisma as any).wbOrder.findMany({
        where: { isTest: false, status: { in: ["AWAITING_GAMEPASS", "PENDING", "IN_PROGRESS"] }, gamepassUrl: { contains: `/${gpId}` } },
        orderBy: { createdAt: "desc" }, take: 5,
        select: MATCH_SELECT,
      });
      const existing = candidates.find((o: any) => gpIdOf(o.gamepassUrl) === gpId);
      // Продавец vs ник: числится ли пасс среди for-sale пассов этого ника.
      let sellerMatch: boolean | null = null;
      const nick = String(body.robloxUsername ?? "").trim().replace(/^@/, "");
      if (nick) {
        const res = await searchForSalePassesByNick(nick).catch(() => null);
        sellerMatch = res?.status === "ok" ? res.passes.some((p) => String(p.gamepassId) === gpId) : null;
      }
      out.gamepass = {
        gamepassId: gpId,
        livePrice: info?.price ?? null,
        isForSale: info?.isForSale ?? null,
        expected,
        priceMismatch: expected != null && info?.price != null && Math.abs(info.price - expected) > 2,
        sellerMatch,
        existing: existing ? toMatch(existing) : null,
      };
    }

    /* Номер заказа WB — четвёртый вход в тот же заказ.
       Раньше вписать его было некуда, и ручной заказ не связывался с карточкой
       доставки: связь идёт через код гейта (`WbMarketplaceOrder.wbCode` →
       `WbOrder.wbCode`), а код надо было сначала где-то найти глазами. */
    const wbOrderIdRaw = String(body.wbOrderId ?? "").replace(/\D/g, "");
    if (wbOrderIdRaw.length >= 5) {
      const mp = await (prisma as any).wbMarketplaceOrder.findUnique({
        where: { wbOrderId: wbOrderIdRaw },
        select: {
          id: true, wbOrderId: true, buyerName: true, denominationSnapshot: true,
          finalPriceKopecks: true, priceKopecks: true, supplierStatus: true,
          gateState: true, cancelledAt: true,
          wbCode: { select: { code: true } },
        },
      });
      if (!mp) {
        out.wbOrder = { error: `Заказ WB #${wbOrderIdRaw} не найден` };
      } else {
        const gateCode = mp.wbCode?.code ?? null;
        const onCode = gateCode
          ? await (prisma as any).wbOrder.findUnique({ where: { wbCode: gateCode }, select: MATCH_SELECT })
          : null;
        out.wbOrder = {
          wbOrderId: mp.wbOrderId,
          buyerName: mp.buyerName,
          denomination: mp.denominationSnapshot,
          priceKopecks: mp.finalPriceKopecks ?? mp.priceKopecks,
          supplierStatus: mp.supplierStatus,
          gateCode,
          cancelled: Boolean(mp.cancelledAt),
          // Заказ на выкуп вешается на код гейта — без него вешать не на что.
          error: mp.cancelledAt ? "Заказ отменён на WB — выкуп по нему открывать нельзя"
            : !gateCode ? "Код гейта ещё не выпущен — сначала выдайте его покупателю"
              : !mp.denominationSnapshot ? "У товара нет номинала в каталоге — сумма заказа неизвестна"
                : undefined,
          existing: onCode ? toMatch(onCode) : null,
        };
      }
    }

    /* Ник — не ключ: у одного ника легко несколько заказов, и подставлять
       «тот самый» нельзя. Отдаём список, выбор делает человек. */
    const nickRaw = String(body.robloxUsername ?? "").trim().replace(/^@/, "");
    if (nickRaw.length >= 3) {
      const byNick = await (prisma as any).wbOrder.findMany({
        where: {
          isTest: false,
          robloxUsername: { equals: nickRaw, mode: "insensitive" },
          status: { in: ["AWAITING_GAMEPASS", "PENDING", "IN_PROGRESS", "ERROR", "AWAITING_PAYMENT", "PAYMENT_PENDING"] },
        },
        orderBy: { createdAt: "desc" }, take: 5,
        select: MATCH_SELECT,
      });
      if (byNick.length > 0) out.nick = { matches: byNick.map(toMatch) };
    }

    return NextResponse.json(out);
  }

  // П4 (PLAN «+7»): ручное создание заказа целиком из TWA (кейс 2ZELJMZ — код
  // CLAIMED, заказа нет, attach/rebind не помогают). Паритет с ботовским флоу:
  // ре-привязка кода к клиенту, PENDING при геймпассе, опциональный увед клиенту
  // «как будто сам активировал» (notifyRebind).
  if (action === "create-manual") {
    const isDirect = body.direct === true;
    const rawCode = String(body.wbCode ?? "").trim().toUpperCase() || null;
    const nick = String(body.robloxUsername ?? "").trim().replace(/^@/, "") || null;
    const noteText = String(body.note ?? "").trim() || null;
    const clientUserId = String(body.clientUserId ?? "").trim() || null;

    if (isDirect && rawCode)
      return NextResponse.json({ error: "Для прямого заказа WB-код не нужен" }, { status: 400 });
    if (isDirect && !clientUserId)
      return NextResponse.json({ error: "Выбери юзера, с которым общался" }, { status: 400 });
    if (isDirect && !nick)
      return NextResponse.json({ error: "Укажи ник Roblox и найди его геймпасс" }, { status: 400 });

    /* 0) Номер заказа WB (опционален) — четвёртый способ назвать тот же заказ.
       Связь коридора идёт через код гейта, поэтому номер просто разворачивается
       в него: дальше заказ создаётся ровно так же, как по коду с карты. Все
       предусловия — те же, что у создания из консоли доставки (`create_internal_order`):
       не отменён, гейт выпущен, номинал известен, заказа по коду ещё нет. */
    let marketplace: any = null;
    const wbOrderIdRaw = String(body.wbOrderId ?? "").replace(/\D/g, "");
    if (wbOrderIdRaw) {
      if (isDirect)
        return NextResponse.json({ error: "Прямой заказ не связан с заказом WB" }, { status: 400 });
      marketplace = await (prisma as any).wbMarketplaceOrder.findUnique({
        where: { wbOrderId: wbOrderIdRaw },
        select: {
          id: true, wbOrderId: true, denominationSnapshot: true, cancelledAt: true,
          finalPriceKopecks: true, priceKopecks: true, wbCodeId: true,
          wbCode: { select: { code: true } },
        },
      });
      if (!marketplace)
        return NextResponse.json({ error: `Заказ WB #${wbOrderIdRaw} не найден` }, { status: 400 });
      if (marketplace.cancelledAt)
        return NextResponse.json({ error: "Заказ отменён на WB — выкуп по нему открывать нельзя" }, { status: 409 });
      if (!marketplace.wbCode?.code)
        return NextResponse.json({ error: "Код гейта ещё не выпущен — заказ на выкуп привязывается к нему" }, { status: 409 });
      if (!marketplace.denominationSnapshot)
        return NextResponse.json({ error: "У товара нет номинала в каталоге — сумма заказа неизвестна" }, { status: 409 });
      if (rawCode && rawCode !== marketplace.wbCode.code)
        return NextResponse.json({ error: `Заказ WB #${wbOrderIdRaw} выдан по коду ${marketplace.wbCode.code}, а в поле кода другой` }, { status: 400 });
    }

    // 1) Код ВБ (опционален): существует, не тест, заказа по нему нет.
    let codeRow: any = null;
    if (rawCode || marketplace) {
      const codeToUse = rawCode ?? marketplace.wbCode.code;
      if (!/^[A-Z0-9]{7}$/.test(codeToUse))
        return NextResponse.json({ error: "Код — 7 символов A-Z/0-9" }, { status: 400 });
      codeRow = await (prisma as any).wbCode.findUnique({
        where: { code: codeToUse },
        select: { id: true, denomination: true, isTest: true, usedAt: true },
      });
      if (!codeRow) return NextResponse.json({ error: `Код ${codeToUse} не найден` }, { status: 400 });
      if (codeRow.isTest) return NextResponse.json({ error: `Код ${codeToUse} — тестовый` }, { status: 400 });
      const orderOnCode = await (prisma as any).wbOrder.findFirst({
        where: { wbCode: codeToUse }, select: { status: true },
      });
      if (orderOnCode)
        return NextResponse.json({ error: `По коду ${codeToUse} уже есть заказ (${orderOnCode.status})` }, { status: 409 });
      /* ❄️ Заморозка ставится НА КОД и живёт до создания заказа — ровно ради
         случая 84CR7UZ: код у покупателя на руках, заказа ещё нет, выкупать
         нельзя. Крон-свип пометил бы созданный заказ через минуту, но создать
         его молча и увидеть заморозку постфактум — не то же самое, что не
         создать. Отказываем сразу. */
      const holdOnCode = await (prisma as any).orderHold.findUnique({
        where: { wbCode: codeToUse },
        select: { reason: true, releasedAt: true },
      });
      if (holdOnCode && !holdOnCode.releasedAt)
        return NextResponse.json({ error: heldRefusal(holdOnCode.reason) }, { status: 409 });
      codeRow.code = codeToUse;
    }

    // 2) Номинал: из карточки доставки (DBS), из кода или руками.
    let amount = marketplace?.denominationSnapshot ?? codeRow?.denomination ?? Number(body.amount);
    if (!isDirect && (!amount || !Number.isFinite(amount) || amount < 1))
      return NextResponse.json({ error: "Укажи код ВБ или номинал в R$" }, { status: 400 });

    // 3) Клиент (опционален): без клиента — служебный юзер (как в Авито).
    let client: any = null;
    if (clientUserId) {
      client = await (prisma as any).user.findUnique({
        where: { id: clientUserId },
        select: { id: true, tgId: true, vkId: true, name: true, username: true },
      });
      if (!client) return NextResponse.json({ error: "Клиент не найден" }, { status: 400 });
    }

    // 4) Геймпасс (опционален): дедуп как в create-avito (force обходит).
    const gpRaw = String(body.gamepassUrl ?? "").trim();
    const gpId = gpRaw.match(/game-pass(?:es)?\/(\d+)/)?.[1] ?? (/^\d{4,}$/.test(gpRaw) ? gpRaw : null);
    if (gpRaw && !gpId)
      return NextResponse.json({ error: "Геймпасс: нужна ссылка roblox.com/game-pass/<id> или ID" }, { status: 400 });

    if (isDirect) {
      if (!gpId) return NextResponse.json({ error: "Выбери геймпасс из результатов поиска" }, { status: 400 });
      const info = await getGpInfoCached(gpId);
      if (!info?.price || info.isForSale === false)
        return NextResponse.json({ error: "Не удалось подтвердить цену геймпасса или он снят с продажи" }, { status: 400 });
      // Для ручного DIRECT сумма клиенту = цена геймпасса × 70%.
      // Так order.amount совпадает с обычным DIR-прайс-гардом ceil(amount / 0.7).
      amount = Math.floor(info.price * 0.7);
      if (amount < 1) return NextResponse.json({ error: "Цена геймпасса слишком мала" }, { status: 400 });
    }
    if (!amount || !Number.isFinite(amount) || amount < 1)
      return NextResponse.json({ error: "Не удалось определить сумму заказа" }, { status: 400 });
    if (gpId && body.force !== true) {
      const candidates = await (prisma as any).wbOrder.findMany({
        where: { isTest: false, status: { in: ["AWAITING_GAMEPASS", "PENDING", "IN_PROGRESS"] }, gamepassUrl: { contains: `/${gpId}` } },
        orderBy: { createdAt: "desc" }, take: 5,
        select: { wbCode: true, status: true, orderSource: true, createdAt: true, gamepassUrl: true },
      });
      const existing = candidates.find((o: any) => gpIdOf(o.gamepassUrl) === gpId);
      if (existing)
        return NextResponse.json({
          error: `На этот геймпасс уже есть активный заказ ${existing.wbCode}`,
          existing: { wbCode: existing.wbCode, status: existing.status, orderSource: existing.orderSource, createdAt: existing.createdAt },
        }, { status: 409 });
    }

    const gamepassUrl = gpId ? `https://www.roblox.com/game-pass/${gpId}` : null;
    const code = isDirect
      ? generateDirectCode()
      : codeRow?.code ?? rawCode ?? `MN-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const stamp = new Date().toISOString().slice(0, 10);
    const manualMark = `[MANUAL${isDirect ? " DIRECT" : ""} ${stamp} от ${actor.displayName}]`;
    const platform = client?.vkId && !client?.tgId ? "VK" : "TG";

    const created = await (prisma as any).$transaction(async (tx: any) => {
      const order = await tx.wbOrder.create({
        data: {
          amount,
          gamepassUrl,
          robloxUsername: nick,
          status: gamepassUrl ? "PENDING" : "AWAITING_GAMEPASS",
          platform,
          wbCode: code,
          isDirectOrder: isDirect,
          // Источник — не хардкод. Код гейта DBS выглядит как обычный WB-код, и
          // заказ, созданный по нему руками, раньше уезжал как `MANUAL`: та же
          // ошибка, что 17.08 записала DBS-заказ как `WB`. `resolveWbOrderSource`
          // смотрит, есть ли за кодом заказ маркетплейса, и никогда не бросает.
          orderSource: isDirect ? "DIRECT" : await resolveWbOrderSource(tx, code),
          adminNote: noteText ? `${manualMark} ${noteText}` : manualMark,
          pendingAt: gamepassUrl ? new Date() : null,
          // Сколько покупатель реально заплатил на WB — иначе прибыль по
          // такому заказу не посчитать, а он ничем не отличается от обычного.
          ...(marketplace ? { saleAmountKopecks: marketplace.finalPriceKopecks ?? marketplace.priceKopecks ?? undefined } : {}),
          ...(isDirect ? {
            // Админский ручной direct считается подтверждённым: он сразу
            // проходит DIR-гейт и попадает в рабочую очередь выкупа.
            paidAt: new Date(),
            paymentDetails: "Ручной прямой заказ: подтверждён менеджером",
            saleAmountKopecks: directPrice(amount) * 100,
          } : {}),
          user: client
            ? { connect: { id: client.id } }
            : { connectOrCreate: { where: { tgId: "admin" }, create: { tgId: "admin", name: "Admin (Manual)" } } },
        },
      });
      // Ре-привязка кода (паритет с ботовской активацией): код закрывается для
      // повторного использования и вешается на выбранного клиента.
      if (codeRow) {
        await tx.wbCode.update({
          where: { id: codeRow.id },
          data: {
            isUsed: true,
            status: "CLAIMED",
            usedAt: codeRow.usedAt ?? new Date(),
            ...(client ? { userId: client.id } : {}),
            ...(nick ? { robloxNick: nick } : {}),
          },
        });
      }
      // След в таймлайне карточки доставки: с точки зрения DBS это то же
      // событие, что и «создать заказ на выкуп» из консоли, и оператор должен
      // видеть его там, независимо от того, из какой формы заказ завели.
      if (marketplace) {
        await tx.wbMarketplaceEvent.create({
          data: {
            marketplaceOrderId: marketplace.id,
            type: "INTERNAL_ORDER_CREATED",
            idempotencyKey: `internal-order:${marketplace.id}:${order.id}`,
            actor: actor.displayName,
            payload: { activationCode: code, gamepassId: gpId, robloxUsername: nick, denomination: amount, via: "order-sheet" },
          },
        }).catch(() => { /* след не должен отменять созданный заказ */ });
      }
      return order;
    });

    // 5) Увед клиенту (checkbox в модалке; только при выбранном клиенте).
    let notified: "tg" | "vk" | null = null;
    if (body.notify === true && client) {
      notified = await notifyRebind(client, amount, code, !!gamepassUrl).catch(() => null);
    }

    cachedCounts = null;
    return NextResponse.json({ ok: true, order: created, notified });
  }

  /* Завести клиента руками.
     До 31.08.2026 поле «Клиент» умело только искать по базе. Человек написал в
     чат WB или пришёл из другого канала, в нашей базе его нет — и заказ было
     не к кому привязать: он вешался на служебного `tgId: "admin"`, то есть
     уведомления ему уже не уйдут никогда. Идемпотентно: если такой tgId/vkId
     уже есть, возвращаем существующего, а не плодим второго. */
  if (action === "create-client") {
    const tgId = String(body.tgId ?? "").replace(/\D/g, "") || null;
    const vkId = String(body.vkId ?? "").replace(/\D/g, "") || null;
    const username = String(body.username ?? "").trim().replace(/^@/, "") || null;
    const name = String(body.name ?? "").trim() || null;

    if (!tgId && !vkId)
      return NextResponse.json({ error: "Нужен Telegram ID или VK ID — по нику клиента не создать" }, { status: 400 });
    if (tgId && tgId.length < 5)
      return NextResponse.json({ error: "Telegram ID — минимум 5 цифр" }, { status: 400 });
    if (vkId && vkId.length < 3)
      return NextResponse.json({ error: "VK ID — минимум 3 цифры" }, { status: 400 });

    const found = await (prisma as any).user.findFirst({
      where: { OR: [...(tgId ? [{ tgId }] : []), ...(vkId ? [{ vkId }] : [])] },
      select: { id: true, tgId: true, vkId: true, name: true, username: true, robloxUsername: true },
    });
    if (found) return NextResponse.json({ ok: true, user: found, existed: true });

    const created = await (prisma as any).user.create({
      data: {
        tgId, vkId, username,
        name: name ?? `Клиент ${tgId ?? vkId}`,
      },
      select: { id: true, tgId: true, vkId: true, name: true, username: true, robloxUsername: true },
    });
    return NextResponse.json({ ok: true, user: created, existed: false });
  }

  // Не требует orderId — клиент шлёт только { action, query }.
  if (action === "search-users") {
    const q = String(body.query ?? "").trim();
    if (q.length < 2) return NextResponse.json({ error: "Минимум 2 символа" }, { status: 400 });

    const clean = q.replace(/^@/, "");
    const idDigits = clean.replace(/^id/i, "");
    const isNumeric = /^\d+$/.test(idDigits) && idDigits.length >= 4;

    const orClauses: any[] = [
      { username: { contains: clean, mode: "insensitive" } },
      { name: { contains: clean, mode: "insensitive" } },
      { robloxUsername: { contains: clean, mode: "insensitive" } },
    ];
    if (isNumeric) {
      orClauses.push({ tgId: idDigits });
      orClauses.push({ vkId: idDigits });
    }

    const users = await (prisma as any).user.findMany({
      where: { OR: orClauses },
      select: { id: true, tgId: true, vkId: true, username: true, name: true, robloxUsername: true },
      take: 10,
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ users });
  }

  // Не требует orderId — список заказов, к которым можно привязать геймпасс
  // из «Поиск и выкуп» (бот проспал ссылку / заказ отклонён / ошибка).
  if (action === "attachable-orders") {
    const q = String(body.query ?? "").trim();
    const qClean = q.replace(/^@/, "");
    const searchWhere = q.length >= 2
      ? {
          OR: [
            { wbCode:         { contains: q.toUpperCase() } },
            { robloxUsername: { contains: qClean, mode: "insensitive" } },
            // adminNote держит «вероятные» ники ([НИК? дата] ник) — ищем и по ним.
            { adminNote:      { contains: qClean, mode: "insensitive" } },
            { user: { username: { contains: qClean, mode: "insensitive" } } },
            { user: { name:     { contains: q,      mode: "insensitive" } } },
          ],
        }
      : {};

    const orders = await (prisma as any).wbOrder.findMany({
      where: {
        isTest: false,
        status: { in: ["AWAITING_GAMEPASS", "REJECTED", "ERROR"] },
        ...searchWhere,
      },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true, wbCode: true, amount: true, status: true, platform: true,
        robloxUsername: true, gamepassUrl: true, createdAt: true,
        user: { select: { tgId: true, vkId: true, name: true, username: true } },
      },
    });
    return NextResponse.json({ orders });
  }

  // Не требует orderId — обогащение карточек очереди выкупа: живая цена ГП
  // (⚠️ при расхождении с расчётной) и «этот геймпасс уже выкупался в <код>»
  // (сигнал, что донор может уже владеть пассом — Roblox не продаст вторую
  // копию тому же аккаунту). П5 (PLAN «+7»): карточка выкупа честнее.
  if (action === "gp-live-check") {
    const ids: string[] = Array.isArray(body.orderIds) ? body.orderIds.slice(0, 30).map(String) : [];
    if (ids.length === 0) return NextResponse.json({ results: {} });

    const checkOrders: any[] = await (prisma as any).wbOrder.findMany({
      where: { id: { in: ids } },
      select: {
        id: true, amount: true, gamepassUrl: true, wbCode: true,
        // У разбитого заказа сверять текущий пасс с номиналом ВСЕГО заказа
        // нельзя: пасс за 1429 R$ в заказе на 3000 — это норма, а бейдж
        // «цена ≠ номиналу» на каждой такой карточке был бы ложной тревогой.
        splitGamepasses: { orderBy: { position: "asc" }, select: { gamepassId: true, amount: true, purchasedAt: true } },
      },
    });

    const gpIds = [...new Set(checkOrders.map((o) => gpIdOf(o.gamepassUrl)).filter(Boolean))] as string[];
    const completed: any[] = gpIds.length > 0
      ? await (prisma as any).wbOrder.findMany({
          where: {
            isTest: false,
            status: "COMPLETED",
            gamepassId: { in: gpIds },
          },
          orderBy: { updatedAt: "desc" },
          select: { wbCode: true, gamepassId: true },
        })
      : [];
    const reusedBy = new Map<string, string>();
    for (const c of completed) {
      const id = c.gamepassId as string | null;
      if (id && !reusedBy.has(id)) reusedBy.set(id, c.wbCode);
    }

    const results: Record<string, any> = {};
    // Live-check uses public product-info only — browser service is reserved
    // for the actual purchase flow. Previous version held the SG single-flight
    // lock for every order here, blocking concurrent purchase requests.
    for (const o of checkOrders) {
      // Проверяем ту часть, которая покупается сейчас, и сверяем её с ЕЁ
      // номиналом. Сумма частей уже сходится с заказом — это отдельный
      // инвариант, и его нарушение показывает блок разбиения, а не этот бейдж.
      const parts: { gamepassId: string; amount: number; purchasedAt: Date | null }[] = o.splitGamepasses ?? [];
      const activePart = parts.find((p) => !p.purchasedAt) ?? null;
      const gpId = activePart ? activePart.gamepassId : gpIdOf(o.gamepassUrl);
      if (!gpId) continue;
      const expected = Math.ceil((activePart ? activePart.amount : o.amount) / 0.7);
      const publicInfo = await getGpInfoCached(gpId);
      const reusedCode = reusedBy.get(gpId);
      const basePrice = publicInfo?.price ?? null;
      results[o.id] = {
        expected,
        livePrice: basePrice,
        basePrice,
        isForSale: publicInfo?.isForSale ?? null,
        priceMismatch: basePrice != null && Math.abs(basePrice - expected) > 2,
        robloxPlusDiscountPercent: null,
        hasUnsafeBuyerPrice: false,
        reusedIn: reusedCode && reusedCode !== o.wbCode ? reusedCode : null,
      };
    }
    return NextResponse.json({ results });
  }

  /* ── ❄️ Заморозка ────────────────────────────────────────────────────────
     Стоит ДО проверки `orderId`, потому что ключ заморозки — код, а не заказ:
     код выдаётся покупателю раньше, чем бот создаёт заказ (случай 84CR7UZ —
     код на руках, заказа ещё нет, а выкупать его уже нельзя). Карточка шлёт
     `orderId`, поиск по коду — `wbCode`; резолвим то, что пришло.
     ──────────────────────────────────────────────────────────────────────── */
  if (action === "hold" || action === "unhold") {
    let wbCode = normalizeHoldCode(body.wbCode);
    if (!wbCode && orderId) {
      const target = await (prisma as any).wbOrder.findUnique({
        where: { id: orderId }, select: { wbCode: true },
      });
      if (!target) return NextResponse.json({ error: "Order not found" }, { status: 404 });
      wbCode = target.wbCode;
    }
    if (!wbCode) return NextResponse.json({ error: "Нужен код заказа" }, { status: 400 });

    const result = action === "hold"
      ? await holdByCode(prisma, { wbCode, reason: String(body.reason ?? ""), actor: actor.displayName })
      : await releaseByCode(prisma, { wbCode, actor: actor.displayName });

    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    cachedCounts = null;
    return NextResponse.json({ ok: true, wbCode, awaitingOrder: result.awaitingOrder ?? false });
  }

  /** Состояние заморозки по коду — для поиска по коду, у которого нет заказа. */
  if (action === "hold-status") {
    const wbCode = normalizeHoldCode(body.wbCode);
    if (!wbCode) return NextResponse.json({ error: "Нужен код" }, { status: 400 });
    const [hold, existing, code] = await Promise.all([
      (prisma as any).orderHold.findUnique({ where: { wbCode } }),
      (prisma as any).wbOrder.findUnique({ where: { wbCode }, select: { id: true } }),
      (prisma as any).wbCode.findUnique({ where: { code: wbCode }, select: { denomination: true, status: true } }),
    ]);
    return NextResponse.json({
      wbCode,
      hasOrder: !!existing,
      denomination: code?.denomination ?? null,
      codeStatus: code?.status ?? null,
      hold: hold && !hold.releasedAt
        ? { reason: hold.reason, createdBy: hold.createdBy, createdAt: hold.createdAt }
        : null,
    });
  }

  if (!orderId)
    return NextResponse.json({ error: "orderId required" }, { status: 400 });

  const order = await (prisma as any).wbOrder.findUnique({
    where: { id: orderId },
    include: {
      user: { select: { id: true, tgId: true, vkId: true, username: true } },
      // Части разбитого выкупа. Пусто у обычного заказа — тогда всё работает
      // по единственному `gamepassId`, как и раньше.
      splitGamepasses: { orderBy: { position: "asc" } },
    },
  });
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  const splitParts: StoredPart[] = order.splitGamepasses ?? [];

  // П5 (PLAN «+7»): неоплаченный прямой заказ не должен доходить до выкупа
  // ни одним путём — робуксы донора тратятся только после подтверждения оплаты.
  const unpaidDirect = order.isDirectOrder && !order.paidAt;
  const UNPAID_DIR_ERROR = `💳 Прямой заказ ${order.wbCode} не оплачен — сначала подтверди оплату (pay_ok в TG-карточке)`;

  if (action === "set-note") {
    const note = typeof body.note === "string" ? body.note.trim().slice(0, 2000) : "";

    /* `keepTags` — правка ТОЛЬКО человеческой части заметки.
       Заметка заказа — это две разные вещи в одном поле: машинный аудит
       (`[РАЗБИВКА …]`, `[ЦЕНА-СТОП …]`, `[НИК? …]`) и текст, который админ
       пишет себе. Полный редактор в досье правит всё сразу и знает, что делает;
       узкое поле на дашборде — нет, и без этого флага одна строка «доплата»
       стёрла бы всю историю выкупа. Машинные строки узнаются по `[МЕТКА]` в
       начале — тот же признак, по которому их разбирает `parseAdminNote`. */
    if (body.keepTags === true) {
      const tagged = (order.adminNote ?? "")
        .split("\n")
        .map((line: string) => line.trim())
        .filter((line: string) => line.startsWith("["));
      const merged = [...tagged, ...(note ? [note] : [])].join("\n").slice(0, 2000);
      await (prisma as any).wbOrder.update({
        where: { id: orderId },
        data:  { adminNote: merged || null },
      });
      return NextResponse.json({ ok: true, note: merged || null });
    }

    await (prisma as any).wbOrder.update({
      where: { id: orderId },
      data:  { adminNote: note || null },
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "toggle-favorite") {
    await (prisma as any).wbOrder.update({
      where: { id: orderId },
      data:  { isFavorite: !order.isFavorite },
    });
    cachedCounts = null;
    return NextResponse.json({ ok: true, isFavorite: !order.isFavorite });
  }

  /* ── «⚡ Вперёд очереди»: ручной приоритет ────────────────────────────────
     Очередь выкупа стоит по возрасту, и это правильный порядок по умолчанию.
     Исключение — заказ, который надо закрыть вне очереди (доплата, спор на WB,
     обещанный срок): до сих пор он жил в голове владельца и искался по коду.

     Признак поверх статуса, как заморозка: заказ никуда не переезжает, меняется
     только его место в сортировке (`orderByForTab`, голова обзора, выгрузка ID
     закупщику, автовыкуп бота — все читают `priorityAt`). Хранится момент
     нажатия, поэтому среди нескольких поднятых первым идёт поднятый последним.
     ──────────────────────────────────────────────────────────────────────── */
  if (action === "set-priority") {
    // ❄️ Замороженный заказ выключен из очередей целиком — поднимать в них
    // нечего, и «подняли, но он всё равно не выкупается» было бы враньём.
    if (order.heldAt) return NextResponse.json({ error: heldRefusal(order.heldReason) }, { status: 409 });
    // В «Готово» и «Отменено» порядок ничего не значит: там смотрят историю.
    const QUEUEABLE = ["PENDING", "IN_PROGRESS", "ERROR", "AWAITING_GAMEPASS", "AWAITING_PAYMENT", "PAYMENT_PENDING"];
    if (!QUEUEABLE.includes(order.status))
      return NextResponse.json({ error: `Заказ в статусе ${order.status} не стоит в очереди — поднимать нечего` }, { status: 400 });

    const on = body.priority !== false;
    await (prisma as any).wbOrder.update({
      where: { id: orderId },
      data: on
        ? { priorityAt: new Date(), priorityBy: actor.displayName }
        : { priorityAt: null, priorityBy: null },
    });
    cachedCounts = null;
    return NextResponse.json({ ok: true, priority: on, wbCode: order.wbCode });
  }

  if (action === "set-error") {
    if (!["PENDING", "IN_PROGRESS", "ERROR"].includes(order.status))
      return NextResponse.json({ error: "Cannot set error on this order" }, { status: 400 });
    await (prisma as any).wbOrder.update({
      where: { id: orderId },
      data:  { status: "ERROR" },
    });
    await recordOrderStatusChange({
      orderId, from: order.status, to: "ERROR", actor: `admin:${actor.displayName}`,
      extra: { wbCode: order.wbCode },
    });
    cachedCounts = null;
    return NextResponse.json({ ok: true });
  }

  if (action === "restore-to-buyout") {
    // ❄️ Ровно та ловушка, ради которой заморозка и заводилась: раньше одно
    // нажатие «Вернуть к выкупу» отправляло заказ обратно в PENDING.
    if (order.heldAt)
      return NextResponse.json({ error: heldRefusal(order.heldReason) }, { status: 409 });
    const recovery = buildRestoreToBuyoutData(order, actor.displayName);
    if (!recovery.ok) {
      return NextResponse.json({ error: recovery.error }, { status: recovery.status });
    }
    const restored = await (prisma as any).wbOrder.updateMany({
      where: { id: orderId, status: "ERROR" },
      data: recovery.data,
    });
    if (restored.count !== 1) {
      return NextResponse.json({ error: "Заказ уже перемещён другим администратором" }, { status: 409 });
    }
    await recordOrderStatusChange({
      orderId, from: order.status, to: "PENDING", actor: `admin:${actor.displayName}`,
      extra: { wbCode: order.wbCode, why: "restore-to-buyout" },
    });
    cachedCounts = null;
    return NextResponse.json({ ok: true, status: "PENDING" });
  }

  if (action === "move-to") {
    const target = body.target as string;
    const note = typeof body.note === "string" ? body.note.trim() : "";
    if (!note) return NextResponse.json({ error: "Заметка обязательна при переводе" }, { status: 400 });

    // ❄️ Перенос в «К выкупу» / «Готово» — такой же путь в очередь, как
    // «Вернуть к выкупу». Разморозка должна быть осознанным отдельным шагом.
    if (order.heldAt && target !== "FAVORITES")
      return NextResponse.json({ error: heldRefusal(order.heldReason) }, { status: 409 });

    // «Избранное» — не статус, а флаг: заказ остаётся в своём статусе.
    if (target === "FAVORITES") {
      const stamp = new Date().toISOString().slice(0, 10);
      await (prisma as any).wbOrder.update({
        where: { id: orderId },
        data:  {
          isFavorite: true,
          adminNote: appendOrderAudit(
            order.adminNote,
            `[ПЕРЕНОС ${stamp} от ${actor.displayName}] → Избранное: ${note}`,
          ),
        },
      });
      cachedCounts = null;
      return NextResponse.json({ ok: true });
    }

    const statusMap: Record<string, string> = {
      BUYOUT: "PENDING",
      DIRECT: "PENDING",
      AVITO: "PENDING",
      NEW: "AWAITING_GAMEPASS",
      ERROR: "ERROR",
      AWAITING_LINK: "AWAITING_GAMEPASS",
      DONE: "COMPLETED",
      REJECTED: "REJECTED",
    };
    const newStatus = statusMap[target];
    if (!newStatus) return NextResponse.json({ error: "Invalid target" }, { status: 400 });

    // Неоплаченный DIR нельзя руками перевести в очередь выкупа или «Готово» —
    // это открыло бы автовыкупу/менеджеру путь потратить робуксы без оплаты.
    if (unpaidDirect && (newStatus === "PENDING" || newStatus === "COMPLETED"))
      return NextResponse.json({ error: UNPAID_DIR_ERROR }, { status: 409 });

    const stamp = new Date().toISOString().slice(0, 10);
    const data: any = {
      status: newStatus,
      adminNote: appendOrderAudit(
        order.adminNote,
        `[ПЕРЕНОС ${stamp} от ${actor.displayName}] ${order.status}→${newStatus} (${target}): ${note}`,
      ),
      isFavorite: false,
    };
    if (target === "DIRECT") { data.isDirectOrder = true; data.orderSource = "DIRECT"; }
    // Оплаченный прямой заказ и так лежит в общей очереди «К выкупу» — перенос не должен
    // стирать его природу, иначе клиент получит WB-сценарий уведомлений вместо прямого.
    if (target === "BUYOUT" && !(order.isDirectOrder && order.paidAt)) {
      data.isDirectOrder = false;
      data.orderSource = order.orderSource === "AVITO" ? "MANUAL" : order.orderSource;
    }
    // Вкладка «Авито» фильтрует по orderSource — одного статуса мало.
    if (target === "AVITO")  { data.isDirectOrder = false; data.orderSource = "AVITO"; }
    // Перенос в «Готово» — тихая переклассификация (без уведомления клиенту,
    // в отличие от кнопки «Выкуплено»); курс фиксируем как при обычном выкупе.
    if (target === "DONE") {
      const settings = await (prisma as any).globalSettings.findUnique({ where: { id: "global" } });
      data.purchaseRate = settings?.purchaseRate ?? null;
      data.completedAt = new Date(); // Ф6.3: базис таймера разблокировки робуксов
      Object.assign(data, buildOrderProfitSnapshot(order, settings ?? {}, Math.ceil(order.amount / 0.7)) ?? {});
    }
    if (target === "REJECTED") data.rejectionReason = note;
    if (target !== "ERROR") data.buyoutErrorCode = null;
    if (target === "AWAITING_LINK" || target === "NEW") data.pendingAt = null;
    if ((target === "BUYOUT" || target === "DIRECT" || target === "AVITO")
        && (order.status !== "PENDING" && order.status !== "IN_PROGRESS")) {
      data.pendingAt = new Date();
    }

    await (prisma as any).wbOrder.update({ where: { id: orderId }, data });
    cachedCounts = null;
    return NextResponse.json({ ok: true });
  }

  if (action === "complete") {
    if (unpaidDirect) return NextResponse.json({ error: UNPAID_DIR_ERROR }, { status: 409 });
    if (!["PENDING", "IN_PROGRESS", "ERROR"].includes(order.status))
      return NextResponse.json({ error: "Order must be PENDING, IN_PROGRESS or ERROR" }, { status: 400 });
    const settings = await (prisma as any).globalSettings.findUnique({ where: { id: "global" } });
    const currentRate = settings?.purchaseRate ?? null;
    // У разбитого заказа себестоимость — сумма списаний по частям. Считать её
    // от номинала заказа значило бы записать в прибыль выдуманное число: три
    // пасса по 1429 стоят 4287, а ceil(3000/0.7) = 4286.
    const purchaseRobux = splitParts.length > 0
      ? splitParts.reduce((sum, p) => sum + (Number(p.chargedPrice) || Math.ceil(p.amount / 0.7)), 0)
      : Math.ceil(order.amount / 0.7);
    const money = buildOrderProfitSnapshot(order, settings ?? {}, purchaseRobux);
    await (prisma as any).$transaction([
      (prisma as any).wbOrder.update({
        where: { id: orderId },
        data:  { status: "COMPLETED", buyoutErrorCode: null, purchaseRate: currentRate, completedAt: new Date(), ...(money ?? {}) },
      }),
      // Ручное «Выкуплено» закрывает и оставшиеся части: заказ не может быть
      // выполнен, пока в нём висят невыкупленные куски — иначе карточка
      // COMPLETED показывала бы «1/3» и вводила в заблуждение.
      ...(splitParts.length > 0
        ? [(prisma as any).wbOrderGamepass.updateMany({
            where: { orderId, purchasedAt: null },
            data: { purchasedAt: new Date() },
          })]
        : []),
    ]);
    await recordOrderStatusChange({
      orderId, from: order.status, to: "COMPLETED", actor: `admin:${actor.displayName}`,
      extra: { wbCode: order.wbCode, amount: order.amount, gross: purchaseRobux },
    });
    cachedCounts = null;
    // Уведомление клиенту уходит ТОЛЬКО здесь — при закрытии всего заказа.
    // Отметка отдельной части (`mark-split-part`) клиенту не видна: он получил
    // не всё, за что заплатил, и «заказ выполнен» было бы неправдой.
    notifyOrderCompleted(order.user, orderId, order.amount, order.isDirectOrder).catch(() => {});
    return NextResponse.json({ ok: true });
  }

  // ── Ручная отметка части: выкупили руками, вне нашей кнопки ───────────────
  // Клиенту НИЧЕГО не уходит: он получил не весь заказ. Это внутренний
  // визуал — чтобы было видно, какие пассы уже взяты, и не взять их дважды.
  if (action === "mark-split-part") {
    if (unpaidDirect) return NextResponse.json({ error: UNPAID_DIR_ERROR }, { status: 409 });
    const partId = String(body.partId ?? "");
    const part = splitParts.find((p) => p.id === partId);
    if (!part) return NextResponse.json({ error: "Часть не найдена" }, { status: 404 });

    const markPurchased = body.purchased !== false;
    const stamp = new Date().toISOString().slice(0, 10);

    if (markPurchased) {
      // Цену списания при ручной покупке никто не сообщает — записываем
      // ожидаемую по номиналу части и помечаем в заметке, что она расчётная.
      const assumed = Math.ceil(part.amount / 0.7);
      await (prisma as any).wbOrderGamepass.update({
        where: { id: part.id },
        data: { purchasedAt: new Date(), chargedPrice: part.chargedPrice ?? assumed },
      });
      await appendAdminNote(
        orderId,
        `[РАЗБИВКА-РУЧНАЯ ${stamp}] часть ${part.position + 1}: GP ${part.gamepassId} отмечена выкупленной (${assumed} R$ расчётно)`,
      );
    } else {
      await (prisma as any).wbOrderGamepass.update({
        where: { id: part.id },
        data: { purchasedAt: null, chargedPrice: null },
      });
      await appendAdminNote(
        orderId,
        `[РАЗБИВКА-РУЧНАЯ ${stamp}] часть ${part.position + 1}: GP ${part.gamepassId} снята отметка выкупа`,
      );
    }

    const fresh: StoredPart[] = await (prisma as any).wbOrderGamepass.findMany({
      where: { orderId },
      orderBy: { position: "asc" },
    });
    const nextPart = nextUnpurchasedPart(fresh);
    // `gamepassUrl` заказа всегда смотрит на текущую часть — от этого зависят
    // очередь, живая проверка цены и скрипт покупки.
    if (nextPart) {
      await (prisma as any).wbOrder.update({
        where: { id: orderId },
        data: { gamepassUrl: `https://www.roblox.com/game-pass/${nextPart.gamepassId}` },
      });
    }
    cachedCounts = null;

    return NextResponse.json({
      ok: true,
      progress: describeSplitProgress(fresh),
      allDone: splitIsComplete(fresh),
      // Заказ намеренно НЕ закрывается сам: закрытие шлёт клиенту уведомление,
      // и решение «всё выдано» остаётся явным нажатием «Выкуплено».
      parts: fresh.map((p) => ({ id: p.id, purchasedAt: p.purchasedAt })),
    });
  }

  if (action === "reject") {
    if (!["PENDING", "IN_PROGRESS", "AWAITING_GAMEPASS", "AWAITING_PAYMENT", "PAYMENT_PENDING", "ERROR"].includes(order.status))
      return NextResponse.json({ error: "Cannot reject this order" }, { status: 400 });
    const rejectionReason = String(reason ?? "не указана");
    await (prisma as any).wbOrder.update({
      where: { id: orderId },
      data:  { status: "REJECTED", buyoutErrorCode: null, rejectionReason },
    });
    await recordOrderStatusChange({
      orderId, from: order.status, to: "REJECTED", actor: `admin:${actor.displayName}`,
      reason: rejectionReason, extra: { wbCode: order.wbCode },
    });
    cachedCounts = null;
    notifyOrderRejected(order.user, order.wbCode, rejectionReason, order.amount).catch(() => {});
    return NextResponse.json({ ok: true });
  }

  if (action === "purchase") {
    if (unpaidDirect) return NextResponse.json({ error: UNPAID_DIR_ERROR }, { status: 409 });
    if (!["PENDING", "IN_PROGRESS", "ERROR"].includes(order.status))
      return NextResponse.json({ error: "Order must be PENDING, IN_PROGRESS or ERROR" }, { status: 400 });

    // ❄️ Гард заморозки — до всякого похода в Roblox и до списания робуксов.
    // Читает не только `heldAt` заказа, но и `OrderHold`: заказ мог родиться по
    // заранее замороженному коду за минуту до того, как крон-свип его пометил.
    const heldCheck = await assertOrderNotHeld(prisma, orderId);
    if (heldCheck.held) return NextResponse.json({ error: heldCheck.message }, { status: 409 });

    // ── Разбитый заказ: покупаем ТЕКУЩУЮ часть ──────────────────────────────
    // Инвариант суммы перечитывается здесь заново: между привязкой и выкупом
    // части могли отредактировать, а разошедшаяся сумма означает, что
    // покупатель получит не то количество робуксов, за которое заплатил.
    const activePart = splitParts.length > 0 ? nextUnpurchasedPart(splitParts) : null;
    if (splitParts.length > 0) {
      try {
        assertSplitCoversOrder(splitParts, order.amount);
      } catch (err) {
        return NextResponse.json(
          { error: err instanceof SplitError ? err.message : "Разбиение повреждено" },
          { status: 409 },
        );
      }
      if (!activePart)
        return NextResponse.json({ error: "Все части уже выкуплены — обнови список" }, { status: 409 });
    }
    /** Номинал, под который проверяется цена: у разбитого заказа — часть. */
    const guardAmount = activePart ? activePart.amount : order.amount;

    let gpId: string;
    if (activePart) {
      gpId = activePart.gamepassId;
    } else {
      const gpMatch = order.gamepassUrl?.match(/game-pass(?:es)?\/(\d+)/);
      if (!gpMatch) return NextResponse.json({ error: "No gamepass URL" }, { status: 400 });
      gpId = gpMatch[1];
    }

    const settings = await (prisma as any).globalSettings.findUnique({ where: { id: "global" } });
    const cookie = settings?.robloxCookie;
    if (!cookie) return NextResponse.json({ error: "Cookie не задан. Добавь его в TWA → Аккаунт → 🔑" }, { status: 400 });

    // Fetch donor-specific info immediately before purchase. Typed Roblox Plus
    // uses the buyer price in the official browser flow; unknown/regional
    // differences still trigger replacement search.
    let info: ResolvedGamepass;
    try {
      info = await resolveGamepassForBuyer(gpId, cookie);
    } catch (err) {
      const status = err instanceof BuyoutError ? err.status : 502;
      return NextResponse.json({ error: err instanceof Error ? err.message : "Не удалось получить product-info" }, { status });
    }

    if (!info.isForSale)
      return NextResponse.json({ error: "Геймпасс не на продаже" }, { status: 400 });

    const stamp = new Date().toISOString().slice(0, 10);
    const unsafeBuyerPrice = info.hasUnsafeBuyerPrice;
    if (unsafeBuyerPrice) {
      const original = info;
      const replacement = await findFullPriceReplacement(order, cookie, gpId, guardAmount);
      if (!replacement) {
        const wasRegional = order.buyoutErrorCode === BUYOUT_ERROR_REGIONAL_PRICE;
        const line = `[РЕГ-ЦЕНА ${stamp}] GP ${gpId}: донор ${original.price} R$, база ${original.basePriceInRobux} R$; полная замена по нику не найдена`;
        await (prisma as any).wbOrder.update({
          where: { id: orderId },
          data: { status: "ERROR", buyoutErrorCode: BUYOUT_ERROR_REGIONAL_PRICE },
        });
        await appendAdminNote(orderId, line);
        cachedCounts = null;
        if (!wasRegional) {
          notifyRegionalPriceNeeded(order.user, order.wbCode, Math.ceil(order.amount / 0.7)).catch(() => {});
        }
        return NextResponse.json({
          ok: true,
          success: false,
          failureCode: BUYOUT_ERROR_REGIONAL_PRICE,
          status: "ERROR",
          msg: `Рег. цена ${original.price}/${original.basePriceInRobux} R$ — безопасной замены по нику не найдено`,
        });
      }

      gpId = String(replacement.info.gamepassId);
      info = replacement.info;
      // У разбитого заказа заменяется КОНКРЕТНАЯ часть; `gamepassUrl` заказа
      // просто следует за текущей частью, как и везде в этом коде.
      if (activePart) {
        await (prisma as any).wbOrderGamepass.update({
          where: { id: activePart.id },
          data: { gamepassId: gpId, gamepassUrl: `https://www.roblox.com/game-pass/${gpId}` },
        });
      }
      await (prisma as any).wbOrder.update({
        where: { id: orderId },
        data: {
          gamepassUrl: `https://www.roblox.com/game-pass/${gpId}`,
          robloxUsername: replacement.resolvedName,
          buyoutErrorCode: null,
        },
      });
      await appendAdminNote(
        orderId,
        `[РЕГ-ЗАМЕНА ${stamp}] GP ${original.gamepassId} (${original.price}/${original.basePriceInRobux} R$) → GP ${gpId} (${info.price} R$)`,
      );
    }

    if (info.robloxPlusDiscountPercent) {
      await appendAdminNote(
        orderId,
        `[ROBLOX PLUS ${stamp}] GP ${gpId}: скидка ${info.robloxPlusDiscountPercent}%, списание ${info.price} R$, база продавца ${info.basePriceInRobux} R$`,
      );
    }

    const price = info.price;
    const base = info.basePriceInRobux;
    const creatorId = info.sellerId;
    const creatorName: string | null = info.sellerName;
    if (!unsafeBuyerPrice && order.buyoutErrorCode === BUYOUT_ERROR_REGIONAL_PRICE) {
      await (prisma as any).wbOrder.update({ where: { id: orderId }, data: { buyoutErrorCode: null } });
    }

    // ЦЕНА-СТОП (PLAN-gp-price-guard Ш1, инцидент 12.07): выкуп возможен только
    // по цене, ожидаемой из номинала заказа. Раньше покупали по live-цене без
    // сверки — клиент, поднявший цену пасса после приёма ботом, получал больше.
    // Статус заказа НЕ меняем: это проблема строки, не «ошибка выкупа».
    const { ok: priceOk, expected } = checkGamepassPrice(guardAmount, price, base);
    if (!priceOk) {
      const scope = activePart ? `часть ${activePart.position + 1} на ${guardAmount} R$` : `номинал ${order.amount}`;
      await appendAdminNote(orderId, `[ЦЕНА-СТОП ${stamp}] пасс ${price} R$ ≠ ожид ${expected} R$ (${scope}) — выкуп заблокирован`);
      return NextResponse.json({ ok: true, success: false,
        msg: `⛔ Цена пасса ${price} R$ ≠ ожидаемой ${expected} R$ (${scope}). Выкуп заблокирован — нужен пасс ровно за ${expected} R$.` });
    }
    // ПРОДАВЕЦ-СТОП: подтверждённый ник заказа должен совпадать с создателем
    // пасса (перенос seller-check из автовыкупа — ловит подменённый ГП).
    if (!sellerMatchesOrder(order.robloxUsername, creatorName)) {
      await appendAdminNote(orderId, `[ПРОДАВЕЦ-СТОП ${stamp}] продавец ${creatorName} ≠ ник ${order.robloxUsername} — выкуп заблокирован`);
      return NextResponse.json({ ok: true, success: false,
        msg: `⛔ Продавец пасса ${creatorName} ≠ нику заказа ${order.robloxUsername}. Выкуп заблокирован — проверь, чей это геймпасс.` });
    }

    const purchaseResult = await purchaseGamepassWithCookie(cookie, {
      productId: info.productId,
      price,
      sellerId: creatorId,
      gamepassId: gpId,
    });

    if (purchaseResult.success) {
      const currentRate = settings?.purchaseRate ?? null;
      const purchaserUsername = settings?.robloxAccountName ?? null;
      const chargedPrice = Number(purchaseResult.price ?? price);

      // ── Разбитый заказ: закрылась часть ───────────────────────────────────
      // Робуксы уже списаны, поэтому отметка части идёт ПЕРВОЙ и отдельно от
      // закрытия заказа: упасть между покупкой и записью можно, и тогда
      // повторное нажатие обязано увидеть, что эта часть уже оплачена.
      if (activePart) {
        await (prisma as any).wbOrderGamepass.update({
          where: { id: activePart.id },
          data: { gamepassId: gpId, chargedPrice, purchasedAt: new Date() },
        });
        const fresh: StoredPart[] = await (prisma as any).wbOrderGamepass.findMany({
          where: { orderId },
          orderBy: { position: "asc" },
        });
        const nextPart = nextUnpurchasedPart(fresh);
        const progress = describeSplitProgress(fresh);
        await appendAdminNote(
          orderId,
          `[РАЗБИВКА ${stamp}] часть ${activePart.position + 1}/${fresh.length}: GP ${gpId} за ${chargedPrice} R$ (${progress})`,
        );

        if (!splitIsComplete(fresh)) {
          // Заказ остаётся в очереди: покупатель не получил всё оплаченное,
          // и уведомлять его об исполнении рано.
          await (prisma as any).wbOrder.update({
            where: { id: orderId },
            data: {
              gamepassUrl: nextPart ? `https://www.roblox.com/game-pass/${nextPart.gamepassId}` : order.gamepassUrl,
              status: "IN_PROGRESS",
              buyoutErrorCode: null,
            },
          });
          cachedCounts = null;
          await notifyRetailBuyoutAdmins({
            source: "twa-order",
            wbCode: order.wbCode,
            gamepassId: gpId,
            amount: activePart.amount,
            chargedPrice,
            donorName: purchaserUsername,
            sellerName: creatorName,
            balance: purchaseResult.balance,
          }).catch((err) => console.warn("[twa/orders] admin buyout notification failed:", err));
          return NextResponse.json({
            ok: true,
            success: true,
            splitProgress: progress,
            splitDone: false,
            nextGamepassId: nextPart?.gamepassId ?? null,
            chargedPrice,
            basePrice: base,
            balance: purchaseResult.balance,
            msg: `Часть ${progress} куплена за ${chargedPrice} R$. Осталось ${fresh.length - fresh.filter((p) => p.purchasedAt).length} — нажми «Выкупить» ещё раз.`,
          });
        }
      }

      // Себестоимость заказа — сумма всех списаний, а не последнее из них.
      const totalCharged = activePart
        ? splitChargedTotal(
            await (prisma as any).wbOrderGamepass.findMany({ where: { orderId }, select: { chargedPrice: true, purchasedAt: true } }),
          )
        : chargedPrice;
      const money = buildOrderProfitSnapshot(order, settings ?? {}, totalCharged);
      await (prisma as any).wbOrder.updateMany({
        where: { id: orderId, status: { in: ["PENDING", "IN_PROGRESS", "ERROR"] } },
        data: { status: "COMPLETED", buyoutErrorCode: null, purchaseRate: currentRate, purchaserUsername, completedAt: new Date(), ...(money ?? {}) },
      });
      cachedCounts = null;
      notifyOrderCompleted(order.user, orderId, order.amount, order.isDirectOrder ?? false).catch(() => {});
      await notifyRetailBuyoutAdmins({
        source: "twa-order",
        wbCode: order.wbCode,
        gamepassId: gpId,
        amount: order.amount,
        chargedPrice: totalCharged,
        donorName: purchaserUsername,
        sellerName: creatorName,
        balance: purchaseResult.balance,
      }).catch((err) => console.warn("[twa/orders] admin buyout notification failed:", err));
      return NextResponse.json({
        ok: true,
        success: true,
        ...(activePart ? { splitProgress: describeSplitProgress(splitParts), splitDone: true } : {}),
        robloxPlusDiscountPercent: info.robloxPlusDiscountPercent,
        chargedPrice: totalCharged,
        basePrice: base,
        balance: purchaseResult.balance,
        msg: purchaseResult.msg,
      });
    }

    const infrastructureFailure = isBrowserInfrastructureFailure(purchaseResult.reason ?? purchaseResult.msg);
    if (!infrastructureFailure) {
      await (prisma as any).wbOrder.updateMany({
        where: { id: orderId, status: { in: ["PENDING", "IN_PROGRESS"] } },
        data: {
          status: "ERROR",
          buyoutErrorCode: /already.?own/i.test(purchaseResult.reason ?? purchaseResult.msg)
            ? "GAMEPASS_REUSED"
            : null,
        },
      });
      cachedCounts = null;
    }
    return NextResponse.json({
      ok: true,
      success: false,
      msg: infrastructureFailure
        ? browserFailureMessage(purchaseResult.reason ?? purchaseResult.msg)
        : purchaseResult.msg,
      failureCode: infrastructureFailure ? BUYOUT_ERROR_LEGACY_PURCHASE_FLOW : undefined,
      status: infrastructureFailure ? order.status : "ERROR",
    });
  }

  if (action === "edit-avito") {
    if (order.orderSource !== "AVITO")
      return NextResponse.json({ error: "Только для Авито-заказов" }, { status: 400 });
    if (!["PENDING", "AWAITING_GAMEPASS", "ERROR"].includes(order.status))
      return NextResponse.json({ error: "Нельзя редактировать в этом статусе" }, { status: 400 });

    const data: any = {};
    if (body.amount !== undefined) {
      const amt = Number(body.amount);
      if (!amt || amt < 1) return NextResponse.json({ error: "amount должен быть > 0" }, { status: 400 });
      data.amount = amt;
    }
    if (body.robloxUsername !== undefined) data.robloxUsername = body.robloxUsername || null;
    if (body.note !== undefined) data.adminNote = typeof body.note === "string" ? body.note.trim().slice(0, 2000) || null : null;
    if (body.gamepassUrl !== undefined) {
      const raw = String(body.gamepassUrl ?? "").trim();
      if (raw) {
        data.gamepassUrl = raw.includes("roblox.com") ? raw : /^\d+$/.test(raw) ? `https://www.roblox.com/game-pass/${raw}` : raw;
        data.buyoutErrorCode = null;
        if (!order.gamepassUrl) { data.status = "PENDING"; data.pendingAt = new Date(); }
      } else {
        data.gamepassUrl = null;
        data.buyoutErrorCode = null;
        data.status = "AWAITING_GAMEPASS";
        data.pendingAt = null;
      }
    }
    if (Object.keys(data).length === 0)
      return NextResponse.json({ error: "Нет данных для обновления" }, { status: 400 });

    await (prisma as any).wbOrder.update({ where: { id: orderId }, data });
    cachedCounts = null;
    return NextResponse.json({ ok: true });
  }

  // Универсальное редактирование заказа из карточки (обобщение edit-avito на
  // все источники): менеджер правит номинал/ник/геймпасс ЗА клиента — кейс
  // QARJR71 12.07 (замена подставленного пасса + корректировка номинала).
  // Заметка правится в NotesEditor карточки; изменения аудируются в adminNote.
  if (action === "edit-order") {
    if (unpaidDirect) return NextResponse.json({ error: UNPAID_DIR_ERROR }, { status: 409 });
    // ❄️ Раньше гарда здесь не было, и он не был нужен: правку открывала только
    // кнопка на карточке, а у замороженного заказа карточка кнопок выкупа не
    // показывает. С 31.08 лист заказа умеет переключаться в правку по введённому
    // коду — замороженный заказ стал достижим из формы создания, и правка без
    // гарда была бы чёрным ходом мимо заморозки: поправил ник с геймпассом, и
    // заказ снова выглядит рабочим. Разморозка обязана быть отдельным шагом.
    if (order.heldAt)
      return NextResponse.json({ error: heldRefusal(order.heldReason) }, { status: 409 });
    if (!["PENDING", "AWAITING_GAMEPASS", "ERROR", "REJECTED"].includes(order.status))
      return NextResponse.json({ error: "Нельзя редактировать в этом статусе" }, { status: 400 });

    const data: any = {};
    const changes: string[] = [];
    /** ID пасса, который ставит эта правка — нужен следу «цена-стоп обойдён». */
    let attachedGamepassId: string | null = null;

    if (body.amount !== undefined) {
      const amt = Number(body.amount);
      if (!amt || !Number.isFinite(amt) || amt < 1)
        return NextResponse.json({ error: "amount должен быть > 0" }, { status: 400 });
      if (order.isDirectOrder && amt !== order.amount)
        return NextResponse.json({ error: "У прямого заказа номинал привязан к оплате — правь ник/геймпасс" }, { status: 400 });
      if (amt !== order.amount) { data.amount = amt; changes.push(`номинал ${order.amount}→${amt}`); }
    }

    if (body.robloxUsername !== undefined) {
      const nick = String(body.robloxUsername ?? "").trim().replace(/^@/, "") || null;
      if (nick !== (order.robloxUsername ?? null)) {
        data.robloxUsername = nick;
        changes.push(`ник ${order.robloxUsername ?? "—"}→${nick ?? "—"}`);
      }
    }

    if (body.gamepassUrl !== undefined) {
      const raw = String(body.gamepassUrl ?? "").trim();
      const gpId = raw.match(/game-pass(?:es)?\/(\d+)/)?.[1] ?? (/^\d{4,}$/.test(raw) ? raw : null);
      if (raw && !gpId)
        return NextResponse.json({ error: "Геймпасс: нужна ссылка roblox.com/game-pass/<id> или ID" }, { status: 400 });
      const oldId = gpIdOf(order.gamepassUrl);
      if ((gpId ?? null) !== (oldId ?? null)) {
        // Дедуп как в create-manual: ГП уже в другом активном заказе → 409,
        // force обходит (осознанное решение менеджера).
        if (gpId && body.force !== true) {
          const candidates = await (prisma as any).wbOrder.findMany({
            where: { isTest: false, id: { not: orderId }, status: { in: ["AWAITING_GAMEPASS", "PENDING", "IN_PROGRESS"] }, gamepassUrl: { contains: `/${gpId}` } },
            orderBy: { createdAt: "desc" }, take: 5,
            select: { wbCode: true, status: true, gamepassUrl: true },
          });
          const existing = candidates.find((o: any) => gpIdOf(o.gamepassUrl) === gpId);
          if (existing)
            return NextResponse.json({
              error: `На этот геймпасс уже есть активный заказ ${existing.wbCode}`,
              existing: { wbCode: existing.wbCode, status: existing.status },
            }, { status: 409 });
        }
        data.gamepassUrl = gpId ? `https://www.roblox.com/game-pass/${gpId}` : null;
        attachedGamepassId = gpId ?? null;
        data.buyoutErrorCode = null;
        changes.push(gpId ? `ГП ${oldId ?? "—"}→${gpId}` : `ГП ${oldId} снят`);
        // Переходы статуса — паритет с edit-avito: появился пасс → в очередь,
        // сняли пасс → ждать ссылку. Замена пасса в ERROR статус не трогает.
        if (!gpId) { data.status = "AWAITING_GAMEPASS"; data.pendingAt = null; }
        else if (!order.gamepassUrl) { data.status = "PENDING"; data.pendingAt = new Date(); }
      }
    }

    /* Источник заказа — тоже поле карточки, а не отдельная операция.
       `WB_DBS` в списке обязателен: заказ, приехавший из доставки, отличается
       от обычного вебешного полосой очереди и правилами уведомлений, и
       «поправить источник» без него значило бы «поправить на неверный». */
    if (body.orderSource !== undefined) {
      const src = String(body.orderSource ?? "");
      if (!["WB", "WB_DBS", "DIRECT", "AVITO", "MANUAL"].includes(src))
        return NextResponse.json({ error: "Неизвестный источник заказа" }, { status: 400 });
      if (src !== order.orderSource) {
        data.orderSource = src;
        changes.push(`источник ${order.orderSource}→${src}`);
      }
    }

    /* Заметка правится ЗДЕСЬ же, человеческой частью: редактор карточки — одно
       окно на все поля, и «сохранил поля, а заметку забыл вторым запросом» —
       это ровно та потеря, из-за которой правки делали в двух местах.
       Машинный аудит сохраняется, как в `set-note` с `keepTags`. */
    let noteAfter: string | null | undefined;
    if (typeof body.note === "string") {
      const next = body.note.trim().slice(0, 2000);
      const lines = (order.adminNote ?? "").split("\n").map((line: string) => line.trim());
      const humanBefore = lines.filter((line: string) => line && !line.startsWith("[")).join(" · ");
      if (next !== humanBefore) {
        const tagged = lines.filter((line: string) => line.startsWith("["));
        noteAfter = [...tagged, ...(next ? [next] : [])].join("\n").slice(0, 2000) || null;
        data.adminNote = noteAfter;
        changes.push(next ? "заметка" : "заметка снята");
      }
    }

    if (Object.keys(data).length === 0)
      return NextResponse.json({ error: "Нет изменений" }, { status: 400 });

    await (prisma as any).wbOrder.update({ where: { id: orderId }, data });
    const stamp = new Date().toISOString().slice(0, 10);
    await appendAdminNote(orderId, `[EDIT ${stamp} от ${actor.displayName}] ${changes.join(", ")}`);

    /* Пасс не по номиналу поставлен осознанно (решение владельца 04.09.2026).
       Карточка спрашивает подтверждение и присылает увиденную цену — след
       остаётся здесь, потому что заметку заказа пишет сервер, а не клиент.
       Гард выкупа это НЕ отменяет: покупка на такой цене всё равно встанет,
       и заказ будет ждать решения уже на выкупе, а не молча уедет мимо денег. */
    if (attachedGamepassId && body.priceAck !== undefined) {
      const seen = Number(body.priceAck);
      const expected = expectedGamepassPrice(data.amount ?? order.amount);
      if (Number.isFinite(seen) && seen > 0 && Math.abs(seen - expected) > PRICE_TOL) {
        await appendAdminNote(
          orderId,
          `[ЦЕНА-СТОП ОБОЙДЁН ${stamp} от ${actor.displayName}] пасс ${attachedGamepassId} — ${seen} R$ при ожидаемых ${expected} R$`,
        );
      }
    }

    /* Появившийся пасс — то же событие, что и `attach-gamepass`, и клиент
       обязан узнать о нём так же: до 03.09 правка молча ставила заказ в
       очередь, а привязка из формы создания о ней сообщала. Два разных
       поведения на одно и то же действие — хуже любого из них. */
    let notified: string | null = null;
    if (data.status === "PENDING" && data.gamepassUrl) {
      notified = await notifyGamepassAttached(order.user, order.wbCode).catch(() => null);
    }
    if (data.status && data.status !== order.status) {
      await recordOrderStatusChange({
        orderId, from: order.status, to: String(data.status), actor: `admin:${actor.displayName}`,
        extra: { wbCode: order.wbCode, why: "edit-order", changes },
      });
    }
    cachedCounts = null;
    return NextResponse.json({ ok: true, changes, notified, note: noteAfter });
  }

  if (action === "set-source") {
    const src = body.source as string;
    if (!["WB", "DIRECT", "AVITO", "MANUAL"].includes(src))
      return NextResponse.json({ error: "Invalid source" }, { status: 400 });
    await (prisma as any).wbOrder.update({
      where: { id: orderId },
      data: { orderSource: src },
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "purchase-script") {
    if (unpaidDirect) return NextResponse.json({ error: UNPAID_DIR_ERROR }, { status: 409 });
    const gpMatch = order.gamepassUrl?.match(/game-pass(?:es)?\/(\d+)/);
    if (!gpMatch) return NextResponse.json({ error: "No gamepass URL" }, { status: 400 });
    const gpId = gpMatch[1];

    const settings = await (prisma as any).globalSettings.findUnique({ where: { id: "global" } });
    const donorCookie = settings?.robloxCookie as string | null | undefined;

    let info: ResolvedGamepass;
    let browserFallback = false;

    if (donorCookie) {
      try {
        info = await resolveGamepassForBuyer(gpId, donorCookie);
      } catch (err) {
        if (err instanceof BuyoutError && err.status >= 500) {
          // Browser service down — fall back to public API
          try {
            info = await resolveGamepass(gpId);
            browserFallback = true;
          } catch (fallbackErr) {
            const status = fallbackErr instanceof BuyoutError ? fallbackErr.status : 502;
            return NextResponse.json({ error: fallbackErr instanceof Error ? fallbackErr.message : "Не удалось получить данные геймпасса" }, { status });
          }
        } else {
          const status = err instanceof BuyoutError ? err.status : 502;
          return NextResponse.json({ error: err instanceof Error ? err.message : "Не удалось получить персональную цену Roblox" }, { status });
        }
      }
    } else {
      try {
        info = await resolveGamepass(gpId);
        browserFallback = true;
      } catch (err) {
        const status = err instanceof BuyoutError ? err.status : 502;
        return NextResponse.json({ error: err instanceof Error ? err.message : "Не удалось получить данные геймпасса" }, { status });
      }
    }

    const price = info.price;
    const base = info.basePriceInRobux;
    const isManagedPricing = info.isManagedPricing;
    const isForSale = info.isForSale;
    const creatorId = info.sellerId;
    const creatorName = info.sellerName;
    const name = info.name;

    if (info.hasUnsafeBuyerPrice) {
      return NextResponse.json({
        error: `Рег. или неизвестная цена ${price}/${base} R$ — скрипт не выдан`,
        failureCode: BUYOUT_ERROR_REGIONAL_PRICE,
      }, { status: 409 });
    }

    // ЦЕНА-СТОП (PLAN-gp-price-guard Ш2): скрипт с live-ценой радостно купил бы
    // и подороженный пасс — при расхождении с номиналом скрипт не выдаётся.
    const { ok: priceOk, expected } = checkGamepassPrice(order.amount, price, base);
    if (!priceOk)
      return NextResponse.json(
        { error: `⛔ Цена пасса ${price} R$ ≠ ожидаемой ${expected} R$ (номинал ${order.amount}) — скрипт не выдан` },
        { status: 409 },
      );

    // Donor identity is part of the single-egress guard: a script without the
    // verified buyer account could execute in an unrelated Roblox tab.
    if (!info.buyerAccountId)
      return NextResponse.json(
        { error: "Не удалось подтвердить аккаунт донора — скрипт не выдан" },
        { status: 503 },
      );

    const script = buildGamepassPurchaseScript({
      gamepassId: gpId,
      productId: info.productId,
      expectedPrice: price,
      sellerId: creatorId,
      buyerUserId: info.buyerAccountId,
    });

    return NextResponse.json({
      ok: true, script, name, price, base, creatorName,
      isForSale, isManagedPricing, gamepassId: gpId,
      pageUrl: gamepassPageUrl(gpId),
      browserFallback,
    });
  }

  if (action === "attach-gamepass") {
    // attach переводит заказ в PENDING (очередь выкупа) — для неоплаченного DIR закрыто.
    if (unpaidDirect) return NextResponse.json({ error: UNPAID_DIR_ERROR }, { status: 409 });
    const raw = String(body.gamepassId ?? "").trim();
    const idMatch = raw.match(/game-pass(?:es)?\/(\d+)/i) ?? raw.match(/^(\d+)$/);
    if (!idMatch)
      return NextResponse.json({ error: "gamepassId обязателен (ID или URL)" }, { status: 400 });
    const gamepassUrl = `https://www.roblox.com/game-pass/${idMatch[1]}`;

    const ATTACHABLE = ["AWAITING_GAMEPASS", "REJECTED", "ERROR", "PENDING"];
    if (!ATTACHABLE.includes(order.status))
      return NextResponse.json({ error: `Нельзя привязать геймпасс к заказу в статусе ${order.status}` }, { status: 400 });

    const now = new Date().toISOString().slice(0, 10);
    const auditNote = `[GP-ATTACH ${now}] ${gamepassUrl} (вручную из TWA)`;
    const existingNote = order.adminNote ? order.adminNote + "\n" : "";

    await (prisma as any).wbOrder.update({
      where: { id: orderId },
      data: {
        gamepassUrl,
        status: "PENDING",
        pendingAt: order.status === "PENDING" ? order.pendingAt : new Date(),
        rejectionReason: null,
        adminId: null,
        adminNote: (existingNote + auditNote).slice(0, 2000),
        buyoutErrorCode: null,
      },
    });
    cachedCounts = null;

    // Дожидаемся реальной отправки: менеджер должен знать, дошло ли уведомление
    // (VK error 901 у юзеров без диалога с сообществом теряется молча).
    const notified = await notifyGamepassAttached(order.user, order.wbCode).catch(() => null);

    return NextResponse.json({
      ok: true,
      wbCode: order.wbCode,
      notified,
    });
  }

  /* ── Лента событий заказа (В3, досье веб-админки) ──────────────────────────
     Одна лента на автоматику и людей: `OrderEvent` — это то, что сделала
     система, `adminNote` — то, что дописывали руками (`appendOrderAudit`).
     При трёх админах это главный ответ на «почему заказ в таком виде»,
     поэтому строки заметки отдаются вместе с событиями, а не отдельно. */
  if (action === "order-events") {
    const events = await (prisma as any).orderEvent.findMany({
      where: { orderId },
      orderBy: { createdAt: "desc" },
      take: 40,
      select: { id: true, type: true, payload: true, createdAt: true },
    });
    return NextResponse.json({
      ok: true,
      events,
      // Ручной след: строки вида «[ВОЗВРАТ 2026-09-03 от Дью] …».
      noteLines: (order.adminNote ?? "")
        .split("\n")
        .map((line: string) => line.trim())
        .filter(Boolean),
      createdAt: order.createdAt,
      pendingAt: order.pendingAt,
      completedAt: order.completedAt ?? null,
      heldAt: order.heldAt,
      heldReason: order.heldReason,
      heldBy: order.heldBy,
    });
  }

  // ── След покупателя: что он вводил и присылал ────────────────────────────
  // Читается при разборе спора («я такой ник не указывал»), поэтому грузится
  // по запросу, а не в общий список — там это лишний вес на каждой карточке.
  if (action === "order-audit") {
    const events = await (prisma as any).orderEvent.findMany({
      where: { orderId, type: { in: ["AUDIT_NICK_ENTERED", "AUDIT_GAMEPASS_SUBMITTED"] } },
      orderBy: { createdAt: "asc" },
      select: { id: true, type: true, payload: true, createdAt: true },
    });
    return NextResponse.json({
      ok: true,
      wbCode: order.wbCode,
      createdAt: order.createdAt,
      // Подтверждённый ник и выкупленный пасс — вторая половина доказательства:
      // их пишет Roblox, а не покупатель.
      confirmedNick: order.robloxUsername,
      gamepassId: order.gamepassId,
      events,
    });
  }

  // Кандидаты для разбиения: пассы ника заказа с их номиналом «нетто».
  // Админ тыкает по найденным пассам, а не переписывает ID руками — ошибиться
  // в двадцатизначном числе проще, чем кажется.
  if (action === "split-candidates") {
    const nick = order.robloxUsername ?? order.probableNick;
    if (!nick) return NextResponse.json({ error: "У заказа нет ника Roblox" }, { status: 400 });
    const found = await searchForSalePassesByNick(nick).catch(() => null);
    if (!found || found.status !== "ok")
      return NextResponse.json({ ok: true, nick, passes: [], reason: found?.status ?? "unreachable" });

    const usedByOthers = await (prisma as any).wbOrder.findMany({
      where: {
        id: { not: orderId },
        isTest: false,
        status: { in: ["AWAITING_GAMEPASS", "PENDING", "IN_PROGRESS", "ERROR", "AWAITING_PAYMENT", "PAYMENT_PENDING"] },
        gamepassId: { in: found.passes.map((p: any) => String(p.gamepassId)) },
      },
      select: { gamepassId: true, wbCode: true },
    });
    const busy = new Map<string, string>(usedByOthers.map((r: any) => [String(r.gamepassId), r.wbCode]));

    return NextResponse.json({
      ok: true,
      nick,
      // Имя, которым ответил Roblox: в заказе может лежать другой регистр или
      // старый ник, а список подписан аккаунтом, где пассы реально лежат.
      resolvedName: found.resolvedName ?? nick,
      passes: found.passes.map((p: any) => ({
        gamepassId: String(p.gamepassId),
        name: p.name,
        price: p.price,
        // Номинал, который закрывает этот пасс: обратная сторона ceil(x/0.7).
        amount: Math.floor(Number(p.price) * 7 / 10),
        busyWith: busy.get(String(p.gamepassId)) ?? null,
      })),
    });
  }

  // ── Разбиение выкупа: несколько геймпассов на один заказ ──────────────────
  // Покупателю бывает удобнее выставить три пасса по 1000 вместо одного на
  // 3000 — а прайс-гард сверяет цену с номиналом ЗАКАЗА, и такой заказ не
  // выкупить вообще. Здесь у каждой части свой номинал, и гард смотрит на него.
  if (action === "set-gamepass-split") {
    if (unpaidDirect) return NextResponse.json({ error: UNPAID_DIR_ERROR }, { status: 409 });

    const SPLITTABLE = ["AWAITING_GAMEPASS", "REJECTED", "ERROR", "PENDING", "IN_PROGRESS"];
    if (!SPLITTABLE.includes(order.status))
      return NextResponse.json({ error: `Нельзя разбить заказ в статусе ${order.status}` }, { status: 400 });
    // Уже купленную часть нельзя ни выбросить, ни переоценить: робуксы списаны.
    if (splitParts.some((p) => p.purchasedAt))
      return NextResponse.json(
        { error: `Часть заказа уже выкуплена (${describeSplitProgress(splitParts)}) — сначала сними разбиение через «Снять разбиение»` },
        { status: 409 },
      );

    let parts;
    try {
      parts = buildSplitParts(body.parts, order.amount);
    } catch (err) {
      if (err instanceof SplitError) return NextResponse.json({ error: err.message }, { status: 400 });
      throw err;
    }

    // ── Проверка каждой части на живом Roblox ────────────────────────────────
    // Ровно те же три вопроса, что задаёт обычный выкуп, только про часть:
    // пасс продаётся, принадлежит нику заказа, стоит ровно `ceil(amount/0.7)`.
    // Повторы одного пасса законны и проверяются на общих основаниях: цена у
    // него одна, значит и номинал у всех его частей одинаковый —
    // `buildSplitParts` это уже сверил.
    const settings = await (prisma as any).globalSettings.findUnique({ where: { id: "global" } });
    const cookie = settings?.robloxCookie;
    const checked: { gamepassId: string; amount: number; name: string; price: number | null }[] = [];
    /** Части, про которые Roblox не ответил вообще ни по одному источнику. */
    const unverified: string[] = [];
    let unverifiedReason = "";
    // Один пасс может стоять в нескольких частях (у покупателя один пасс на
    // 1000, а заказ на 2000) — Roblox о нём спрашиваем один раз.
    const resolved = new Map<string, BindingInfo | null>();
    for (const part of parts) {
      let info: BindingInfo | null | undefined = resolved.get(part.gamepassId);
      if (info === undefined) {
        const attempt = await resolveGamepassForBinding(part.gamepassId, cookie);
        info = attempt.info;
        if (!info && attempt.reason) unverifiedReason = attempt.reason;
        resolved.set(part.gamepassId, info);
      }
      if (!info) {
        if (!unverified.includes(part.gamepassId)) unverified.push(part.gamepassId);
        checked.push({ gamepassId: part.gamepassId, amount: part.amount, name: "?", price: null });
        continue;
      }
      if (!info.isForSale)
        return NextResponse.json({ error: `Геймпасс ${part.gamepassId} не выставлен на продажу` }, { status: 409 });

      const { ok, expected } = partPriceMatches(part, info.price, info.basePrice);
      if (!ok)
        return NextResponse.json({
          error: `Геймпасс ${part.gamepassId}: цена ${info.basePrice ?? info.price} R$ ≠ ожидаемой ${expected} R$ для части на ${part.amount} R$`,
        }, { status: 409 });

      if (!sellerMatchesOrder(order.robloxUsername, info.sellerName))
        return NextResponse.json({
          error: `Геймпасс ${part.gamepassId} принадлежит ${info.sellerName}, а заказ на ${order.robloxUsername}`,
        }, { status: 409 });

      checked.push({ gamepassId: part.gamepassId, amount: part.amount, name: info.name, price: info.price });
    }

    // Чужой заказ на том же пассе — это гонка за один и тот же геймпасс:
    // кто выкупит первым, второй получит AlreadyOwned и списание впустую.
    const foreign = await (prisma as any).wbOrder.findFirst({
      where: {
        id: { not: orderId },
        isTest: false,
        status: { in: ["AWAITING_GAMEPASS", "PENDING", "IN_PROGRESS", "ERROR", "AWAITING_PAYMENT", "PAYMENT_PENDING"] },
        gamepassId: { in: parts.map((p) => p.gamepassId) },
      },
      select: { wbCode: true, gamepassId: true },
    });
    if (foreign)
      return NextResponse.json(
        { error: `Геймпасс ${foreign.gamepassId} уже привязан к заказу ${foreign.wbCode}` },
        { status: 409 },
      );

    const stamp = new Date().toISOString().slice(0, 10);
    // Повтор пасса — не ошибка, но след о нём в заметке нужен: следующую такую
    // часть обязан выкупать ДРУГОЙ донор, иначе Roblox ответит AlreadyOwned.
    const repeats = [...new Map(
      parts.map((p) => [p.gamepassId, parts.filter((q) => q.gamepassId === p.gamepassId).length]),
    )].filter(([, n]) => n > 1);
    const line = `[РАЗБИВКА ${stamp}] ${parts.length} ч.: ` +
      checked.map((c) => `${c.gamepassId} (${c.amount} R$ / ${c.price ?? "цена ?"} R$)`).join(", ") +
      (repeats.length
        ? ` · повторы: ${repeats.map(([id, n]) => `${id} ×${n}`).join(", ")} — каждый с ДРУГОГО донора`
        : "") +
      // След обязателен: разбиение записано без подтверждения от Roblox, и
      // единственная проверка цены и продавца у этих частей теперь — та, что
      // сработает перед списанием робуксов.
      (unverified.length
        ? ` · БЕЗ ПРОВЕРКИ ${unverified.join(", ")} (${unverifiedReason}) — цену и продавца сверит выкуп`
        : "");

    await (prisma as any).$transaction([
      (prisma as any).wbOrderGamepass.deleteMany({ where: { orderId } }),
      (prisma as any).wbOrderGamepass.createMany({
        data: parts.map((p) => ({
          orderId,
          gamepassId: p.gamepassId,
          gamepassUrl: p.gamepassUrl,
          amount: p.amount,
          position: p.position,
        })),
      }),
      // Легаси-поле продолжает указывать на ТЕКУЩУЮ часть. Так весь остальной
      // код — очередь, поиск, уведомления, скрипт покупки — работает без правок
      // и видит ровно тот пасс, который покупается прямо сейчас.
      (prisma as any).wbOrder.update({
        where: { id: orderId },
        data: {
          gamepassUrl: parts[0].gamepassUrl,
          status: "PENDING",
          pendingAt: order.status === "PENDING" ? order.pendingAt : new Date(),
          rejectionReason: null,
          buyoutErrorCode: null,
          adminNote: ((order.adminNote ? order.adminNote + "\n" : "") + line).slice(0, 2000),
        },
      }),
    ]);
    cachedCounts = null;

    return NextResponse.json({
      ok: true,
      wbCode: order.wbCode,
      parts: checked,
      total: checked.reduce((sum, c) => sum + c.amount, 0),
      // Экран обязан сказать это вслух: разбиение записано, но пассы никто не
      // подтвердил. Молчаливое «готово» выглядело бы как обычная проверенная
      // привязка.
      warning: unverified.length
        ? `Roblox не ответил про ${unverified.join(", ")} (${unverifiedReason}). Разбиение записано без проверки цены и продавца — их сверит выкуп.`
        : null,
    });
  }

  if (action === "clear-gamepass-split") {
    if (splitParts.length === 0)
      return NextResponse.json({ error: "У заказа нет разбиения" }, { status: 400 });
    // Снятие разбиения после частичного выкупа теряет след уже списанных
    // робуксов, поэтому оно только явное и с отметкой в заметке.
    const purchased = splitParts.filter((p) => p.purchasedAt);
    const stamp = new Date().toISOString().slice(0, 10);
    const line = purchased.length
      ? `[РАЗБИВКА-СНЯТА ${stamp}] было куплено ${describeSplitProgress(splitParts)} на ${splitChargedTotal(splitParts)} R$ — сверь вручную`
      : `[РАЗБИВКА-СНЯТА ${stamp}] ничего не куплено`;

    await (prisma as any).$transaction([
      (prisma as any).wbOrderGamepass.deleteMany({ where: { orderId } }),
      (prisma as any).wbOrder.update({
        where: { id: orderId },
        data: { adminNote: ((order.adminNote ? order.adminNote + "\n" : "") + line).slice(0, 2000) },
      }),
    ]);
    cachedCounts = null;
    return NextResponse.json({ ok: true, hadPurchased: purchased.length });
  }

  if (action === "rebind-order") {
    const { targetUserId, note } = body;
    if (!targetUserId) return NextResponse.json({ error: "targetUserId обязателен" }, { status: 400 });

    const REBINDABLE = ["AWAITING_GAMEPASS", "PENDING", "IN_PROGRESS", "ERROR", "REJECTED"];
    if (!REBINDABLE.includes(order.status))
      return NextResponse.json({ error: `Нельзя перепривязать заказ в статусе ${order.status}` }, { status: 400 });

    const targetUser = await (prisma as any).user.findUnique({
      where: { id: targetUserId },
      select: { id: true, tgId: true, vkId: true, username: true, name: true },
    });
    if (!targetUser) return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });

    if (targetUser.id === order.userId)
      return NextResponse.json({ error: "Заказ уже привязан к этому пользователю" }, { status: 400 });

    const newPlatform = targetUser.tgId ? "TG" : "VK";
    const oldLabel = order.user?.username || order.user?.tgId || order.user?.vkId || order.userId;
    const newLabel = targetUser.username || targetUser.tgId || targetUser.vkId || targetUser.id;
    const now = new Date().toISOString().slice(0, 10);
    const auditNote = `[REBIND ${now}] ${order.platform}:${oldLabel} → ${newPlatform}:${newLabel}` + (note ? ` (${note})` : "");

    const existingNote = order.adminNote ? order.adminNote + "\n" : "";

    await (prisma as any).$transaction([
      (prisma as any).wbOrder.update({
        where: { id: orderId },
        data: {
          userId: targetUser.id,
          platform: newPlatform,
          adminNote: (existingNote + auditNote).slice(0, 2000),
        },
      }),
      (prisma as any).wbCode.updateMany({
        where: { code: order.wbCode },
        data: { userId: targetUser.id },
      }),
    ]);

    cachedCounts = null;

    // Дожидаемся отправки — менеджер должен видеть, дошло ли (VK 901 молчалив).
    const notified = await notifyRebind(targetUser, order.amount, order.wbCode, !!order.gamepassUrl).catch(() => null);

    return NextResponse.json({ ok: true, platform: newPlatform, notified });
  }

  // ── 👁 GP-watch из карточки: live-поиск ГП по вероятному нику + пинг клиенту ─
  // Кнопка «Найти ГП и оповестить» / «Оповестить ещё раз» во вкладке «Ждут ссылку».
  if (action === "gpwatch-notify") {
    if (order.status !== "AWAITING_GAMEPASS")
      return NextResponse.json({ error: `Заказ уже в статусе ${order.status}` }, { status: 400 });
    const nick = order.probableNick ?? order.robloxUsername;
    if (!nick)
      return NextResponse.json({ error: "У заказа нет вероятного ника" }, { status: 400 });

    const search = await searchForSalePassesByNick(nick);
    if (search.status === "user_not_found")
      return NextResponse.json({ error: `Ник «${nick}» не найден на Roblox` }, { status: 404 });
    if (search.status === "error")
      return NextResponse.json({ error: "Roblox не ответил — попробуй ещё раз" }, { status: 502 });

    const want = Math.ceil(order.amount / 0.7);
    const match = search.passes
      .filter((p) => Math.abs(p.price - want) <= 2)
      .sort((a, b) => Math.abs(a.price - want) - Math.abs(b.price - want))[0];
    if (!match)
      return NextResponse.json({
        found: false,
        want,
        passes: search.passes.length,
        error: `У «${nick}» нет геймпасса за ${want} R$ (в продаже: ${search.passes.length})`,
      }, { status: 404 });

    const notified = await notifyGpWatchPing(order.user, order.id, nick, match.name, match.price).catch(() => null);
    if (notified) {
      await (prisma as any).wbOrder.update({
        where: { id: orderId },
        data: { gpWatchNotifiedPassId: String(match.gamepassId), gpWatchLastCheckAt: new Date() },
      });
    }

    return NextResponse.json({
      ok: true,
      found: true,
      pass: { gamepassId: match.gamepassId, name: match.name, price: match.price },
      notified,
    });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
