import "server-only";

import { prisma } from "@/lib/prisma";
import { wbAuditLabel } from "@/lib/wb-delivery-labels";
import { ORDER_STATUS_EVENT } from "@/lib/order-status-event";
import type { OverviewFeedRow } from "@/types/admin-overview";

/* ─────────────────────────────────────────────────────────────────────────────
   Лента смены — «когда» в дополнение к «сколько» (решение О4 от 03.09.2026).

   Сводка «Пока вас не было» отвечала числами: 10 выкуплено, 4 пришло. Числа не
   говорят ни времени, ни порядка: десять выкупов пачкой за 42 минуты и десять
   выкупов, размазанных по ночи, — это одна и та же строка «10», а решают по
   ней разное.

   Три правила, без которых лента превращается в шум:

   1. **Это не Журнал.** `/admin/activity` показывает `Событие заказа ·
      AUDIT_NICK_ENTERED` — сырой тип для разбора инцидента. Здесь строки на
      человеческом: «покупатель прислал геймпасс». Наборы источников тоже
      разные: сюда не идут outbox и merge-аудит.
   2. **Пачка — одна строка.** Десять подряд отмеченных выкупов сворачиваются
      в «10 заказов выкуплено» с диапазоном времени: разворачивается по тапу.
   3. **Шум отфильтрован.** `ORDER_SYNCED` — пульс воркера (133 записи за
      неделю), а не событие заказа. Наши собственные сообщения в чат WB — тоже
      не событие: их шлёт наш же бот по шаблону.

   Стоимость: пять запросов по индексированным датам, каждый с потолком. За
   типовые 13 часов во всех таблицах вместе набирается около 80 строк.
   ───────────────────────────────────────────────────────────────────────── */

/** Потолок на источник: длинная ночь не должна превращаться в тысячу строк. */
const PER_SOURCE = 60;

/** Сколько строк отдаём экрану после сборки и свёртки. */
const FEED_LIMIT = 40;

/** С какого числа одинаковых подряд событий пачка сворачивается в одну строку. */
const GROUP_FROM = 3;

/** Человеческие названия для типов `OrderEvent`, которые видит смена. */
const ORDER_EVENT_TEXT: Record<string, string> = {
  AUDIT_NICK_ENTERED: "покупатель назвал ник Roblox",
  AUDIT_GAMEPASS_SUBMITTED: "покупатель прислал геймпасс",
  PAYMENT_CONFIRMED: "оплата подтверждена",
  PAYMENT_AUTHORIZED: "оплата авторизована",
  PAYMENT_INITIATED: "оплата начата",
  PAYMENT_CANCELED: "оплата отменена",
  MANUAL_PAYMENT_CONFIRMED: "оплата подтверждена вручную",
  WEB_ORDER_CREATED: "заказ создан на сайте",
  BOT_ORDER_CREATED: "заказ создан в боте",
  REVIEW_BONUS_GRANTED: "начислен бонус за отзыв",
  GAMEPASS_ATTACHED: "геймпасс привязан",
};

/** Статусы заказа словами — для строк `ORDER_STATUS_CHANGED`. */
const STATUS_TEXT: Record<string, string> = {
  PENDING: "вернулся в очередь выкупа",
  IN_PROGRESS: "пошёл в выкуп",
  COMPLETED: "выкуплен",
  REJECTED: "отменён",
  ERROR: "ушёл в ошибку выкупа",
  AWAITING_GAMEPASS: "ждёт ссылку на геймпасс",
};

/** События DBS, которые смене ничего не говорят. */
const DBS_SKIP = new Set(["ORDER_SYNCED", "CHAT_MIRROR_FAILED"]);

function actorOfDbs(type: string): OverviewFeedRow["actor"] {
  if (type.startsWith("WB_")) return "wb";
  if (type.startsWith("AUTO_") || type === "GATE_REMINDER_SENT") return "bot";
  if (type === "BUYER_SIGNED_IN" || type === "DELIVERY_CODE_CAPTURED") return "buyer";
  return "us";
}

/**
 * Свернуть подряд идущие одинаковые строки в одну.
 *
 * Считается по соседям, а не по всему окну: два выкупа утром и восемь вечером —
 * это две пачки, и слипание их в «10» стёрло бы ровно то, ради чего лента
 * заводилась.
 */
function collapse(rows: OverviewFeedRow[]): OverviewFeedRow[] {
  const out: OverviewFeedRow[] = [];
  let run: OverviewFeedRow[] = [];

  const flush = () => {
    if (run.length === 0) return;
    if (run.length < GROUP_FROM) { out.push(...run); run = []; return; }
    const first = run[run.length - 1];
    const last = run[0];
    out.push({
      id: `group:${first.id}`,
      at: last.at,
      actor: last.actor,
      text: `${run.length} ${run.length < 5 ? "заказа" : "заказов"} выкуплено`,
      sub: null,
      code: null,
      orderId: null,
      group: {
        count: run.length,
        items: run.map((row) => ({ at: row.at, code: row.code ?? "—" })),
      },
    });
    run = [];
  };

  for (const row of rows) {
    if (row.text === "выкуплен") {
      run.push(row);
      continue;
    }
    flush();
    out.push(row);
  }
  flush();
  return out;
}

