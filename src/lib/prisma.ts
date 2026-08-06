import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function poolSize() {
  // Read-only A/B 04.08: max=5 improved combined admin p50 from 469ms to
  // 349ms and was more stable than max=6 (507ms outlier). Env remains the
  // rollback/tuning lever; clamping prevents an accidental connection storm.
  const configured = Number(process.env.DB_POOL_MAX ?? 5);
  return Number.isInteger(configured) ? Math.min(10, Math.max(2, configured)) : 5;
}

export const databasePoolMax = poolSize();

function buildPoolerUrl(raw: string): string {
  try {
    const u = new URL(raw);
    if (u.hostname.includes("-pooler.")) return raw;
    u.hostname = u.hostname.replace(/^(ep-[^.]+)(\.)/,  "$1-pooler$2");
    u.searchParams.delete("channel_binding");
    return u.toString();
  } catch { return raw; }
}

const pool = new Pool({
  connectionString: buildPoolerUrl(process.env.DATABASE_URL ?? ""),
  max: databasePoolMax,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 15_000,
});

const adapter = new PrismaPg(pool);

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["query"] : [],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// Pre-warm the configured pool on startup so the first real request
// doesn't pay the TLS handshake + Neon auth cost (~1.5s per connection).
if (!globalForPrisma.prisma) {
  Promise.all(Array.from({ length: databasePoolMax }, () => pool.query("SELECT 1"))).catch(() => {});
}
