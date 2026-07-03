/**
 * In-memory token-bucket rate limiter (security risk #2, docs/security.md).
 *
 * The Web container is a single Node process, so a module-level Map is a
 * sufficient store — no Redis required. Buckets refill continuously and are
 * lazily evicted, so memory stays bounded to recently-seen keys.
 *
 * Not suitable if the deployment is ever scaled to multiple Web replicas —
 * each replica would keep its own counters. For the current single-container
 * setup that's fine.
 */

interface Bucket {
  tokens: number;
  updatedAt: number;
}

const buckets = new Map<string, Bucket>();

// Opportunistic eviction so an attacker rotating IPs can't grow the Map
// unboundedly: whenever it gets large, drop buckets untouched for >10 min.
const MAX_BUCKETS = 10_000;
const STALE_MS = 10 * 60 * 1000;

function evictStale(now: number) {
  for (const [key, b] of buckets) {
    if (now - b.updatedAt > STALE_MS) buckets.delete(key);
  }
}

export interface RateLimitResult {
  ok: boolean;
  /** Seconds until at least one token is available again (0 when ok). */
  retryAfter: number;
}

/**
 * @param key      Identity to throttle (e.g. an IP address).
 * @param capacity Max burst size (bucket size).
 * @param refillPerSec Tokens added per second (sustained rate).
 */
export function rateLimit(
  key: string,
  capacity: number,
  refillPerSec: number
): RateLimitResult {
  const now = Date.now();

  if (buckets.size > MAX_BUCKETS) evictStale(now);

  const bucket = buckets.get(key) ?? { tokens: capacity, updatedAt: now };

  // Refill based on elapsed time, capped at capacity.
  const elapsedSec = (now - bucket.updatedAt) / 1000;
  bucket.tokens = Math.min(capacity, bucket.tokens + elapsedSec * refillPerSec);
  bucket.updatedAt = now;

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    buckets.set(key, bucket);
    return { ok: true, retryAfter: 0 };
  }

  buckets.set(key, bucket);
  const retryAfter = Math.ceil((1 - bucket.tokens) / refillPerSec);
  return { ok: false, retryAfter };
}

/**
 * Best-effort client IP from proxy headers.
 *
 * Order matters in this deployment: traffic arrives through a Cloudflare
 * tunnel (cloudflared → Traefik → container). The leftmost `x-forwarded-for`
 * entry the container sees is a Cloudflare edge IP that varies per request
 * (parallel requests fan out across many CF edges), so keying on it defeats
 * rate limiting entirely. Cloudflare's `cf-connecting-ip` is the stable real
 * client IP and must be preferred.
 */
export function clientIp(req: Request): string {
  const cf = req.headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf;

  const trueClient = req.headers.get("true-client-ip")?.trim();
  if (trueClient) return trueClient;

  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();

  return req.headers.get("x-real-ip")?.trim() || "unknown";
}
