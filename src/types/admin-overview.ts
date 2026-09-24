import type { FirstInLine } from "@/types/first-in-line";
import type { OrderSlicesPayload } from "@/lib/order-slices";
import type { WbDeliveryQueueSnapshot } from "@/types/wb-delivery";

/* ─────────────────────────────────────────────────────────────────────────────
   Вид ответа «Обзора». Лежит отдельно от `lib/admin-overview.ts`, потому что
   тот помечен `server-only`: клиентскому экрану нужен только тип, а не сборщик
   с Prisma внутри.
   ───────────────────────────────────────────────────────────────────────── */

export interface OverviewQueueOrder {
  id: string;
  wbCode: string;
  robloxUsername: string | null;
  amount: number;
  /** Грязные робуксы: столько спишется с выкупного аккаунта. */
  gross: number;
  lane: "WB" | "WB_DBS" | "DIRECT";
  status: string;
  /** С какого момента заказ стоит в очереди (`pendingAt`, иначе создание). */
  since: string;
  gamepassId: string | null;
  gamepassUrl: string | null;
  /** Части разбитого заказа: сколько всего и сколько уже выкуплено. */
  splitTotal: number;
  splitDone: number;
  /** Поднят руками наверх очереди («выкупать первым»). */
  priority: boolean;
}

export interface OverviewDiff {
  since: string;
  arrived: number;
  arrivedDbs: number;
  arrivedDirect: number;
  done: number;
  doneClean: number;
  /** Грязные робуксы, списанные с выкупных аккаунтов за окно. */
  doneGross: number;
  /** Коды выкупленных — пачка называется поимённо, а не числом. */
  doneCodes: string[];
  /** Когда пачка выкупа началась и кончилась. */
  doneFirstAt: string | null;
  doneLastAt: string | null;
  queued: number;
  queuedCodes: string[];
  errors: number;
  rejected: number;
  wbCancelled: number;
  paymentsConfirmed: number;
  paymentsRubles: number;
  funnelEvents: number;
  funnelNicks: number;
  funnelPasses: number;
  /** Очередь выкупа: сколько было на начало окна и сколько стало.
   *  Единственное число, которое отвечает «полегчало или нет». */
  queueNow: number;
  queueBefore: number;
}

/** Кто сделал ход — из этого складывается смысл строки ленты. */
export type OverviewFeedActor = "us" | "buyer" | "bot" | "wb";

export interface OverviewFeedRow {
  id: string;
  at: string;
  actor: OverviewFeedActor;
  /** Заголовок строки. */
  text: string;
  /** Пояснение под ним. */
  sub?: string | null;
  /** Код заказа (WB-код, DIR-…, или номер заказа WB для DBS). */
  code?: string | null;
  /** Внутренний заказ — для ссылки в «Заказы». */
  orderId?: string | null;
  /** Свёрнутая пачка одинаковых событий: сколько и какие. */
  group?: { count: number; items: { at: string; code: string }[] } | null;
}

export interface OverviewHealth {
  heartbeats: { service: string; status: string; ageSeconds: number }[];
  outboxPending: number;
  outboxDead: number;
  codes: { denom: number; count: number }[];
  codesTotal: number;
  /** Номиналы, которых осталось меньше порога, — их печатать следующими. */
  codesLow: { denom: number; count: number }[];
  acquiring: string;
  /** Ни одна строка здоровья не требует внимания. */
  calm: boolean;
}

export interface AdminOverview {
  now: string;
  slices: OrderSlicesPayload;
  dbs: WbDeliveryQueueSnapshot | null;
  queue: OverviewQueueOrder[];
  /** Сколько заказов в очереди всего — голова может быть её частью. */
  queueTotal: number;
  /** «Первым делом»: поднятые руками ⚡ и прямые заказы. `null` — запрос упал. */
  firstInLine: FirstInLine | null;
  /** Лента смены: что происходило в окне дифа, по времени. */
  feed: OverviewFeedRow[];
  held: { count: number; codes: string[] };
  diff: OverviewDiff;
  health: OverviewHealth;
  showcase: {
    orders30d: number;
    robux30d: number;
    sources: { source: string; orders: number; robux: number }[];
    users: number;
    users30d: number;
    netKopecks30d: number;
    paidPayments30d: number;
    daily: { date: string; orders: number; robux: number }[];
  };
}
