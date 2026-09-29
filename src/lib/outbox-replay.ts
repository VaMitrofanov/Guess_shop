import crypto from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type OutboxReplayInput = {
  outboxId: string;
  idempotencyKey: string;
  requestedBy: string;
  reason?: string;
};

export type OutboxReplayResult = {
  kind: "replayed" | "existing";
  outbox: {
    id: string;
    topic: string;
    status: string;
    attempts: number;
    nextAttemptAt: Date;
  };
};

export class OutboxReplayError extends Error {
  constructor(public readonly code: "OUTBOX_NOT_FOUND" | "OUTBOX_NOT_DEAD" | "OUTBOX_RACE") {
    super(code);
  }
}

type Transaction = Prisma.TransactionClient;

function eventKey(idempotencyKey: string) {
  return `outbox-replay:${idempotencyKey}`;
}

function serializeOutbox(outbox: {
  id: string;
  topic: string;
  status: string;
  attempts: number;
  nextAttemptAt: Date;
}) {
  return {
    id: outbox.id,
    topic: outbox.topic,
    status: outbox.status,
    attempts: outbox.attempts,
    nextAttemptAt: outbox.nextAttemptAt,
  };
}

/**
 * Reopens exactly one exhausted notification delivery. It deliberately does
 * not touch provider payments or refunds: this only gives the outbox worker a
 * fresh, bounded retry budget and writes an immutable operator audit event.
 */
export async function requestOutboxReplay(input: OutboxReplayInput): Promise<OutboxReplayResult> {
  return prisma.$transaction(async (tx: Transaction) => {
    const idempotencyKey = eventKey(input.idempotencyKey);
    const existing = await tx.orderEvent.findUnique({
      where: { idempotencyKey },
      select: { payload: true },
    });

    if (existing) {
      const outboxId = typeof existing.payload === "object" && existing.payload !== null && "outboxId" in existing.payload
        ? String((existing.payload as { outboxId: unknown }).outboxId)
        : "";
      const outbox = outboxId ? await tx.outboxMessage.findUnique({ where: { id: outboxId } }) : null;
      if (!outbox) throw new OutboxReplayError("OUTBOX_NOT_FOUND");
      return { kind: "existing" as const, outbox: serializeOutbox(outbox) };
    }

    const target = await tx.outboxMessage.findUnique({
      where: { id: input.outboxId },
      select: {
        id: true,
        topic: true,
        status: true,
        attempts: true,
        lastError: true,
        event: { select: { orderId: true } },
      },
    });
    if (!target) throw new OutboxReplayError("OUTBOX_NOT_FOUND");
    if (target.status !== "DEAD") throw new OutboxReplayError("OUTBOX_NOT_DEAD");

    const now = new Date();
    const reopened = await tx.outboxMessage.updateMany({
      where: { id: target.id, status: "DEAD" },
      data: {
        status: "PENDING",
        attempts: 0,
        nextAttemptAt: now,
        lockedAt: null,
        deliveredAt: null,
        lastError: null,
      },
    });
    if (reopened.count !== 1) throw new OutboxReplayError("OUTBOX_RACE");

    await tx.orderEvent.create({
      data: {
        orderId: target.event.orderId,
        type: "OUTBOX_REPLAY_REQUESTED",
        idempotencyKey,
        payload: {
          outboxId: target.id,
          topic: target.topic,
          priorAttempts: target.attempts,
          priorErrorHash: target.lastError ? crypto.createHash("sha256").update(target.lastError).digest("hex") : null,
          requestedBy: input.requestedBy,
          reason: input.reason ?? null,
        },
      },
    });

    const outbox = await tx.outboxMessage.findUniqueOrThrow({ where: { id: target.id } });
    return { kind: "replayed" as const, outbox: serializeOutbox(outbox) };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
