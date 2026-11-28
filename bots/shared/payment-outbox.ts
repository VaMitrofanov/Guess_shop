import { db } from "./db";
import { tgSend, vkSend, stripHtml } from "./notify";
import { touchPaymentOutboxHeartbeat } from "./worker-heartbeat";
import { adminTargets } from "./admin-route";
import { sendAdminOrderCard } from "./admin";
import { formatAdminNotice, orderRef } from "./notify-format";
import { countPreviousOrders } from "./order-loyalty";
import { vkDialogLink } from "./vk-links";

type TelegramSender = {
  telegram: { sendMessage(chatId: string, text: string, extra: { parse_mode: "HTML" }): Promise<unknown> };
};

type OutboxMessageLike = {
  id?: string;
  topic: string;
  payload: unknown;
  attempts?: number;
};

function payloadOrderId(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
  const value = (payload as Record<string, unknown>).orderId;
  return typeof value === "string" ? value : "";
}

function payloadFlag(payload: unknown, key: string) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  return (payload as Record<string, unknown>)[key] === true;
}

const MAX_ATTEMPTS = 8;
const LEASE_MS = 5 * 60_000;
const POLL_MS = 15_000;

/**
 * Единственный источник правды о том, какие топики воркер умеет доставлять.
 *
 * Появился после ultra-review 28.07: `createCanonicalWebOrder` клал в очередь
 * `web.order.created`, обработчика не было, и КАЖДЫЙ заказ с сайта уходил в
 * 8 попыток по ~2 часа, а затем в `DEAD` с тревогой админам. На проде так
 * умерли 4 сообщения из 4. Контракт-тест сверяет этот набор с топиками,
 * которые реально эмитит приложение, — молча разойтись они больше не могут.
 */
export const HANDLED_TOPICS = new Set([
  "payment.confirmed",
  "payment.refund.recorded",
  "web.order.created",
  "bot.order.created",
]);

/**
 * Топик, которого воркер не знает. Это всегда дефект деплоя (код приложения
 * ушёл вперёд воркера), а не временный сбой, поэтому повторять бессмысленно:
 * такое сообщение становится `DEAD` с первой же попытки.
 */
export class UnsupportedTopicError extends Error {
  constructor(topic: string) {
    super(`unsupported outbox topic: ${topic}`);
    this.name = "UnsupportedTopicError";
  }
}

/** Заказ ещё не оплачен — карточка «создан, ждём оплату» уместна. */
const AWAITING_PAYMENT_STATUSES = new Set(["AWAITING_PAYMENT", "PAYMENT_PENDING"]);

