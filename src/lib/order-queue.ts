import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { PAID_BUYOUT_SCOPE, PAID_BUYOUT_SQL } from "@/lib/buyout-queue";
import { NOT_HELD, NOT_HELD_SQL } from "@/lib/order-hold";
import { BUYOUT_ERROR_REGIONAL_PRICE, BUYOUT_ERROR_ROBLOX_PLUS_FLOW, expectedGamepassPrice } from "@/lib/purchase-guard";
import { parseGamepassId } from "@/lib/roblox-buyout";

/* ─────────────────────────────────────────────────────────────────────────────
   Границы рабочих очередей заказов — ОДИН источник на все поверхности.

   Раньше это жило внутри `api/twa/orders/route.ts`. Пока админка была только в
   телефоне, разницы не было; с переездом в веб (docs/admin-console-plan.md §6)
   копия правил означала бы, что «К выкупу» на двух экранах — это два разных
   списка, и однажды они разойдутся молча. Поэтому TWA-роут и веб-роуты
   импортируют отсюда, а не повторяют switch.
   ───────────────────────────────────────────────────────────────────────── */

export type FilterTab =
  | "WORK" | "ALL" | "BUYOUT" | "DIRECT" | "AVITO" | "NEW"
  | "ERROR" | "AWAITING_LINK" | "STALE_LINK" | "DONE" | "REJECTED" | "FAVORITES" | "ATTENTION"
  | "HELD";

/* Заморозка — не двенадцатый статус, а фильтр по одному полю: логика вкладок
   не размножается. Замороженный заказ уходит из ВСЕХ рабочих вкладок в свою,
   чтобы не попасть в выкуп по инерции. `NOT_HELD` подмешан ниже в каждую
   рабочую ветку; `order-hold.test.ts` следит, чтобы новая вкладка его не
   забыла. «Все» намеренно показывает и замороженные — там они с бейджем ❄️. */

/** Сколько часов заказ считается «новым» и не попадает в «ждут ссылку». */
export const NEW_CUTOFF_HOURS = 40;
/** Выкуп висит дольше — заказ уходит в «Требуют внимания». */
export const ATTENTION_BUYOUT_HOURS = 12;
/** Столько дней ждём ссылку, прежде чем поднять тревогу. */
export const ATTENTION_LINK_DAYS = 5;
/**
 * После стольких дней «ждёт ссылку» превращается в висяк.
 *
 * Бот шлёт покупателю три напоминания — 3 ч, 24 ч, 72 ч (`AWAITING_SCHEDULE` в
 * `bots/tg/crons.ts`), и на этом замолкает навсегда. Дальше очередь копит
 * заказы, по которым уже никто ничего не сделает, и они утяжеляют «Ждут
 * ссылку» ровно настолько, чтобы туда перестали заглядывать. Две недели —
 * вдвое больше, чем нужно последнему напоминанию, чтобы сработать.
 */
export const STALE_LINK_DAYS = 14;

/**
 * Ветка `BUYOUT` из `buildTabWhere`, но для сырых SQL-счётчиков.
 *
 * До 30.08.2026 главная и вкладка «К выкупу» считали очередь по-разному: вкладка
 * включала починимые `ERROR` (рег. цена, Roblox+), дашборд — нет, и два экрана
 * показывали разные числа без всякой причины. Предикат живёт здесь ровно затем,
 * чтобы третьего варианта не появилось.
 */
export const BUYOUT_QUEUE_SQL = `
  ${PAID_BUYOUT_SQL}
  AND ${NOT_HELD_SQL}
  AND "orderSource" <> 'AVITO'
  AND "isFavorite" = false
  AND (
    status IN ('PENDING','IN_PROGRESS')
    OR (status = 'ERROR' AND "buyoutErrorCode" IN ('${BUYOUT_ERROR_REGIONAL_PRICE}','${BUYOUT_ERROR_ROBLOX_PLUS_FLOW}'))
  )
`;

