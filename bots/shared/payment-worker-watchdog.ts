import { db } from "./db";
import { tgSend } from "./notify";
import { PAYMENT_OUTBOX_SERVICE_KEY } from "./worker-heartbeat";

const BACKLOG_SERVICE_KEY = "payment-outbox-backlog";
const STALE_MS = 5 * 60_000;
const BACKLOG_MS = 10 * 60_000;
const REPEAT_MS = 60 * 60_000;
const CHECK_MS = 60_000;

function adminRecipients() {
  return [...new Set(
    (process.env.ADMIN_IDS ?? process.env.TG_CHAT_ID ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  )];
}

type WorkerAlertKind = "worker_stale" | "worker_recovered" | "backlog_stale" | "backlog_recovered";

async function webEmailFallback(kind: WorkerAlertKind, text: string) {
  const key = process.env.VALIDATOR_KEY?.trim();
  if (!key) return false;
  const baseUrl = (process.env.WEB_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "https://robloxbank.ru").trim();
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/internal/worker-alert`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-worker-alert-key": key },
      body: JSON.stringify({ kind, text }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = await response.json().catch(() => null) as { delivered?: boolean } | null;
    return response.ok && body?.delivered === true;
  } catch (error) {
    console.warn("[IndependentPaymentWatchdog] email fallback failed", (error as Error)?.message ?? error);
    return false;
  }
}

async function fanout(kind: WorkerAlertKind, text: string) {
  const recipients = adminRecipients();
  if (process.env.TG_TOKEN && recipients.length > 0) {
    const results = await Promise.all(recipients.map((id) => tgSend(id, text)));
    if (results.some((result) => result.ok === true || Boolean(result.result))) return true;
  }
  return webEmailFallback(kind, text);
}

async function inspectHeartbeat(now: Date) {
  const cutoff = new Date(now.getTime() - STALE_MS);
  const repeatCutoff = new Date(now.getTime() - REPEAT_MS);
  const row = await db.serviceHeartbeat.findUnique({ where: { serviceKey: PAYMENT_OUTBOX_SERVICE_KEY } });
  if (!row) return;

  if (row.lastSeenAt > cutoff) {
    if (row.status === "STALE") {
      const claimed = await db.serviceHeartbeat.updateMany({
        where: { serviceKey: row.serviceKey, status: "STALE", lastSeenAt: { gt: cutoff } },
        data: { status: "HEALTHY" },
      });
      if (claimed.count === 1) {
        const delivered = await fanout("worker_recovered", "✅ <b>PAYMENT WORKER ВОССТАНОВЛЕН</b>\nHeartbeat Telegram/outbox снова поступает.");
        if (!delivered) {
          await db.serviceHeartbeat.updateMany({
            where: { serviceKey: row.serviceKey, status: "HEALTHY" },
            data: { status: "STALE" },
          });
        }
      }
    } else if (row.status !== "HEALTHY") {
      await db.serviceHeartbeat.updateMany({
        where: { serviceKey: row.serviceKey, status: row.status },
        data: { status: "HEALTHY" },
      });
    }
    return;
  }

  const claimed = await db.serviceHeartbeat.updateMany({
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
  if (claimed.count !== 1) return;

  const minutes = Math.max(5, Math.floor((now.getTime() - row.lastSeenAt.getTime()) / 60_000));
  const delivered = await fanout("worker_stale", `🚨 <b>PAYMENT WORKER ОСТАНОВЛЕН</b>\nНет heartbeat Telegram/outbox уже ${minutes} мин. Проверьте TG-процесс; webhook сохраняются, но уведомления задерживаются.`);
  if (!delivered) {
    await db.serviceHeartbeat.updateMany({
      where: { serviceKey: row.serviceKey, lastAlertAt: now },
      data: { lastAlertAt: null },
    });
  }
}

async function inspectBacklog(now: Date) {
  const overdue = await db.outboxMessage.count({
    where: { status: "PENDING", nextAttemptAt: { lt: new Date(now.getTime() - BACKLOG_MS) } },
  });
  const repeatCutoff = new Date(now.getTime() - REPEAT_MS);
  const row = await db.serviceHeartbeat.upsert({
    where: { serviceKey: BACKLOG_SERVICE_KEY },
    create: { serviceKey: BACKLOG_SERVICE_KEY, lastSeenAt: now, status: overdue > 0 ? "UNKNOWN" : "HEALTHY" },
    update: { lastSeenAt: now },
  });

  if (overdue === 0) {
    if (row.status === "STALE") {
      const claimed = await db.serviceHeartbeat.updateMany({
        where: { serviceKey: BACKLOG_SERVICE_KEY, status: "STALE" },
        data: { status: "HEALTHY" },
      });
      if (claimed.count === 1 && !await fanout("backlog_recovered", "✅ <b>PAYMENT OUTBOX РАЗОБРАН</b>\nПросроченных PENDING-сообщений больше нет.")) {
        await db.serviceHeartbeat.updateMany({
          where: { serviceKey: BACKLOG_SERVICE_KEY, status: "HEALTHY" },
          data: { status: "STALE" },
        });
      }
    }
    return;
  }

  const claimed = await db.serviceHeartbeat.updateMany({
    where: {
      serviceKey: BACKLOG_SERVICE_KEY,
      OR: [
        { status: { not: "STALE" } },
        { lastAlertAt: null },
        { lastAlertAt: { lt: repeatCutoff } },
      ],
    },
    data: { status: "STALE", lastAlertAt: now },
  });
  if (claimed.count === 1 && !await fanout("backlog_stale", `🚨 <b>PAYMENT OUTBOX ЗАСТРЯЛ</b>\nСообщений PENDING старше 10 минут: ${overdue}. Требуется проверка.`)) {
    await db.serviceHeartbeat.updateMany({
      where: { serviceKey: BACKLOG_SERVICE_KEY, lastAlertAt: now },
      data: { lastAlertAt: null },
    });
  }
}

export async function inspectPaymentWorkerFromIndependentProcess(now = new Date()) {
  await inspectHeartbeat(now);
  await inspectBacklog(now);
}

export function startIndependentPaymentWorkerWatchdog() {
  if (process.env.VK_WORKER_WATCHDOG_ENABLED === "false") return;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await inspectPaymentWorkerFromIndependentProcess();
    } catch (error) {
      console.error("[IndependentPaymentWatchdog] inspection failed", error);
    } finally {
      running = false;
    }
  };
  setTimeout(tick, 10_000);
  setInterval(tick, CHECK_MS);
  console.log("[IndependentPaymentWatchdog] VK-side monitor started ✅");
}
