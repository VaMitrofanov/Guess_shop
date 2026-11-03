export const OUTBOX_MAX_ATTEMPTS = 8;
export const OUTBOX_LEASE_MS = 5 * 60_000;

/** Deterministic capped exponential backoff: 30s, 1m, 2m ... max 1h. */
export function outboxBackoffMs(attempts: number): number {
  const safeAttempts = Math.max(1, Math.floor(attempts));
  return Math.min(60 * 60_000, 30_000 * 2 ** (safeAttempts - 1));
}

export function nextOutboxFailure(attempts: number, now = new Date()) {
  const normalized = Math.max(1, Math.floor(attempts));
  const dead = normalized >= OUTBOX_MAX_ATTEMPTS;
  return {
    status: dead ? "DEAD" as const : "PENDING" as const,
    nextAttemptAt: dead ? now : new Date(now.getTime() + outboxBackoffMs(normalized)),
  };
}

export function outboxLeaseExpired(lockedAt: Date | null, now = new Date()) {
  return !lockedAt || lockedAt.getTime() <= now.getTime() - OUTBOX_LEASE_MS;
}
