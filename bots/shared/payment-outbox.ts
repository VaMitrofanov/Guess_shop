import { db } from "./db";
import { tgSend, vkSend, stripHtml } from "./notify";
import { touchPaymentOutboxHeartbeat } from "./worker-heartbeat";

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
      user: { select: { tgId: true, vkId: true, name: true } },
      paymentAttempts: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!order) throw new Error("outbox order not found");
  const payment = order.paymentAttempts[0];
  const adminIds = [...new Set(
    (process.env.ADMIN_IDS ?? process.env.TG_CHAT_ID ?? "")
      .split(",").map((id) => id.trim()).filter(Boolean),
  )];
  if (adminIds.length === 0) throw new Error("ADMIN_IDS/TG_CHAT_ID is not configured");

  let adminText: string;
  if (message.topic === "web.order.created" || message.topic === "bot.order.created") {
    // Заказ создан, деньги ещё не приняты. Клиенту здесь не пишем: он прямо
    // сейчас на странице оплаты, сообщение «заказ создан» только помешает.
    // Пока сообщение лежало в очереди, заказ мог уже оплатиться или отмениться —
    // тогда карточка неактуальна, и доставлять её не нужно (но и падать нельзя).
    if (!AWAITING_PAYMENT_STATUSES.has(order.status)) return;
    const kopecks = order.paymentAmountKopecks ?? payment?.amountKopecks ?? 0;
    adminText =
      `🆕 <b>${message.topic === "bot.order.created" ? "ЗАКАЗ ИЗ БОТА СОЗДАН" : "ЗАКАЗ С САЙТА СОЗДАН"}</b>\n` +
      `Заказ: <code>${escapeHtml(order.publicOrderId ?? order.wbCode)}</code>\n` +
      `Сумма: <b>${(kopecks / 100).toFixed(2)} ₽</b> · <b>${order.amount} R$</b>\n` +
      `Ник: ${escapeHtml(order.robloxUsername ?? "—")}\n` +
      `Статус: ожидает оплаты`;
  } else if (message.topic === "payment.confirmed") {
    const needsReconciliation = payloadFlag(message.payload, "needsReconciliation") || order.status === "ERROR";
    const paymentOrigin = payment?.provider === "MANUAL_TRANSFER"
      ? "РУЧНОГО ПЕРЕВОДА"
      : order.orderSource === "DIRECT" ? "БОТА" : "САЙТА";
    adminText = needsReconciliation
      ? `🚨 <b>ОПЛАТА ПОДТВЕРЖДЕНА — НУЖНА СВЕРКА ЛЬГОТ</b>\n` +
        `Заказ: <code>${escapeHtml(order.publicOrderId ?? order.wbCode)}</code>\n` +
        `Сумма: <b>${((payment?.amountKopecks ?? 0) / 100).toFixed(2)} ₽</b>\n` +
        `Robux: <b>${order.amount} R$</b>\n` +
        `Статус: ERROR, не выкупать до ручной сверки`
      : `💳 <b>ОПЛАТА ИЗ ${paymentOrigin} ПОДТВЕРЖДЕНА</b>\n` +
        `Заказ: <code>${escapeHtml(order.publicOrderId ?? order.wbCode)}</code>\n` +
        `Сумма: <b>${((payment?.amountKopecks ?? 0) / 100).toFixed(2)} ₽</b>\n` +
        `Robux: <b>${order.amount} R$</b>\n` +
        `Статус: ожидает выкупа`;
    await notifyCustomer(
      order.user,
      needsReconciliation
        ? "✅ <b>Оплата подтверждена.</b> Мы вручную сверяем детали заказа; поддержка сообщит, когда он перейдёт в работу."
        : "✅ <b>Оплата подтверждена.</b> Заказ появился в работе — статус можно смотреть в личном кабинете.",
      bot,
    );
  } else if (message.topic === "payment.refund.recorded") {
    adminText =
      `↩️ <b>ВОЗВРАТ ПОДТВЕРЖДЕН БАНКОМ</b>\n` +
      `Заказ: <code>${escapeHtml(order.publicOrderId ?? order.wbCode)}</code>\n` +
      `Возвращено: <b>${((payment?.refundedAmountKopecks ?? 0) / 100).toFixed(2)} ₽</b>\n` +
      `Статус платежа: <b>${escapeHtml(payment?.status ?? "—")}</b>`;
    await notifyCustomer(order.user, "↩️ <b>Возврат подтверждён банком.</b> Срок зачисления зависит от банка вашей карты.", bot);
  } else {
    throw new UnsupportedTopicError(String(message.topic));
  }

  const results = await Promise.all(adminIds.map((id) => tgSend(id, adminText)));
  if (!results.some((result) => result.ok === true || Boolean(result.result))) {
    throw new Error("admin notification was not accepted by Telegram");
  }
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
