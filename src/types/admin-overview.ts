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
}

export interface OverviewDiff {
  since: string;
  arrived: number;
  arrivedDbs: number;
  arrivedDirect: number;
  done: number;
  doneClean: number;
  queued: number;
  queuedCodes: string[];
  errors: number;
  rejected: number;
  wbCancelled: number;
  paymentsConfirmed: number;
  paymentsRubles: number;
  funnelEvents: number;
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
