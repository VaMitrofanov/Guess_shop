import "server-only";

import { prisma } from "@/lib/prisma";
import { BUYOUT_LANE_SQL, BUYOUT_QUEUE_SQL, FIRST_IN_LINE_ORDER_SQL } from "@/lib/order-queue";
import type { FirstInLine, FirstInLineOrder } from "@/types/first-in-line";
import { rebuyWasFromNote } from "@/lib/first-in-line-view";
import {
  BUYER_RUSH_WINDOW_HOURS, contactQuote, loadBuyerContacts, recentContactExistsSql, summarizeRush, type BuyerRush,
} from "../../bots/shared/buyer-contact";
import { problemHoldReason } from "../../bots/shared/order-hold";

/* ─────────────────────────────────────────────────────────────────────────────
   «Первым делом» — короткий список заказов, которые выкупаются вне общей
   очереди. Один источник на обе главные: и «Обзор» сайта, и Главная TWA.

   С 01.11.2026 групп четыре (не пересекаются, порядок = срочность):
   🔁 не дошло → 📣 торопят (писали в поддержку за 48 ч) → ⚡ подняты → 💳 прямые.
   Сверху — 🛑 полоса заказов, где покупатель просит отмену (они заморожены).

   Исходно сюда попадали два случая, и оба — не про возраст:

   1. ⚡ поднятые руками. Кнопка «Вперёд очереди» ставит `priorityAt`, и без
      такого блока проверить её действие можно было бы только пролистав ленту
      заказов: наверху очереди и так стоит самый старый.
   2. Прямые заказы. Клиент заплатил деньгами напрямую и ждёт лично, а не через
      карту WB, поэтому прямой всегда идёт раньше вебешного той же давности.
      В очереди их единицы, и теряться среди сотни WB-заказов они не должны.

   Границы — общий `BUYOUT_QUEUE_SQL`: то, что показано здесь, обязано быть тем
   же заказом, что и во вкладке «Выкупить». Неоплаченные прямые в него не
   входят по определению (`PAID_BUYOUT_SQL`), и это правильно: платить робуксами
   за неоплаченный заказ нельзя даже «в приоритете».
   ───────────────────────────────────────────────────────────────────────── */

/**
 * Сколько строк одной группы грузить. «Все» показывает по три
 * (`FIRST_GROUP_PREVIEW`), фильтр группы — все загруженные; дальше —
 * «Вся очередь». Больше двенадцати — это уже лента заказов.
 */
export const FIRST_IN_LINE_GROUP_CAP = 12;

/** Сколько просьб об отмене показать полосой. */
const STOP_LIMIT = 5;

export type { FirstInLine, FirstInLineOrder } from "@/types/first-in-line";

/**
 * Человеческая часть заметки: всё, кроме машинных строк аудита.
 *
 * Склейка через « · », а не перенос: строка блока одна, и то, что показано,
 * обязано совпадать с тем, что уйдёт в сохранение — иначе правка молча
 * перепишет текст, которого админ не видел.
 */
function humanNote(note: string | null): string | null {
  const human = (note ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("["));
  return human.length > 0 ? human.join(" · ") : null;
}

/** Порядок групп: 🔁 → 📣 → ⚡ → 💳. */
const GROUP_RANK: Record<FirstInLineOrder["reason"], number> = { rebuy: 0, rush: 1, pinned: 2, direct: 3 };

/** Цитата из причины заморозки «Покупатель просит отмену…: «текст»». */
function stopQuote(reason: string | null): string | null {
  const m = (reason ?? "").match(/«(.*)»\s*$/);
  return m ? m[1] : null;
}

