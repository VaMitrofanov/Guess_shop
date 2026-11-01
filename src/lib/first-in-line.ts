import "server-only";

import { prisma } from "@/lib/prisma";
import { BUYOUT_LANE_SQL, BUYOUT_QUEUE_SQL, FIRST_IN_LINE_ORDER_SQL } from "@/lib/order-queue";
import type { FirstInLine, FirstInLineOrder } from "@/types/first-in-line";
import { rebuyWasFromNote } from "@/lib/first-in-line-view";

/* ─────────────────────────────────────────────────────────────────────────────
   «Первым делом» — короткий список заказов, которые выкупаются вне общей
   очереди. Один источник на обе главные: и «Обзор» сайта, и Главная TWA.

   Сюда попадают ровно два случая, и оба — не про возраст:

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

/** Больше шести строк — это уже лента заказов, а не «первым делом». */
export const FIRST_IN_LINE_LIMIT = 6;

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

export async function loadFirstInLine(limit: number = FIRST_IN_LINE_LIMIT): Promise<FirstInLine> {
  // 🔁 Перевыкуп входит сам, даже если ⚡ с него потом сняли: этот заказ уже
  // раз закрыли, и в общей очереди ему теряться нельзя.
  const scope = `"isTest" = false AND ${BUYOUT_QUEUE_SQL} AND ("rebuyAt" IS NOT NULL OR "priorityAt" IS NOT NULL OR "isDirectOrder" = true)`;

  const [rows, totals, queue] = await Promise.all([
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
             "priorityAt",
             "priorityBy",
             "rebuyAt",
             "rebuyReason",
             "adminNote"
        FROM "WbOrder"
       WHERE ${scope}
       ORDER BY ${FIRST_IN_LINE_ORDER_SQL}
       LIMIT ${Math.max(1, Math.trunc(limit))}
    `),
    prisma.$queryRawUnsafe<Array<{ total: number; pinned: number; direct: number; rebuy: number; gross: number }>>(`
      SELECT COUNT(*)::int AS "total",
             COUNT(*) FILTER (WHERE "rebuyAt" IS NOT NULL)::int AS "rebuy",
             -- Группы не пересекаются, как и в блоке: 🔁 → ⚡ → прямой.
             COUNT(*) FILTER (WHERE "rebuyAt" IS NULL AND "priorityAt" IS NOT NULL)::int AS "pinned",
             COUNT(*) FILTER (WHERE "rebuyAt" IS NULL AND "priorityAt" IS NULL AND "isDirectOrder" = true)::int AS "direct",
             -- Грязные считаются по каждому заказу, а не от общей суммы:
             -- округление ceil(amount / 0.7) у каждого своё.
             COALESCE(SUM(CEIL("amount" / 0.7)), 0)::int AS "gross"
        FROM "WbOrder"
       WHERE ${scope}
    `),
    prisma.$queryRawUnsafe<Array<{ n: number }>>(`
      SELECT COUNT(*)::int AS "n" FROM "WbOrder" WHERE "isTest" = false AND ${BUYOUT_QUEUE_SQL}
    `),
  ]);

  // Части разбитых заказов — отдельным запросом и только НЕвыкупленные: в буфер
  // донору должно попасть то, что ещё покупать, а не история заказа.
  const parts = rows.length > 0
    ? await prisma.wbOrderGamepass.findMany({
        where: { orderId: { in: rows.map((row) => row.id) }, purchasedAt: null },
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

  const summary = totals[0] ?? { total: 0, pinned: 0, direct: 0, rebuy: 0, gross: 0 };
  return {
    rows: rows.map((row) => ({
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
      // 🔁 важнее ⚡, ⚡ важнее полосы: поднятый руками прямой — всё-таки поднятый.
      reason: row.rebuyAt ? "rebuy" : row.priorityAt ? "pinned" : "direct",
      rebuyReason: row.rebuyAt ? row.rebuyReason : null,
      rebuyWas: row.rebuyAt ? rebuyWasFromNote(row.adminNote) : null,
      priorityBy: row.priorityAt ? row.priorityBy : null,
      priorityAt: row.priorityAt ? row.priorityAt.toISOString() : null,
    })),
    total: Number(summary.total ?? 0),
    pinned: Number(summary.pinned ?? 0),
    direct: Number(summary.direct ?? 0),
    rebuy: Number(summary.rebuy ?? 0),
    queueTotal: Number(queue[0]?.n ?? 0),
    gross: Number(summary.gross ?? 0),
  };
}