export async function loadOverviewFeed(since: Date): Promise<OverviewFeedRow[]> {
  const [completed, created, orderEvents, dbsEvents, buyerChats] = await Promise.all([
    prisma.wbOrder.findMany({
      where: { isTest: false, completedAt: { gte: since } },
      orderBy: { completedAt: "desc" },
      take: PER_SOURCE,
      select: { id: true, wbCode: true, amount: true, completedAt: true, orderSource: true },
    }),
    prisma.wbOrder.findMany({
      where: { isTest: false, createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: PER_SOURCE,
      select: { id: true, wbCode: true, amount: true, createdAt: true, orderSource: true, isDirectOrder: true },
    }),
    prisma.orderEvent.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: PER_SOURCE,
      select: {
        id: true, type: true, createdAt: true, payload: true,
        order: { select: { id: true, wbCode: true, isTest: true } },
      },
    }),
    prisma.wbMarketplaceEvent.findMany({
      where: { createdAt: { gte: since }, type: { notIn: [...DBS_SKIP] } },
      orderBy: { createdAt: "desc" },
      take: PER_SOURCE,
      select: {
        id: true, type: true, createdAt: true,
        marketplaceOrder: {
          select: { wbOrderId: true, buyerName: true, isTest: true, wbCode: { select: { code: true } } },
        },
      },
    }),
    // Только сообщения ПОКУПАТЕЛЯ: наши уходят по шаблону из бота, и «мы
    // написали» смене ничего не сообщает.
    prisma.wbBuyerChatEvent.findMany({
      where: { sentAt: { gte: since }, sender: { in: ["client", "buyer"] } },
      orderBy: { sentAt: "desc" },
      take: PER_SOURCE,
      select: {
        id: true, sentAt: true,
        marketplaceOrder: {
          select: { wbOrderId: true, buyerName: true, isTest: true, wbCode: { select: { code: true } } },
        },
      },
    }),
  ]);

  const rows: OverviewFeedRow[] = [];

  for (const order of completed) {
    rows.push({
      id: `done:${order.id}`,
      at: order.completedAt!.toISOString(),
      actor: "us",
      text: "выкуплен",
      sub: `${order.amount.toLocaleString("ru-RU")} R$ клиенту`,
      code: order.wbCode,
      orderId: order.id,
    });
  }

  for (const order of created) {
    rows.push({
      id: `new:${order.id}`,
      at: order.createdAt.toISOString(),
      actor: "buyer",
      text: order.isDirectOrder ? "прямой заказ создан" : "заказ создан",
      sub: `${order.amount.toLocaleString("ru-RU")} R$ · ${order.orderSource}`,
      code: order.wbCode,
      orderId: order.id,
    });
  }

  for (const event of orderEvents) {
    if (event.order?.isTest) continue;
    if (event.type === ORDER_STATUS_EVENT) {
      const payload = (event.payload ?? {}) as { to?: string; reason?: string; actor?: string };
      const to = String(payload.to ?? "");
      // «Выкуплен» уже пришёл из `completedAt` — иначе строка задвоится.
      if (to === "COMPLETED") continue;
      rows.push({
        id: `status:${event.id}`,
        at: event.createdAt.toISOString(),
        actor: "us",
        text: STATUS_TEXT[to] ?? `статус → ${to}`,
        sub: payload.reason ?? payload.actor ?? null,
        code: event.order?.wbCode ?? null,
        orderId: event.order?.id ?? null,
      });
      continue;
    }
    const text = ORDER_EVENT_TEXT[event.type];
    if (!text) continue;
    rows.push({
      id: `event:${event.id}`,
      at: event.createdAt.toISOString(),
      actor: event.type.startsWith("AUDIT_") ? "buyer" : "us",
      text,
      code: event.order?.wbCode ?? null,
      orderId: event.order?.id ?? null,
    });
  }

  for (const event of dbsEvents) {
    if (event.marketplaceOrder?.isTest) continue;
    rows.push({
      id: `dbs:${event.id}`,
      at: event.createdAt.toISOString(),
      actor: actorOfDbs(event.type),
      text: wbAuditLabel(event.type),
      sub: event.marketplaceOrder?.buyerName ?? null,
      code: event.marketplaceOrder?.wbCode?.code ?? `WB #${event.marketplaceOrder?.wbOrderId ?? "—"}`,
      orderId: null,
    });
  }

  for (const chat of buyerChats) {
    if (chat.marketplaceOrder?.isTest) continue;
    rows.push({
      id: `chat:${chat.id}`,
      at: chat.sentAt.toISOString(),
      actor: "buyer",
      text: "написал в чат WB",
      sub: chat.marketplaceOrder?.buyerName ?? null,
      code: chat.marketplaceOrder?.wbCode?.code ?? `WB #${chat.marketplaceOrder?.wbOrderId ?? "—"}`,
      orderId: null,
    });
  }

  rows.sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || b.id.localeCompare(a.id));
  return collapse(rows).slice(0, FEED_LIMIT);
}
