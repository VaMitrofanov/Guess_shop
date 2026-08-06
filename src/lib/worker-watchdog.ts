import { prisma } from "@/lib/prisma";
import { sendTelegramMessage, telegramAdminRecipients } from "@/lib/telegram";

export const PAYMENT_OUTBOX_SERVICE_KEY = "tg-payment-outbox";
export const PAYMENT_OUTBOX_BACKLOG_KEY = "payment-outbox-backlog";
export const HEARTBEAT_STALE_MS = 5 * 60_000;
export const OUTBOX_BACKLOG_STALE_MS = 10 * 60_000;
const REPEAT_ALERT_MS = 60 * 60_000;
const CHECK_MS = 60_000;

export type HeartbeatHealth = "missing" | "fresh" | "stale";

export function heartbeatHealth(lastSeenAt: Date | null, now = new Date()): HeartbeatHealth {
  if (!lastSeenAt) return "missing";
  return now.getTime() - lastSeenAt.getTime() > HEARTBEAT_STALE_MS ? "stale" : "fresh";
}

async function fanout(text: string) {
  const token = process.env.TG_TOKEN?.trim();
  const recipients = telegramAdminRecipients();
  if (!token || recipients.length === 0) {
    console.error("[WorkerWatchdog] TG_TOKEN or ADMIN_IDS/TG_CHAT_ID is not configured");
    return false;
  }
  const results = await Promise.all(recipients.map((id) => sendTelegramMessage(token, id, text)));
  return results.some(Boolean);
}

export async function inspectPaymentWorkerHeartbeat(now = new Date()) {
  const cutoff = new Date(now.getTime() - HEARTBEAT_STALE_MS);
  const repeatCutoff = new Date(now.getTime() - REPEAT_ALERT_MS);
  let row = await prisma.serviceHeartbeat.findUnique({
    where: { serviceKey: PAYMENT_OUTBOX_SERVICE_KEY },
  });

  if (!row) {
    row = await prisma.serviceHeartbeat.create({
      data: {
        serviceKey: PAYMENT_OUTBOX_SERVICE_KEY,
        lastSeenAt: new Date(0),
        status: "STALE",
        lastAlertAt: now,
      },
    }).catch(() => prisma.serviceHeartbeat.findUniqueOrThrow({
      where: { serviceKey: PAYMENT_OUTBOX_SERVICE_KEY },
    }));
    if (row.status === "STALE" && row.lastAlertAt?.getTime() === now.getTime()) {
      await fanout("🚨 <b>PAYMENT WORKER НЕ ЗАПУЩЕН</b>\nHeartbeat процесса Telegram/outbox отсутствует. Уведомления об оплате могут не доставляться.");
    }
    return "missing" as const;
  }

  const health = heartbeatHealth(row.lastSeenAt, now);
  if (health === "fresh") {
    if (row.status === "STALE") {
      const claimed = await prisma.serviceHeartbeat.updateMany({
        where: { serviceKey: row.serviceKey, status: "STALE", lastSeenAt: { gt: cutoff } },
        data: { status: "HEALTHY" },
      });
      if (claimed.count === 1) {
        const delivered = await fanout("✅ <b>PAYMENT WORKER ВОССТАНОВЛЕН</b>\nHeartbeat Telegram/outbox снова поступает.");
        if (!delivered) {
          await prisma.serviceHeartbeat.updateMany({
            where: { serviceKey: row.serviceKey, status: "HEALTHY" },
            data: { status: "STALE" },
          });
        }
      }
    } else if (row.status !== "HEALTHY") {
      await prisma.serviceHeartbeat.updateMany({
        where: { serviceKey: row.serviceKey, status: row.status },
        data: { status: "HEALTHY" },
      });
    }
    return health;
  }

  const shouldClaim = row.status !== "STALE" || !row.lastAlertAt || row.lastAlertAt < repeatCutoff;
  if (shouldClaim) {
    const claimed = await prisma.serviceHeartbeat.updateMany({
      where: {
        serviceKey: row.serviceKey,
        lastSeenAt: { lte: cutoff },
        OR: [
          { status: { not: "STALE" } },
          { lastAlertAt: null },
          { lastAlertAt: { lt: repeatCutoff } },
        ],
      },
      data: { status: "STALE", lastAlertAt: now },
    });
    if (claimed.count === 1) {
      const minutes = Math.max(5, Math.floor((now.getTime() - row.lastSeenAt.getTime()) / 60_000));
      const delivered = await fanout(`🚨 <b>PAYMENT WORKER ОСТАНОВЛЕН</b>\nНет heartbeat Telegram/outbox уже ${minutes} мин. Проверьте TG-процесс; банковские webhook сохраняются, но уведомления задерживаются.`);
      if (!delivered) {
        await prisma.serviceHeartbeat.updateMany({
          where: { serviceKey: row.serviceKey, lastAlertAt: now },
          data: { lastAlertAt: null },
        });
      }
    }
  }
  return health;
}

