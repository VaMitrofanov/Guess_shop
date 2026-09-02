import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { NOT_HELD_SQL } from "@/lib/order-hold";
import { BUYOUT_ERROR_REGIONAL_PRICE, BUYOUT_ERROR_ROBLOX_PLUS_FLOW } from "@/lib/purchase-guard";
import { BUYOUT_LANE_SQL, BUYOUT_QUEUE_SQL, NEW_CUTOFF_HOURS, STALE_LINK_DAYS, type FilterTab } from "@/lib/order-queue";

/* ─────────────────────────────────────────────────────────────────────────────
   Срез = работа, а не статус. Шапка среза отвечает на четыре вопроса подряд:
   сколько денег, откуда очередь, что мешает выкупить прямо сейчас и что горит.

   Числа считаются ЗДЕСЬ, а не в браузере, по одной причине: лента приходит
   страницами по 20, а очередь бывает на 90 заказов. Любая сумма, собранная по
   загруженной странице, врала бы ровно тогда, когда на неё смотрят — при
   длинной очереди. Поэтому агрегаты идут тем же кэшированным запросом, что и
   счётчики вкладок (`cachedCounts` в api/twa/orders), и живут его 30 секунд.

   Границы срезов НЕ переопределяются: предикаты берутся из `order-queue`,
   чтобы «Выкупить 14» в чипе и «14 заказов» в шапке считались одним правилом.

   Рублей здесь нет намеренно (решение владельца, 02.09): курс закупки плавает
   чаще, чем на шапку смотрят, и рублёвая цифра успевала устареть между двумя
   взглядами на один и тот же экран. Деньги названы в робуксах — грязными и
   чистыми, — потому что тратятся и зачисляются именно они.
   ───────────────────────────────────────────────────────────────────────── */

/** Срезы ряда навигации. Всё остальное живёт в шторке фильтров. */
export const SLICE_KEYS = ["BUYOUT", "ERROR", "AWAITING_LINK", "DONE"] as const;
export type SliceKey = (typeof SLICE_KEYS)[number];

export const isSliceKey = (value: string): value is SliceKey =>
  (SLICE_KEYS as readonly string[]).includes(value);

export type LaneId = "WB" | "WB_DBS" | "DIRECT";

export interface SliceLane {
  id: LaneId;
  orders: number;
  /** Грязные робуксы полосы — ширина сегмента считается по ним, а не по заказам. */
  gross: number;
}

export interface SliceAgeBucket {
  id: string;
  label: string;
  count: number;
}

export interface SliceBlockers {
  /** Рег. цена на доноре: выкуп сорвётся, замена по нику не найдена. */
  regional: number;
  /** Заказ разбит на части, куплены не все. */
  splitPartial: number;
  /** Выкупать нечего: ни ссылки на пасс, ни частей. */
  noGamepass: number;
}

export interface OrderSlice {
  key: SliceKey;
  orders: number;
  /** Чистые робуксы — то, что получит клиент (в БД лежит именно это). */
  clean: number;
  /** Грязные робуксы — цена пассов, что спишется с донора. */
  gross: number;
  lanes: SliceLane[];
  blocked: SliceBlockers;
  /** Сколько заказов среза не держит ни одно серверное препятствие. */
  ready: number;
  age: {
    buckets: SliceAgeBucket[];
    oldestAt: string | null;
    oldestCode: string | null;
    /** Заказов старше «тревожного» порога среза (жёлтая и красная корзины). */
    overdue: number;
  };
  nominals: { amount: number; count: number }[];
  /** Заказов с геймпассом — столько реально попадёт в выгрузку ID. */
  exportable: number;
  /** «Дожать»: бот отмолчал все три напоминания — дальше только вручную. */
  silent: number;
  /** «Дожать»: ждут дольше двух недель. */
  stale: number;
  /** «Починить»: разбивка по причинам ошибки. */
  reasons: { id: string; label: string; count: number }[];
}

export interface OrderSlicesPayload {
  slices: Record<SliceKey, OrderSlice>;
  /** Общий на все срезы: выкуплено и пришло в очередь за сегодня (МСК). */
  today: { done: number; doneSum: number; arrived: number };
}