function backoffMs(attempts: number) {
  return Math.min(60 * 60_000, 30_000 * 2 ** (Math.max(1, attempts) - 1));
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function notifyCustomer(user: { tgId?: string | null; vkId?: string | null }, text: string, bot: TelegramSender) {
  if (user.tgId) {
    await bot.telegram.sendMessage(user.tgId, text, { parse_mode: "HTML" }).catch(() => undefined);
  } else if (user.vkId) {
    await vkSend(user.vkId, stripHtml(text));
  }
}

export async function dispatch(message: OutboxMessageLike, bot: TelegramSender) {
  // Проверяем топик ДО обращения к БД: неизвестный топик не должен выглядеть
  // как «заказ не найден» и тратить попытки.
  if (!HANDLED_TOPICS.has(message.topic)) throw new UnsupportedTopicError(String(message.topic));

  const orderId = payloadOrderId(message.payload);
  if (!orderId) throw new Error("outbox payload has no orderId");

  const order = await db.wbOrder.findUnique({
    where: { id: orderId },
    include: {
      user: { select: { tgId: true, vkId: true, name: true, username: true } },
      paymentAttempts: { orderBy: { createdAt: "desc" }, take: 1 },
      splitGamepasses: { orderBy: { position: "asc" }, select: { gamepassId: true, amount: true } },
    },
  });
  if (!order) throw new Error("outbox order not found");
  const payment = order.paymentAttempts[0];
  const ref = order.publicOrderId ?? order.wbCode;
  const rub = (kopecks: number | null | undefined) => `${((kopecks ?? 0) / 100).toFixed(2)} ₽`;

  /* Всё админам — в тему «Прямые заказы» привычным форматом (21.11.2026).
     До этого воркер слал голый текст «💳 ОПЛАТА ИЗ БОТА ПОДТВЕРЖДЕНА» каждому
     из ADMIN_IDS в личку: в теме не появлялось ничего, а карточки выкупа у
     оплаченного картой заказа не было вовсе (BOT-4B1B86E3…, 1000 R$). */
  const notice = async (text: string, loud: boolean, urgent = false) => {
    const targets = await adminTargets("direct", { loud, urgent });
    if (targets.length === 0) return;
    const results = await Promise.all(targets.map((t) => tgSend(t.chatId, text, { ...t.extra })));
    if (!results.some((result) => result.ok === true || Boolean(result.result))) {
      throw new Error("admin notification was not accepted by Telegram");
    }
  };

  if (message.topic === "web.order.created" || message.topic === "bot.order.created") {
    // Заказ создан, деньги ещё не приняты. Клиенту здесь не пишем: он прямо
    // сейчас на странице оплаты, сообщение «заказ создан» только помешает.
    // Пока сообщение лежало в очереди, заказ мог уже оплатиться или отмениться —
    // тогда карточка неактуальна, и доставлять её не нужно (но и падать нельзя).
    if (!AWAITING_PAYMENT_STATUSES.has(order.status)) return;
    const kopecks = order.paymentAmountKopecks ?? payment?.amountKopecks ?? 0;
    await notice(formatAdminNotice({
      marker: "waiting",
      zone: "ПРЯМОЙ",
      title: message.topic === "bot.order.created" ? "заказ из бота — ждёт оплаты" : "заказ с сайта — ждёт оплаты",
      lines: [
        orderRef({ code: ref, denomination: order.amount }, [escapeHtml(order.robloxUsername ?? "—")]),
        `💰 К оплате: <b>${rub(kopecks)}</b>`,
      ],
    }), false);
    return;
  }

  if (message.topic === "payment.confirmed") {
    const needsReconciliation = payloadFlag(message.payload, "needsReconciliation") || order.status === "ERROR";
    const how = payment?.provider === "MANUAL_TRANSFER" ? "переводом" : "картой";
    const paidLine = `💳 Оплачено ${how}: <b>${rub(payment?.amountKopecks)}</b>`;
    if (needsReconciliation) {
      await notice(formatAdminNotice({
        marker: "urgent",
        zone: "ПРЯМОЙ",
        title: "оплачен — нужна сверка льгот",
        lines: [orderRef({ code: ref, denomination: order.amount }, [escapeHtml(order.robloxUsername ?? "—")]), paidLine],
        next: "статус ERROR — не выкупать до ручной сверки",
      }), true, true);
    } else if (order.gamepassUrl) {
      // Обычная карточка выкупа (как у заказа из ботов и с сайта) + строка оплаты.
      const u = order.user;
      const safeName = escapeHtml(u?.name ?? "Покупатель");
      const userDisplay = u?.username
        ? `@${escapeHtml(u.username)}`
        : u?.vkId ? vkDialogLink(u.vkId, safeName)
        : u?.tgId ? `<a href="tg://user?id=${u.tgId}">${safeName}</a>` : safeName;
      const previousOrderCount = order.userId
        ? await countPreviousOrders(db as never, { userId: order.userId, excludeOrderId: order.id }).catch(() => 0)
        : 0;
      const delivered = await sendAdminOrderCard({
        id: order.id,
        amount: order.amount,
        gamepassUrl: order.gamepassUrl,
        platform: order.platform === "VK" ? "VK" : "TG",
        orderSource: order.orderSource,
        wbCode: order.wbCode,
        userDisplay,
        createdAt: order.createdAt,
        previousOrderCount,
        creatorName: order.robloxUsername ?? undefined,
        splitParts: order.splitGamepasses.length > 1 ? order.splitGamepasses : undefined,
        paidLine,
        title: "оплачен — к выкупу",
      });
      if (delivered === 0) {
        const targets = await adminTargets("direct");
        if (targets.length > 0) throw new Error("buyout card was not accepted by Telegram");
      }
    } else {
      await notice(formatAdminNotice({
        marker: "action",
        zone: "ПРЯМОЙ",
        title: "оплачен — ждём геймпасс",
        lines: [orderRef({ code: ref, denomination: order.amount }, [escapeHtml(order.robloxUsername ?? "—")]), paidLine],
      }), true);
    }
    await notifyCustomer(
      order.user,
      needsReconciliation
        ? "✅ <b>Оплата подтверждена.</b> Мы вручную сверяем детали заказа; поддержка сообщит, когда он перейдёт в работу."
        : "✅ <b>Оплата подтверждена.</b> Заказ появился в работе — статус можно смотреть в личном кабинете.",
      bot,
    );
    return;
  }

  if (message.topic === "payment.refund.recorded") {
    await notice(formatAdminNotice({
      marker: "done",
      zone: "ПРЯМОЙ",
      title: "возврат подтверждён банком",
      lines: [
        orderRef({ code: ref, denomination: order.amount }, [escapeHtml(order.robloxUsername ?? "—")]),
        `↩️ Возвращено: <b>${rub(payment?.refundedAmountKopecks)}</b> · платёж ${escapeHtml(payment?.status ?? "—")}`,
      ],
    }), true);
    await notifyCustomer(order.user, "↩️ <b>Возврат подтверждён банком.</b> Срок зачисления зависит от банка вашей карты.", bot);
    return;
  }

  throw new UnsupportedTopicError(String(message.topic));
}

async function claimOne() {
  const now = new Date();
  const candidate = await db.outboxMessage.findFirst({
    where: { status: "PENDING", nextAttemptAt: { lte: now } },
    orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }],
  });
  if (!candidate) return null;
  const claimed = await db.outboxMessage.updateMany({
    where: { id: candidate.id, status: "PENDING", nextAttemptAt: { lte: now } },
    data: { status: "PROCESSING", lockedAt: now, attempts: { increment: 1 }, lastError: null },
  });
  if (claimed.count !== 1) return null;
  return db.outboxMessage.findUnique({ where: { id: candidate.id } });
}

