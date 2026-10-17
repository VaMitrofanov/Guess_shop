import { OUTBOX_MAX_ATTEMPTS, nextOutboxFailure, outboxBackoffMs, outboxLeaseExpired } from "@/lib/outbox-policy";

describe("outbox retry policy", () => {
  test.each([[1, 30_000], [2, 60_000], [3, 120_000], [8, 3_600_000], [50, 3_600_000]])(
    "attempt %i backs off %i ms", (attempt, expected) => expect(outboxBackoffMs(attempt)).toBe(expected),
  );

  it("moves the exhausted message to dead-letter", () => {
    const now = new Date("2026-07-13T00:00:00Z");
    expect(nextOutboxFailure(OUTBOX_MAX_ATTEMPTS, now)).toEqual({ status: "DEAD", nextAttemptAt: now });
  });

  it("recovers only expired leases", () => {
    const now = new Date("2026-07-13T00:10:00Z");
    expect(outboxLeaseExpired(new Date("2026-07-13T00:04:59Z"), now)).toBe(true);
    expect(outboxLeaseExpired(new Date("2026-07-13T00:06:00Z"), now)).toBe(false);
  });
});
