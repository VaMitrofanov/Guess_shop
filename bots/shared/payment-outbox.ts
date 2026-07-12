import { db } from "./db";
import { tgSend, vkSend, stripHtml } from "./notify";

type TelegramSender = {
  telegram: { sendMessage(chatId: string, text: string, extra: { parse_mode: "HTML" }): Promise<unknown> };
};

const MAX_ATTEMPTS = 8;
const LEASE_MS = 5 * 60_000;
const POLL_MS = 15_000;

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

async function dispatch(message: any, bot: TelegramSender) {
  const orderId = String(message.payload?.orderId ?? "");
  if (!orderId) throw new Error("outbox payload has no orderId");

  const order = await (db as any).wbOrder.findUnique({
    where: { id: orderId },
    include: {
      user: { select: { tgId: true, vkId: true, name: true } },
      paymentAttempts: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!order) throw new Error("outbox order not found");
  const payment = order.paymentAttempts[0];
  const adminIds = (process.env.ADMIN_IDS ?? process.env.TG_CHAT_ID ?? "")
    .split(",").map((id) => id.trim()).filter(Boolean);
  if (adminIds.length === 0) throw new Error("ADMIN_IDS/TG_CHAT_ID is not configured");

  let adminText: string;
  if (message.topic === "payment.confirmed") {
    adminText =
      `💳 <b>ОПЛАТА С САЙТА ПОДТВЕРЖДЕНА</b>\n` +
      `Заказ: <code>${escapeHtml(order.publicOrderId ?? order.wbCode)}</code>\n` +
      `Сумма: <b>${((payment?.amountKopecks ?? 0) / 100).toFixed(2)} ₽</b>\n` +
      `Robux: <b>${order.amount} R$</b>\n` +
      `Статус: ожидает выкупа`;
    await notifyCustomer(order.user, "✅ <b>Оплата подтверждена.</b> Заказ появился в работе — статус можно смотреть в личном кабинете.", bot);
  } else if (message.topic === "payment.refund.recorded") {
    adminText =
      `↩️ <b>ВОЗВРАТ ПОДТВЕРЖДЕН БАНКОМ</b>\n` +
      `Заказ: <code>${escapeHtml(order.publicOrderId ?? order.wbCode)}</code>\n` +
      `Возвращено: <b>${((payment?.refundedAmountKopecks ?? 0) / 100).toFixed(2)} ₽</b>\n` +
      `Статус платежа: <b>${escapeHtml(payment?.status ?? "—")}</b>`;
    await notifyCustomer(order.user, "↩️ <b>Возврат подтверждён банком.</b> Срок зачисления зависит от банка вашей карты.", bot);
  } else {
    throw new Error(`unsupported outbox topic: ${message.topic}`);
  }

  const results = await Promise.all(adminIds.map((id) => tgSend(id, adminText)));
  if (!results.some((result: any) => result?.ok === true || result?.result)) {
    throw new Error("admin notification was not accepted by Telegram");
  }
}

async function claimOne() {
  const now = new Date();
  const candidate = await (db as any).outboxMessage.findFirst({
    where: { status: "PENDING", nextAttemptAt: { lte: now } },
    orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }],
  });
  if (!candidate) return null;
  const claimed = await (db as any).outboxMessage.updateMany({
    where: { id: candidate.id, status: "PENDING", nextAttemptAt: { lte: now } },
    data: { status: "PROCESSING", lockedAt: now, attempts: { increment: 1 }, lastError: null },
  });
  if (claimed.count !== 1) return null;
  return (db as any).outboxMessage.findUnique({ where: { id: candidate.id } });
}

async function processBatch(bot: TelegramSender) {
  await (db as any).outboxMessage.updateMany({
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
      await (db as any).outboxMessage.updateMany({
        where: { id: message.id, status: "PROCESSING" },
        data: { status: "DELIVERED", deliveredAt: new Date(), lockedAt: null, lastError: null },
      });
    } catch (error) {
      const dead = message.attempts >= MAX_ATTEMPTS;
      const lastError = String(error instanceof Error ? error.message : error).slice(0, 500);
      await (db as any).outboxMessage.updateMany({
        where: { id: message.id, status: "PROCESSING" },
        data: {
          status: dead ? "DEAD" : "PENDING",
          nextAttemptAt: dead ? new Date() : new Date(Date.now() + backoffMs(message.attempts)),
          lockedAt: null,
          lastError,
        },
      });
      if (dead) {
        await Promise.allSettled((process.env.ADMIN_IDS ?? process.env.TG_CHAT_ID ?? "").split(",").filter(Boolean)
          .map((id) => tgSend(id.trim(), `🚨 <b>OUTBOX DEAD-LETTER</b>\nID: <code>${message.id}</code>\n${escapeHtml(lastError)}`)));
      }
    }
  }
}

export function startPaymentOutboxWorker(bot: TelegramSender) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await processBatch(bot); }
    catch (error) { console.error("[PaymentOutbox] worker error", error); }
    finally { running = false; }
  };
  setTimeout(tick, 5_000);
  setInterval(tick, POLL_MS);
  console.log("[PaymentOutbox] Worker started ✅");
}