/* ── Корзины возраста ────────────────────────────────────────────────────────
   У каждого среза свой масштаб. В очереди выкупа сутки — это уже плохо; в
   «Дожать» заказ живёт неделями по определению, и те же четыре корзины на
   часах показывали бы один столбик. Пороги названы здесь один раз: по ним же
   строится и гистограмма, и сужение ленты по тапу.
   ────────────────────────────────────────────────────────────────────────── */

interface AgeBucketDef {
  id: string;
  label: string;
  /** Нижняя граница возраста в часах (включительно). */
  fromHours: number;
  /** Верхняя граница в часах; null — без потолка. */
  toHours: number | null;
  /** Корзина считается тревожной — красится и попадает в `overdue`. */
  overdue?: boolean;
}

const BUYOUT_AGE_BUCKETS: AgeBucketDef[] = [
  { id: "b0", label: "< 3 ч",  fromHours: 0,  toHours: 3 },
  { id: "b1", label: "3–12 ч", fromHours: 3,  toHours: 12 },
  { id: "b2", label: "12–24 ч", fromHours: 12, toHours: 24, overdue: true },
  { id: "b3", label: "> сут",  fromHours: 24, toHours: null, overdue: true },
];

const LINK_AGE_BUCKETS: AgeBucketDef[] = [
  { id: "b0", label: "< 3 дн",  fromHours: 0,       toHours: 72 },
  { id: "b1", label: "3–7 дн",  fromHours: 72,      toHours: 168 },
  { id: "b2", label: "7–14 дн", fromHours: 168,     toHours: 336, overdue: true },
  { id: "b3", label: "> 2 нед", fromHours: 336,     toHours: null, overdue: true },
];

export function ageBucketsFor(tab: FilterTab): AgeBucketDef[] {
  return tab === "AWAITING_LINK" || tab === "STALE_LINK" || tab === "NEW"
    ? LINK_AGE_BUCKETS
    : BUYOUT_AGE_BUCKETS;
}

/**
 * По какому полю считается возраст среза.
 *
 * «Дожать» меряется от создания заказа: покупатель не прислал ссылку, и часы
 * идут с момента, когда он получил код. Очередь выкупа — от `pendingAt`: заказ
 * мог пролежать неделю без ссылки, но в очереди он стоит десять минут, и
 * красить его красным за чужое ожидание нечестно.
 */
function ageBasisIsPending(tab: FilterTab): boolean {
  return tab !== "AWAITING_LINK" && tab !== "STALE_LINK" && tab !== "NEW" && tab !== "DONE";
}

/* ── Предикаты срезов для сырого SQL ─────────────────────────────────────── */

const ERROR_SLICE_SQL = `status = 'ERROR' AND ${NOT_HELD_SQL} AND "isFavorite" = false`;
const LINK_SLICE_SQL = `status = 'AWAITING_GAMEPASS' AND ${NOT_HELD_SQL} AND "isFavorite" = false AND "createdAt" <= NOW() - INTERVAL '${NEW_CUTOFF_HOURS} hours'`;

const SLICE_SQL: Record<Exclude<SliceKey, "DONE">, string> = {
  BUYOUT: BUYOUT_QUEUE_SQL,
  ERROR: ERROR_SLICE_SQL,
  AWAITING_LINK: LINK_SLICE_SQL,
};

/** Возраст среза в SQL: то же поле, что и в `ageBasisIsPending`. */
function ageExpr(key: SliceKey): string {
  return ageBasisIsPending(key as FilterTab) ? `COALESCE("pendingAt", "createdAt")` : `"createdAt"`;
}

function bucketSql(key: Exclude<SliceKey, "DONE">, bucket: AgeBucketDef): string {
  const basis = ageExpr(key);
  const lower = `${basis} <= NOW() - INTERVAL '${bucket.fromHours} hours'`;
  const upper = bucket.toHours === null ? null : `${basis} > NOW() - INTERVAL '${bucket.toHours} hours'`;
  return upper ? `${lower} AND ${upper}` : lower;
}