/**
 * Откуда пришёл заказ в очереди выкупа — три взаимоисключающие полосы.
 *
 * `SITE` и `DIRECT` — обе «прямые» (сайт создаёт заказ с `isDirectOrder = true`),
 * поэтому ось — `isDirectOrder`, а не перечисление источников: новый прямой
 * канал попадёт в свою полосу сам. `AVITO` в очередь выкупа не входит вовсе.
 */
export const BUYOUT_LANE_SQL = `
  CASE
    WHEN "orderSource" = 'WB_DBS' THEN 'WB_DBS'
    WHEN "isDirectOrder" = true THEN 'DIRECT'
    ELSE 'WB'
  END
`;

export function buildTabWhere(tab: FilterTab): Prisma.WbOrderWhereInput {
  const cutoff = new Date(Date.now() - NEW_CUTOFF_HOURS * 3600_000);
  switch (tab) {
    case "WORK":
      return {
        isFavorite: false,
        ...NOT_HELD,
        OR: [
          { status: "ERROR" },
          { status: { in: ["PENDING", "IN_PROGRESS"] }, ...PAID_BUYOUT_SCOPE, orderSource: { not: "AVITO" } },
          { status: "AWAITING_GAMEPASS", createdAt: { lte: cutoff } },
        ],
      };
    case "ALL":
      return {};
    case "BUYOUT":
      return {
        ...PAID_BUYOUT_SCOPE,
        ...NOT_HELD,
        orderSource: { not: "AVITO" },
        isFavorite: false,
        OR: [
          { status: { in: ["PENDING", "IN_PROGRESS"] } },
          { status: "ERROR", buyoutErrorCode: { in: [BUYOUT_ERROR_REGIONAL_PRICE, BUYOUT_ERROR_ROBLOX_PLUS_FLOW] } },
        ],
      };
    case "DIRECT":
      return { isDirectOrder: true, status: { in: ["PENDING", "IN_PROGRESS", "AWAITING_PAYMENT", "PAYMENT_PENDING", "ERROR"] }, isFavorite: false, ...NOT_HELD };
    case "AVITO":
      return { orderSource: "AVITO", status: { in: ["PENDING", "IN_PROGRESS", "AWAITING_GAMEPASS", "ERROR"] }, isFavorite: false, ...NOT_HELD };
    case "NEW":
      return { status: "AWAITING_GAMEPASS", createdAt: { gt: cutoff }, isFavorite: false, ...NOT_HELD };
    case "ERROR":
      return { status: "ERROR", isFavorite: false, ...NOT_HELD };
    case "AWAITING_LINK":
      return { status: "AWAITING_GAMEPASS", createdAt: { lte: cutoff }, isFavorite: false, ...NOT_HELD };
    // Подмножество «Ждут ссылку», а не отдельная сущность: те же заказы, по
    // которым бот уже отмолчал все три напоминания.
    case "STALE_LINK":
      return {
        status: "AWAITING_GAMEPASS",
        createdAt: { lte: new Date(Date.now() - STALE_LINK_DAYS * 24 * 3600_000) },
        isFavorite: false,
        ...NOT_HELD,
      };
    case "DONE":
      return { status: "COMPLETED" };
    case "REJECTED":
      return { status: "REJECTED" };
    case "FAVORITES":
      return { isFavorite: true };
    // Единственная вкладка, где замороженные ЕСТЬ и где они одни.
    case "HELD":
      return { heldAt: { not: null } };
    case "ATTENTION": {
      const buyoutOverdue = new Date(Date.now() - ATTENTION_BUYOUT_HOURS * 3600_000);
      const linkOverdue = new Date(Date.now() - ATTENTION_LINK_DAYS * 24 * 3600_000);
      return {
        isFavorite: false,
        ...NOT_HELD,
        OR: [
          { status: "ERROR" },
          { status: { in: ["PENDING", "IN_PROGRESS"] }, ...PAID_BUYOUT_SCOPE, orderSource: { not: "AVITO" }, pendingAt: { lte: buyoutOverdue } },
          { isDirectOrder: true, status: { in: ["AWAITING_PAYMENT", "PAYMENT_PENDING"] } },
          { status: "AWAITING_GAMEPASS", createdAt: { lte: linkOverdue } },
        ],
      };
    }
    default:
      return {};
  }
}