async function processBatch(bot: TelegramSender) {
  await db.outboxMessage.updateMany({
    where: {
      status: "PROCESSING",
      OR: [{ lockedAt: null }, { lockedAt: { lt: new Date(Date.now() - LEASE_MS) } }],
    },
    data: { status: "PENDING", lockedAt: null, lastError: "worker lease expired" },
  });

  for (let index = 0; index < 10; index += 1) {
    const message = await claimOne();
    if (!message) break;
    try {
      await dispatch(message, bot);
      await db.outboxMessage.updateMany({
        where: { id: message.id, status: "PROCESSING" },
        data: { status: "DELIVERED", deliveredAt: new Date(), lockedAt: null, lastError: null },
      });
    } catch (error) {
      // Неизвестный топик повторять незачем — это рассинхрон кода, а не сбой.
      const dead = error instanceof UnsupportedTopicError || message.attempts >= MAX_ATTEMPTS;
      const lastError = String(error instanceof Error ? error.message : error).slice(0, 500);
      await db.outboxMessage.updateMany({
        where: { id: message.id, status: "PROCESSING" },
        data: {
          status: dead ? "DEAD" : "PENDING",
          nextAttemptAt: dead ? new Date() : new Date(Date.now() + backoffMs(message.attempts)),
          lockedAt: null,
          lastError,
        },
      });
      if (dead) {
        const adminIds = [...new Set(
          (process.env.ADMIN_IDS ?? process.env.TG_CHAT_ID ?? "")
            .split(",").map((id) => id.trim()).filter(Boolean),
        )];
        await Promise.allSettled(adminIds
          .map((id) => tgSend(id, `🚨 <b>OUTBOX DEAD-LETTER</b>\nID: <code>${message.id}</code>\n${escapeHtml(lastError)}`)));
      }
    }
  }
}

export function startPaymentOutboxWorker(bot: TelegramSender) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await touchPaymentOutboxHeartbeat();
      await processBatch(bot);
      await touchPaymentOutboxHeartbeat();
    }
    catch (error) { console.error("[PaymentOutbox] worker error", error); }
    finally { running = false; }
  };
  setTimeout(tick, 5_000);
  setInterval(tick, POLL_MS);
  console.log("[PaymentOutbox] Worker started ✅");
}