/**
 * Начало сегодняшнего дня по Москве, выраженное в UTC.
 *
 * Колонки Prisma — `timestamp without time zone` и хранят UTC, поэтому границу
 * считаем в JS и сравниваем с ней напрямую: `AT TIME ZONE` в запросе пришлось
 * бы писать дважды (из UTC в МСК и обратно) и один раз в нём ошибиться.
 * Москва с 2014 года без перевода часов, UTC+3 круглый год.
 */
export function moscowDayStartUtc(now: Date = new Date()): Date {
  const shifted = new Date(now.getTime() + 3 * 3600_000);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - 3 * 3600_000);
}

function sqlTimestamp(value: Date): string {
  return `TIMESTAMP '${value.toISOString().slice(0, 19).replace("T", " ")}'`;
}

const ERROR_REASONS: { id: string; label: string; sql: string }[] = [
  { id: "regional", label: "рег. цена на доноре", sql: `"buyoutErrorCode" = '${BUYOUT_ERROR_REGIONAL_PRICE}'` },
  { id: "rbxplus", label: "Roblox+ флоу", sql: `"buyoutErrorCode" = '${BUYOUT_ERROR_ROBLOX_PLUS_FLOW}'` },
  { id: "other", label: "разбирать вручную", sql: `"buyoutErrorCode" IS NULL` },
];

/* ── Сбор ───────────────────────────────────────────────────────────────── */

function num(value: unknown): number {
  return Number(value ?? 0);
}

/** Грязные робуксы: Roblox забирает 30 % с цены пасса. */
function grossOf(clean: number): number {
  return Math.ceil(clean / 0.7);
}

