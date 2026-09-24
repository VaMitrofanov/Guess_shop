jest.mock("@/lib/prisma", () => ({ prisma: { $transaction: jest.fn() } }));

import { prisma } from "@/lib/prisma";
import { OutboxReplayError, requestOutboxReplay } from "@/lib/outbox-replay";

const tx = {
  orderEvent: { findUnique: jest.fn(), create: jest.fn() },
  outboxMessage: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn(), updateMany: jest.fn() },
};
const db = prisma as unknown as { $transaction: jest.Mock };

describe("outbox replay", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.$transaction.mockImplementation((callback: (client: typeof tx) => unknown) => callback(tx));
  });

  it("reopens only an exhausted message and creates an immutable audit event", async () => {
    tx.orderEvent.findUnique.mockResolvedValue(null);
    tx.outboxMessage.findUnique.mockResolvedValue({
      id: "outbox-1", topic: "payment.confirmed", status: "DEAD", attempts: 8, lastError: "telegram unavailable",
      event: { orderId: "order-1" },
    });
    tx.outboxMessage.updateMany.mockResolvedValue({ count: 1 });
    tx.orderEvent.create.mockResolvedValue({});
    tx.outboxMessage.findUniqueOrThrow.mockResolvedValue({
      id: "outbox-1", topic: "payment.confirmed", status: "PENDING", attempts: 0, nextAttemptAt: new Date("2026-07-24T10:00:00Z"),
    });

    const result = await requestOutboxReplay({ outboxId: "outbox-1", idempotencyKey: "bdf02a49-563c-4a05-94c0-90d7538a364b", requestedBy: "admin-1", reason: "Telegram restored" });

    expect(result).toEqual(expect.objectContaining({ kind: "replayed", outbox: expect.objectContaining({ status: "PENDING", attempts: 0 }) }));
    expect(tx.outboxMessage.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "outbox-1", status: "DEAD" },
      data: expect.objectContaining({ status: "PENDING", attempts: 0, lockedAt: null, lastError: null }),
    }));
    expect(tx.orderEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      type: "OUTBOX_REPLAY_REQUESTED", orderId: "order-1", idempotencyKey: "outbox-replay:bdf02a49-563c-4a05-94c0-90d7538a364b",
      payload: expect.objectContaining({ outboxId: "outbox-1", priorAttempts: 8, requestedBy: "admin-1", reason: "Telegram restored", priorErrorHash: expect.any(String) }),
    }) }));
  });

  it("refuses a message that is not dead-letter", async () => {
    tx.orderEvent.findUnique.mockResolvedValue(null);
    tx.outboxMessage.findUnique.mockResolvedValue({ id: "outbox-1", status: "DELIVERED" });

    await expect(requestOutboxReplay({ outboxId: "outbox-1", idempotencyKey: "bdf02a49-563c-4a05-94c0-90d7538a364b", requestedBy: "admin-1" }))
      .rejects.toMatchObject<Partial<OutboxReplayError>>({ code: "OUTBOX_NOT_DEAD" });
    expect(tx.outboxMessage.updateMany).not.toHaveBeenCalled();
  });
});