export async function inspectPaymentOutboxBacklog(now = new Date()) {
  const overdueBefore = new Date(now.getTime() - OUTBOX_BACKLOG_STALE_MS);
  const repeatCutoff = new Date(now.getTime() - REPEAT_ALERT_MS);
  const overdue = await prisma.outboxMessage.count({
    where: { status: "PENDING", nextAttemptAt: { lt: overdueBefore } },
  });
  const row = await prisma.serviceHeartbeat.upsert({
    where: { serviceKey: PAYMENT_OUTBOX_BACKLOG_KEY },
    create: {
      serviceKey: PAYMENT_OUTBOX_BACKLOG_KEY,
      lastSeenAt: now,
      status: overdue > 0 ? "UNKNOWN" : "HEALTHY",
      lastAlertAt: null,
    },
    update: { lastSeenAt: now },
  });

  if (overdue > 0) {
    const shouldClaim = row.status !== "STALE" || !row.lastAlertAt || row.lastAlertAt < repeatCutoff;
    if (shouldClaim) {
      const claimed = await prisma.serviceHeartbeat.updateMany({
        where: {
          serviceKey: PAYMENT_OUTBOX_BACKLOG_KEY,
          OR: [
            { status: { not: "STALE" } },
            { lastAlertAt: null },
            { lastAlertAt: { lt: repeatCutoff } },
          ],
        },
        data: { status: "STALE", lastAlertAt: now },
      });
      if (claimed.count === 1) {
        const delivered = await fanout(`🚨 <b>PAYMENT OUTBOX ЗАСТРЯЛ</b>\nСообщений PENDING старше 10 минут: ${overdue}. Webhook банка сохраняется, но уведомления требуют проверки.`);
        if (!delivered) {
          await prisma.serviceHeartbeat.updateMany({
            where: { serviceKey: PAYMENT_OUTBOX_BACKLOG_KEY, lastAlertAt: now },
            data: { lastAlertAt: null },
          });
        }
      }
    }
    return { healthy: false, overdue };
  }

  if (row.status === "STALE") {
    const claimed = await prisma.serviceHeartbeat.updateMany({
      where: { serviceKey: PAYMENT_OUTBOX_BACKLOG_KEY, status: "STALE" },
      data: { status: "HEALTHY" },
    });
    if (claimed.count === 1) {
      const delivered = await fanout("✅ <b>PAYMENT OUTBOX РАЗОБРАН</b>\nПросроченных PENDING-сообщений больше нет.");
      if (!delivered) {
        await prisma.serviceHeartbeat.updateMany({
          where: { serviceKey: PAYMENT_OUTBOX_BACKLOG_KEY, status: "HEALTHY" },
          data: { status: "STALE" },
        });
      }
    }
  }
  return { healthy: true, overdue: 0 };
}

export function startPaymentWorkerWatchdog() {
  if (process.env.NODE_ENV !== "production" || process.env.WORKER_WATCHDOG_ENABLED === "false") return;
  const runtime = globalThis as typeof globalThis & { __paymentWorkerWatchdog?: boolean };
  if (runtime.__paymentWorkerWatchdog) return;
  runtime.__paymentWorkerWatchdog = true;

  const check = () => Promise.all([
    inspectPaymentWorkerHeartbeat(),
    inspectPaymentOutboxBacklog(),
  ]).catch((error) => {
    console.error("[WorkerWatchdog] inspection failed", error);
  });
  const first = setTimeout(check, HEARTBEAT_STALE_MS);
  const interval = setInterval(check, CHECK_MS);
  first.unref?.();
  interval.unref?.();
  console.log("[WorkerWatchdog] independent web-side monitor started ✅");
}