export async function loadOrderSlices(): Promise<OrderSlicesPayload> {
  const dayStart = sqlTimestamp(moscowDayStartUtc());
  const parts: string[] = [];

  for (const key of ["BUYOUT", "ERROR", "AWAITING_LINK"] as const) {
    const where = SLICE_SQL[key];
    parts.push(`COUNT(*) FILTER (WHERE ${where})::int AS "${key}_N"`);
    parts.push(`COALESCE(SUM(amount) FILTER (WHERE ${where}), 0)::int AS "${key}_CLEAN"`);
    parts.push(`COUNT(*) FILTER (WHERE ${where} AND "gamepassUrl" IS NOT NULL)::int AS "${key}_GP"`);
    parts.push(`COUNT(*) FILTER (WHERE ${where} AND "buyoutErrorCode" = '${BUYOUT_ERROR_REGIONAL_PRICE}')::int AS "${key}_REGIONAL"`);
    parts.push(`MIN(${ageExpr(key)}) FILTER (WHERE ${where}) AS "${key}_OLDEST"`);
    parts.push(`(array_agg("wbCode" ORDER BY ${ageExpr(key)} ASC) FILTER (WHERE ${where}))[1] AS "${key}_OLDEST_CODE"`);
    for (const lane of ["WB", "WB_DBS", "DIRECT"] as const) {
      parts.push(`COUNT(*) FILTER (WHERE ${where} AND ${BUYOUT_LANE_SQL} = '${lane}')::int AS "${key}_LANE_${lane}_N"`);
      parts.push(`COALESCE(SUM(amount) FILTER (WHERE ${where} AND ${BUYOUT_LANE_SQL} = '${lane}'), 0)::int AS "${key}_LANE_${lane}_S"`);
    }
    for (const bucket of ageBucketsFor(key as FilterTab)) {
      parts.push(`COUNT(*) FILTER (WHERE ${where} AND ${bucketSql(key, bucket)})::int AS "${key}_AGE_${bucket.id}"`);
    }
  }

  for (const reason of ERROR_REASONS) {
    parts.push(`COUNT(*) FILTER (WHERE ${ERROR_SLICE_SQL} AND ${reason.sql})::int AS "ERR_${reason.id}"`);
  }
  parts.push(`COUNT(*) FILTER (WHERE ${LINK_SLICE_SQL} AND "remindersSent" >= 3)::int AS "LINK_SILENT"`);
  parts.push(`COUNT(*) FILTER (WHERE ${LINK_SLICE_SQL} AND "createdAt" <= NOW() - INTERVAL '${STALE_LINK_DAYS} days')::int AS "LINK_STALE"`);
  parts.push(`COUNT(*) FILTER (WHERE status = 'COMPLETED' AND COALESCE("completedAt", "updatedAt") >= ${dayStart})::int AS "TODAY_DONE"`);
  parts.push(`COALESCE(SUM(amount) FILTER (WHERE status = 'COMPLETED' AND COALESCE("completedAt", "updatedAt") >= ${dayStart}), 0)::int AS "TODAY_DONE_SUM"`);
  parts.push(`COUNT(*) FILTER (WHERE "pendingAt" >= ${dayStart})::int AS "TODAY_IN"`);

  const [rows, splitRows, nominalRows] = await Promise.all([
    (prisma as any).$queryRawUnsafe(`SELECT ${parts.join(",\n")} FROM "WbOrder" WHERE "isTest" = false`) as Promise<any[]>,
    // Разбитые заказы требуют второй таблицы. `EXISTS` вместо джойна — чтобы
    // предикат очереди остался дословно тем же, что и в колонках выше: с
    // джойном его пришлось бы переписать с алиасом и однажды разойтись.
    (prisma as any).$queryRawUnsafe(`
      SELECT COUNT(*)::int AS "n"
      FROM "WbOrder"
      WHERE "isTest" = false AND ${BUYOUT_QUEUE_SQL}
        AND EXISTS (
          SELECT 1 FROM "WbOrderGamepass" g
          WHERE g."orderId" = "WbOrder".id AND g."purchasedAt" IS NULL
        )
    `) as Promise<any[]>,
    (prisma as any).$queryRawUnsafe(`
      SELECT amount::int AS "amount", COUNT(*)::int AS "n"
      FROM "WbOrder"
      WHERE "isTest" = false AND ${BUYOUT_QUEUE_SQL}
      GROUP BY amount ORDER BY amount ASC
    `) as Promise<any[]>,
  ]);

  const r = rows[0] ?? {};
  const splitPartial = num(splitRows?.[0]?.n);

  const buildSlice = (key: Exclude<SliceKey, "DONE">): OrderSlice => {
    const orders = num(r[`${key}_N`]);
    const clean = num(r[`${key}_CLEAN`]);
    const gross = grossOf(clean);
    const withGamepass = num(r[`${key}_GP`]);
    const regional = num(r[`${key}_REGIONAL`]);
    // «Разбит, но не докуплен» — только у очереди выкупа: в остальных срезах
    // части не покупаются, и строка была бы шумом.
    const partial = key === "BUYOUT" ? splitPartial : 0;
    const noGamepass = Math.max(0, orders - withGamepass);
    const buckets = ageBucketsFor(key as FilterTab).map(bucket => ({
      id: bucket.id,
      label: bucket.label,
      count: num(r[`${key}_AGE_${bucket.id}`]),
    }));
    const overdue = ageBucketsFor(key as FilterTab)
      .filter(bucket => bucket.overdue)
      .reduce((sum, bucket) => sum + num(r[`${key}_AGE_${bucket.id}`]), 0);
    const lanes: SliceLane[] = (["WB", "WB_DBS", "DIRECT"] as const).map(lane => ({
      id: lane,
      orders: num(r[`${key}_LANE_${lane}_N`]),
      gross: grossOf(num(r[`${key}_LANE_${lane}_S`])),
    }));

    return {
      key,
      orders,
      clean,
      gross,
      lanes,
      blocked: { regional, splitPartial: partial, noGamepass },
      ready: Math.max(0, orders - regional - partial - noGamepass),
      age: {
        buckets,
        oldestAt: r[`${key}_OLDEST`] ? new Date(r[`${key}_OLDEST`]).toISOString() : null,
        oldestCode: (r[`${key}_OLDEST_CODE`] as string | null) ?? null,
        overdue,
      },
      nominals: key === "BUYOUT"
        ? (nominalRows ?? []).map((row: any) => ({ amount: num(row.amount), count: num(row.n) }))
        : [],
      exportable: withGamepass,
      silent: key === "AWAITING_LINK" ? num(r.LINK_SILENT) : 0,
      stale: key === "AWAITING_LINK" ? num(r.LINK_STALE) : 0,
      reasons: key === "ERROR"
        ? ERROR_REASONS.map(reason => ({ id: reason.id, label: reason.label, count: num(r[`ERR_${reason.id}`]) }))
            .filter(reason => reason.count > 0)
        : [],
    };
  };

  const doneToday = num(r.TODAY_DONE);
  const done: OrderSlice = {
    key: "DONE",
    orders: doneToday,
    clean: num(r.TODAY_DONE_SUM),
    gross: grossOf(num(r.TODAY_DONE_SUM)),
    lanes: [],
    blocked: { regional: 0, splitPartial: 0, noGamepass: 0 },
    ready: 0,
    age: { buckets: [], oldestAt: null, oldestCode: null, overdue: 0 },
    nominals: [],
    exportable: 0,
    silent: 0,
    stale: 0,
    reasons: [],
  };

  return {
    slices: {
      BUYOUT: buildSlice("BUYOUT"),
      ERROR: buildSlice("ERROR"),
      AWAITING_LINK: buildSlice("AWAITING_LINK"),
      DONE: done,
    },
    today: { done: doneToday, doneSum: num(r.TODAY_DONE_SUM), arrived: num(r.TODAY_IN) },
  };
}

