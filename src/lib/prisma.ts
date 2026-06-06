import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

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
  max: 3,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 15_000,
  options: "--statement_timeout=8000",
});

const adapter = new PrismaPg(pool);

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["query"] : [],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// Pre-warm all 3 pool connections on startup so the first real request
// doesn't pay the TLS handshake + Neon auth cost (~1.5s per connection).
if (!globalForPrisma.prisma) {
  Promise.all([pool.query("SELECT 1"), pool.query("SELECT 1"), pool.query("SELECT 1")]).catch(() => {});
}