/* ── Ручной приоритет ────────────────────────────────────────────────────────
   «Этот выкупать первым» — исключение из сортировки по возрасту, поднятое
   руками. Правило живёт здесь одной строкой, потому что очередь читают четыре
   разных места (лента TWA, лента сайта, выгрузка ID закупщику, автовыкуп в
   боте), и разъехавшийся приоритет означал бы, что поднятый заказ виден
   наверху на телефоне и не виден в выгрузке.

   `nulls: "last"` обязателен и не является украшением: в Postgres у `DESC`
   по умолчанию NULLS FIRST, то есть без него наверх уехали бы РОВНО ВСЕ
   неприоритетные заказы. Зеркало для сырого SQL — `PRIORITY_ORDER_SQL`.
   ────────────────────────────────────────────────────────────────────────── */
export const PRIORITY_ORDER_BY = { priorityAt: { sort: "desc", nulls: "last" } } as const;

/** То же правило для `$queryRaw`: подставляется первым в `ORDER BY`. */
export const PRIORITY_ORDER_SQL = `"priorityAt" DESC NULLS LAST`;

/**
 * Прямой заказ идёт раньше вебешного той же давности.
 *
 * Это не «ещё одна сортировка», а то же правило приоритета, только постоянное:
 * за прямой заказ клиент заплатил деньгами напрямую и ждёт лично, а не через
 * карту WB, которую он купил заранее. В очереди прямых единицы, поэтому цена
 * решения — сдвиг WB-заказов на один-два места, а не перестройка очереди.
 */
export const DIRECT_ORDER_BY = { isDirectOrder: "desc" } as const;
export const DIRECT_ORDER_SQL = `"isDirectOrder" DESC`;

/** Порядок блока «Первым делом» на обеих главных: ⚡ → прямые → возраст. */
export const FIRST_IN_LINE_ORDER_SQL =
  `${PRIORITY_ORDER_SQL}, ${DIRECT_ORDER_SQL}, COALESCE("pendingAt", "createdAt") ASC`;

/** Срезы, где место в списке означает очередь работы, а не историю. */
const PRIORITY_TABS: readonly FilterTab[] = [
  "WORK", "BUYOUT", "DIRECT", "AVITO", "ERROR", "ATTENTION", "AWAITING_LINK", "STALE_LINK",
];

export function orderByForTab(
  tab: FilterTab,
): Prisma.WbOrderOrderByWithRelationInput | Prisma.WbOrderOrderByWithRelationInput[] {
  const base: Prisma.WbOrderOrderByWithRelationInput[] =
    tab === "WORK" ? [{ updatedAt: "desc" }, { createdAt: "desc" }]
    // «К выкупу» — единственная очередь, где прямые обгоняют по определению:
    // это общий список, в котором они иначе тонут среди WB-заказов. Во вкладках
    // «Прямой» и «Авито» ось не нужна (там один тип), в остальных — не про выкуп.
    : tab === "BUYOUT" ? [DIRECT_ORDER_BY as Prisma.WbOrderOrderByWithRelationInput, { pendingAt: "asc" }, { createdAt: "asc" }]
    : tab === "DIRECT" || tab === "AVITO" ? [{ pendingAt: "asc" }, { createdAt: "asc" }]
    : tab === "ERROR" || tab === "AWAITING_LINK" || tab === "STALE_LINK" || tab === "ATTENTION" ? [{ createdAt: "asc" }]
    // Свежая заморозка сверху: её причину чаще всего и уточняют.
    : tab === "HELD" ? [{ heldAt: "desc" }]
    : [{ createdAt: "desc" }];

  // В «Готово», «Отменённых» и «Избранном» приоритет ничего не значит: там
  // не работают, там смотрят историю.
  return PRIORITY_TABS.includes(tab)
    ? [PRIORITY_ORDER_BY as unknown as Prisma.WbOrderOrderByWithRelationInput, ...base]
    : base;
}