/* ── Сужение ленты по строке шапки ───────────────────────────────────────────
   Каждая строка шапки кликабельна и оставляет в ленте ровно те заказы, из
   которых она сложена. Условия строятся ЗДЕСЬ, а не фильтрацией загруженной
   страницы: лента приходит по 20 заказов, и «оставить в ленте» по странице
   означало бы «оставить в первых двадцати».
   ────────────────────────────────────────────────────────────────────────── */

export interface OrderNarrow {
  lane?: LaneId | null;
  age?: string | null;
  amount?: number | null;
  blocked?: "regional" | "split" | "nogp" | null;
}

const LANE_WHERE: Record<LaneId, Prisma.WbOrderWhereInput> = {
  WB_DBS: { orderSource: "WB_DBS" },
  DIRECT: { isDirectOrder: true },
  WB: { orderSource: { not: "WB_DBS" }, isDirectOrder: false },
};

export function parseNarrow(params: URLSearchParams): OrderNarrow {
  const lane = params.get("lane");
  const amountRaw = params.get("amount");
  const amount = amountRaw ? Number(amountRaw) : NaN;
  const blocked = params.get("blocked");
  return {
    lane: lane === "WB" || lane === "WB_DBS" || lane === "DIRECT" ? lane : null,
    age: params.get("age"),
    amount: Number.isFinite(amount) && amount > 0 ? amount : null,
    blocked: blocked === "regional" || blocked === "split" || blocked === "nogp" ? blocked : null,
  };
}

export function isNarrowed(narrow: OrderNarrow): boolean {
  return !!(narrow.lane || narrow.age || narrow.amount || narrow.blocked);
}

export function buildNarrowWhere(tab: FilterTab, narrow: OrderNarrow): Prisma.WbOrderWhereInput {
  const and: Prisma.WbOrderWhereInput[] = [];

  if (narrow.lane) and.push(LANE_WHERE[narrow.lane]);
  if (narrow.amount) and.push({ amount: narrow.amount });

  if (narrow.age) {
    const bucket = ageBucketsFor(tab).find(b => b.id === narrow.age);
    if (bucket) {
      const now = Date.now();
      const from = bucket.toHours === null ? null : new Date(now - bucket.toHours * 3600_000);
      const to = new Date(now - bucket.fromHours * 3600_000);
      const range = { ...(from ? { gt: from } : {}), lte: to };
      // Prisma не умеет COALESCE, поэтому «pendingAt, а если пусто — createdAt»
      // раскрывается в две ветки. Для «Дожать» базис один — createdAt.
      and.push(ageBasisIsPending(tab)
        ? { OR: [{ pendingAt: range }, { pendingAt: null, createdAt: range }] }
        : { createdAt: range });
    }
  }

  if (narrow.blocked === "regional") and.push({ buyoutErrorCode: BUYOUT_ERROR_REGIONAL_PRICE });
  if (narrow.blocked === "split") and.push({ splitGamepasses: { some: { purchasedAt: null } } });
  if (narrow.blocked === "nogp") and.push({ gamepassUrl: null, splitGamepasses: { none: {} } });

  return and.length === 0 ? {} : { AND: and };
}
