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
 * Client IP resolution (security risk #2 / ultra-review U2).
 *
 * История: пока трафик шёл через Cloudflare-туннель (cloudflared → Traefik →
 * контейнер), `cf-connecting-ip` был единственным стабильным адресом клиента,
 * и код доверял ему безусловно. После перехода на прямой A-record туннеля
 * больше нет — заголовок стал **обычным клиентским полем**, и подделка его в
 * каждом запросе полностью обходила все IP-лимиты.
 *
 * Теперь режим доверия задаётся явно через `TRUSTED_PROXY_MODE`:
 *
 * - `direct` (по умолчанию, текущий прод): доверяем только тому hop'у, который
 *   дописал наш собственный обратный прокси (Traefik). В `x-forwarded-for` это
 *   **последний** элемент; всё, что клиент прислал сам, левее — игнорируем.
 *   `cf-connecting-ip` / `true-client-ip` не учитываются вовсе.
 * - `cloudflare`: `cf-connecting-ip` принимается, только если ближайший hop
 *   действительно принадлежит диапазонам Cloudflare.
 */
export type TrustedProxyMode = "direct" | "cloudflare";

export function trustedProxyMode(): TrustedProxyMode {
  return process.env.TRUSTED_PROXY_MODE === "cloudflare" ? "cloudflare" : "direct";
}

/**
 * Публичные диапазоны Cloudflare (https://www.cloudflare.com/ips/).
 * Переопределяются через `CLOUDFLARE_IP_RANGES` (CIDR через запятую), чтобы
 * обновление списка не требовало релиза.
 */
const DEFAULT_CLOUDFLARE_RANGES = [
  "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22",
  "141.101.64.0/18", "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20",
  "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13",
  "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
  "2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32",
  "2405:8100::/32", "2a06:98c0::/29", "2c0f:f248::/32",
];

function cloudflareRanges(): string[] {
  const raw = process.env.CLOUDFLARE_IP_RANGES?.trim();
  if (!raw) return DEFAULT_CLOUDFLARE_RANGES;
  return raw.split(",").map(s => s.trim()).filter(Boolean);
}

/** Нормализует адрес в BigInt + разрядность (32 для IPv4, 128 для IPv6). */
function ipToBigInt(ip: string): { value: bigint; bits: 32 | 128 } | null {
  const clean = ip.replace(/^\[|\]$/g, "").split("%")[0];

  if (clean.includes(".") && !clean.includes(":")) {
    const parts = clean.split(".");
    if (parts.length !== 4) return null;
    let value = BigInt(0);
    for (const part of parts) {
      if (!/^\d{1,3}$/.test(part)) return null;
      const n = Number(part);
      if (n > 255) return null;
      value = (value << BigInt(8)) | BigInt(n);
    }
    return { value, bits: 32 };
  }

  if (!clean.includes(":")) return null;

  // IPv4-mapped IPv6 (::ffff:1.2.3.4) сводим к IPv4.
  const mapped = clean.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) return ipToBigInt(mapped[1]);

  const halves = clean.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fillCount = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fillCount < 0) return null;
  const groups = [...head, ...Array(fillCount).fill("0"), ...tail];
  if (groups.length !== 8) return null;

  let value = BigInt(0);
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(group)) return null;
    value = (value << BigInt(16)) | BigInt(parseInt(group, 16));
  }
  return { value, bits: 128 };
}

function ipInCidr(ip: string, cidr: string): boolean {
  const [network, prefixRaw] = cidr.split("/");
  const prefix = Number(prefixRaw);
  const addr = ipToBigInt(ip);
  const net = ipToBigInt(network);
  if (!addr || !net || !Number.isInteger(prefix)) return false;
  if (addr.bits !== net.bits) return false;
  if (prefix < 0 || prefix > addr.bits) return false;
  const shift = BigInt(addr.bits - prefix);
  return addr.value >> shift === net.value >> shift;
}

/** Все hop'ы `x-forwarded-for` слева направо (клиент → ближайший прокси). */
function forwardedChain(req: Request): string[] {
  return (req.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
}

/**
 * Адрес, который дописал наш собственный прокси — единственное, что нельзя
 * подделать клиентом.
 */
function nearestHop(req: Request): string | null {
  const chain = forwardedChain(req);
  if (chain.length > 0) return chain[chain.length - 1];
  return req.headers.get("x-real-ip")?.trim() || null;
}

export function clientIp(req: Request): string {
  if (trustedProxyMode() === "cloudflare") {
    const hop = nearestHop(req);
    const trustedEdge = hop != null && cloudflareRanges().some(cidr => ipInCidr(hop, cidr));
    if (trustedEdge) {
      const cf = req.headers.get("cf-connecting-ip")?.trim();
      if (cf) return cf;
      const trueClient = req.headers.get("true-client-ip")?.trim();
      if (trueClient) return trueClient;
    }
    return hop ?? "unknown";
  }

  // direct: только hop от Traefik, клиентские заголовки игнорируются.
  return nearestHop(req) ?? "unknown";
}