export async function loadFirstInLine(): Promise<FirstInLine> {
  // 🔁 Перевыкуп входит сам, даже если ⚡ с него потом сняли: этот заказ уже
  // раз закрыли, и в общей очереди ему теряться нельзя. 📣 — любой заказ
  // очереди, по которому писали за 48 ч; торопят ли, решает классификатор ниже.
  const scope = `"isTest" = false AND ${BUYOUT_QUEUE_SQL}
    AND ("rebuyAt" IS NOT NULL OR "priorityAt" IS NOT NULL OR "isDirectOrder" = true OR ${recentContactExistsSql()})`;

  // Всё параллельно: каждый заход в базу из РФ в Сингапур — ~210 мс.
  const [rows, contacts, queue, stops] = await Promise.all([
    prisma.$queryRawUnsafe<Array<{
      id: string;
      wbCode: string;
      robloxUsername: string | null;
      amount: number;
      lane: FirstInLineOrder["lane"];
      status: string;
      since: Date;
      createdAt: Date;
      gamepassId: string | null;
      isDirectOrder: boolean;
      priorityAt: Date | null;
      priorityBy: string | null;
      rebuyAt: Date | null;
      rebuyReason: string | null;
      adminNote: string | null;
    }>>(`
      SELECT "id", "wbCode", "robloxUsername", "amount",
             ${BUYOUT_LANE_SQL} AS "lane",
             "status",
             COALESCE("pendingAt", "createdAt") AS "since",
             "createdAt",
             "gamepassId",
             "isDirectOrder",
             "priorityAt",
             "priorityBy",
             "rebuyAt",
             "rebuyReason",
             "adminNote"
        FROM "WbOrder"
       WHERE ${scope}
       ORDER BY ${FIRST_IN_LINE_ORDER_SQL}
       LIMIT 200
    `),
    loadBuyerContacts(prisma, {
      since: new Date(Date.now() - BUYER_RUSH_WINDOW_HOURS * 3_600_000),
      orderWhereSql: BUYOUT_QUEUE_SQL,
    }).catch(() => []),
    prisma.$queryRawUnsafe<Array<{ n: number }>>(`
      SELECT COUNT(*)::int AS "n" FROM "WbOrder" WHERE "isTest" = false AND ${BUYOUT_QUEUE_SQL}
    `),
    // 🛑 Заморожены автозащитой из-за просьбы покупателя — пока заказ жив.
    prisma.$queryRawUnsafe<Array<{
      id: string; wbCode: string; amount: number; robloxUsername: string | null;
      heldAt: Date; heldReason: string | null; total: number;
    }>>(`
      SELECT "id", "wbCode", "amount", "robloxUsername", "heldAt", "heldReason",
             COUNT(*) OVER ()::int AS "total"
        FROM "WbOrder"
       WHERE "isTest" = false AND "heldAt" IS NOT NULL
         AND "heldReason" LIKE $1
         AND "status" IN ('AWAITING_GAMEPASS','PENDING','IN_PROGRESS','ERROR')
       ORDER BY "heldAt" DESC
       LIMIT ${STOP_LIMIT}
    `, `${problemHoldReason("BUYER_REFUND_REQUEST")}%`),
  ]);

  const rush = summarizeRush(contacts);

  // Группа каждой строки. Писали, но не «торопят» (спасибо, прислал ник) и
  // других причин нет — строке здесь не место.
  const placed = rows
    .map((row) => {
      const reason: FirstInLineOrder["reason"] | null = row.rebuyAt
        ? "rebuy"
        : rush.has(row.id) ? "rush"
        : row.priorityAt ? "pinned"
        : row.isDirectOrder ? "direct"
        : null;
      return reason ? { row, reason } : null;
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  // Внутри группы порядок SQL (он же порядок очереди), кроме «Торопят»: там
  // первым тот, кто писал чаще, при равенстве — кто дольше ждёт.
  const indexed = placed.map((entry, index) => ({ ...entry, index }));
  indexed.sort((a, b) => {
    const g = GROUP_RANK[a.reason] - GROUP_RANK[b.reason];
    if (g !== 0) return g;
    if (a.reason === "rush") {
      const heat = (rush.get(b.row.id)?.count ?? 0) - (rush.get(a.row.id)?.count ?? 0);
      if (heat !== 0) return heat;
      return a.row.since.getTime() - b.row.since.getTime();
    }
    return a.index - b.index;
  });

  const counts = { rebuy: 0, rush: 0, pinned: 0, direct: 0 };
  let gross = 0;
  const shown: typeof indexed = [];
  for (const entry of indexed) {
    counts[entry.reason] += 1;
    // Грязные считаются по каждому заказу: округление ceil(amount / 0.7) у каждого своё.
    gross += Math.ceil(entry.row.amount / 0.7);
    if (counts[entry.reason] <= FIRST_IN_LINE_GROUP_CAP) shown.push(entry);
  }
  const total = counts.rebuy + counts.rush + counts.pinned + counts.direct;
  // Части разбитых заказов — отдельным запросом и только НЕвыкупленные: в буфер
  // донору должно попасть то, что ещё покупать, а не история заказа.
  const parts = shown.length > 0
    ? await prisma.wbOrderGamepass.findMany({
        where: { orderId: { in: shown.map((entry) => entry.row.id) }, purchasedAt: null },
        orderBy: { position: "asc" },
        select: { orderId: true, gamepassId: true },
      })
    : [];
  const partsByOrder = new Map<string, string[]>();
  for (const part of parts) {
    const bucket = partsByOrder.get(part.orderId);
    // Повтор одного пасса НЕ схлопывается: две части на одном пассе — это две
    // покупки с разных доноров, и в списке их должно быть две.
    if (bucket) bucket.push(part.gamepassId);
    else partsByOrder.set(part.orderId, [part.gamepassId]);
  }

  return {
    rows: shown.map(({ row, reason }) => ({
      id: row.id,
      wbCode: row.wbCode,
      robloxUsername: row.robloxUsername,
      amount: row.amount,
      gross: Math.ceil(row.amount / 0.7),
      lane: row.lane,
      status: row.status,
      since: row.since.toISOString(),
      createdAt: row.createdAt.toISOString(),
      gamepassId: row.gamepassId,
      // Легаси-поле заказа указывает на ТЕКУЩУЮ часть, поэтому оно же и
      // единственный ID у неразбитого заказа.
      gamepassIds: partsByOrder.get(row.id) ?? (row.gamepassId ? [row.gamepassId] : []),
      // Машинные строки аудита начинаются с `[МЕТКА]` — на дашборде нужна
      // только та часть, которую писал человек.
      note: humanNote(row.adminNote),
      // 🔁 → 📣 → ⚡ → полоса: поднятый руками прямой — всё-таки поднятый.
      reason,
      rush: rushView(rush.get(row.id)),
      rebuyReason: row.rebuyAt ? row.rebuyReason : null,
      rebuyWas: row.rebuyAt ? rebuyWasFromNote(row.adminNote) : null,
      priorityBy: row.priorityAt ? row.priorityBy : null,
      priorityAt: row.priorityAt ? row.priorityAt.toISOString() : null,
    })),
    total,
    pinned: counts.pinned,
    direct: counts.direct,
    rebuy: counts.rebuy,
    rush: counts.rush,
    stops: stops.map((stop) => ({
      id: stop.id,
      wbCode: stop.wbCode,
      amount: stop.amount,
      robloxUsername: stop.robloxUsername,
      heldAt: stop.heldAt.toISOString(),
      quote: stopQuote(stop.heldReason),
    })),
    stopTotal: Number(stops[0]?.total ?? 0),
    queueTotal: Number(queue[0]?.n ?? 0),
    gross,
  };
}

function rushView(r: BuyerRush | undefined): FirstInLineOrder["rush"] {
  if (!r) return null;
  return { count: r.count, channels: r.channels, lastAt: r.lastAt.toISOString(), quote: contactQuote(r.lastText), via: r.lastVia };
}
