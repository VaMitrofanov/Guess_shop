import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  heartbeatHealth,
  OUTBOX_BACKLOG_STALE_MS,
  PAYMENT_OUTBOX_SERVICE_KEY,
} from "@/lib/worker-watchdog";

export const dynamic = "force-dynamic";

/** Readiness signal for operators; deliberately separate from container
 * liveness so a stopped TG worker never causes a healthy web process restart. */
export async function GET() {
  const now = new Date();
  const [heartbeat, overdueMessages] = await Promise.all([
    prisma.serviceHeartbeat.findUnique({
      where: { serviceKey: PAYMENT_OUTBOX_SERVICE_KEY },
      select: { lastSeenAt: true, status: true },
    }),
    prisma.outboxMessage.count({
      where: {
        status: "PENDING",
        nextAttemptAt: { lt: new Date(now.getTime() - OUTBOX_BACKLOG_STALE_MS) },
      },
    }),
  ]);
  const health = heartbeatHealth(heartbeat?.lastSeenAt ?? null);
  const healthy = health === "fresh" && overdueMessages === 0;
  return NextResponse.json({
    healthy,
    service: PAYMENT_OUTBOX_SERVICE_KEY,
    state: health,
    lastSeenAt: heartbeat?.lastSeenAt?.toISOString() ?? null,
    watchdogState: heartbeat?.status ?? "UNKNOWN",
    overduePendingMessages: overdueMessages,
  }, {
    status: healthy ? 200 : 503,
    headers: { "cache-control": "no-store" },
  });
}