/** Заказ поднят наверх очереди руками. */
export const isPrioritized = (order: { priorityAt?: Date | string | null }): boolean =>
  order.priorityAt != null;

/* ── Выгрузка ID геймпассов ──────────────────────────────────────────────────
   Пока выкупаем вручную, закупщику нужен весь список ID сразу, а не копирование
   по одному из карточек. Границы берём из того же `buildTabWhere`, что и лента,
   чтобы «К выкупу» на экране и в выгрузке значили одно и то же.

   Неоплаченные прямые (`isDirectOrder && paidAt == null`) исключены — они и так
   выключены из всех путей выкупа; отдаём их числом, чтобы было видно, почему
   список короче очереди.
   ──────────────────────────────────────────────────────────────────────── */

export const GAMEPASS_EXPORT_TABS = ["BUYOUT", "DIRECT", "AVITO", "WORK", "ERROR", "ATTENTION"] as const;
export type GamepassExportTab = (typeof GAMEPASS_EXPORT_TABS)[number];
export const GAMEPASS_EXPORT_LIMIT = 500;

export const isGamepassExportTab = (value: string): value is GamepassExportTab =>
  (GAMEPASS_EXPORT_TABS as readonly string[]).includes(value);

export interface GamepassExportItem {
  /** Нужен веб-выкупу: покупка адресуется по id заказа, а не по коду. */
  orderId: string;
  wbCode: string;
  gamepassId: string;
  gamepassUrl: string;
  amount: number;
  /** Цена пасса, которую ожидает прайс-гард: `ceil(номинал / 0.7)`. */
  expectedPrice: number;
  status: string;
  orderSource: string;
  robloxUsername: string | null;
  waitingHours: number;
}

export interface GamepassExport {
  tab: GamepassExportTab;
  generatedAt: string;
  total: number;
  totalRobux: number;
  /** Сумма ожидаемых цен пассов — во столько встанет вся выгрузка донору. */
  totalGrossRobux: number;
  skippedUnpaid: number;
  skippedNoGamepass: number;
  truncated: boolean;
  items: GamepassExportItem[];
}

export async function loadGamepassExport(tab: GamepassExportTab): Promise<GamepassExport> {
  const orders = await prisma.wbOrder.findMany({
    where: { isTest: false, ...buildTabWhere(tab) },
    orderBy: orderByForTab(tab),
    take: GAMEPASS_EXPORT_LIMIT,
    select: {
      id: true, wbCode: true, amount: true, status: true, orderSource: true, gamepassUrl: true,
      robloxUsername: true, probableNick: true, isDirectOrder: true, paidAt: true,
      pendingAt: true, createdAt: true,
    },
  });

  let skippedUnpaid = 0;
  let skippedNoGamepass = 0;
  const items: GamepassExportItem[] = [];

  for (const order of orders) {
    if (order.isDirectOrder && !order.paidAt) { skippedUnpaid += 1; continue; }
    const gamepassId = order.gamepassUrl ? parseGamepassId(order.gamepassUrl) : null;
    if (!gamepassId) { skippedNoGamepass += 1; continue; }
    const since = order.pendingAt ?? order.createdAt;
    items.push({
      orderId: order.id,
      wbCode: order.wbCode,
      gamepassId,
      gamepassUrl: order.gamepassUrl ?? "",
      amount: order.amount,
      expectedPrice: expectedGamepassPrice(order.amount),
      status: order.status,
      orderSource: order.orderSource,
      robloxUsername: order.robloxUsername ?? order.probableNick ?? null,
      waitingHours: Math.max(0, Math.round((Date.now() - since.getTime()) / 3600_000)),
    });
  }

  return {
    tab,
    generatedAt: new Date().toISOString(),
    total: items.length,
    totalRobux: items.reduce((sum, item) => sum + item.amount, 0),
    totalGrossRobux: items.reduce((sum, item) => sum + item.expectedPrice, 0),
    skippedUnpaid,
    skippedNoGamepass,
    truncated: orders.length === GAMEPASS_EXPORT_LIMIT,
    items,
  };
}
