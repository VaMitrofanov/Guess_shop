import { db } from "./db";

export const PAYMENT_OUTBOX_SERVICE_KEY = "tg-payment-outbox";

/** Durable heartbeat. Failure is deliberately fatal to the current worker
 * tick: processing payments while monitoring is blind would be fail-open. */
export async function touchPaymentOutboxHeartbeat(now = new Date()) {
  await db.serviceHeartbeat.upsert({
    where: { serviceKey: PAYMENT_OUTBOX_SERVICE_KEY },
    create: { serviceKey: PAYMENT_OUTBOX_SERVICE_KEY, lastSeenAt: now },
    update: { lastSeenAt: now },
  });
}
