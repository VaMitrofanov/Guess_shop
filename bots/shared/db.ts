/**
 * Universal Prisma client for bot processes.
 *
 * Root cause of "engine type 'client' requires adapter":
 *   Prisma 7.x defaults to engineType = "client" (JS-based, no native binary),
 *   which always requires a driver adapter — even on a bare VPS.
 *   prisma.config.ts in the project root locks this in for the whole monorepo.
 *
 * Solution:
 *   Mirror exactly what src/lib/prisma.ts does in the web app:
 *   use PrismaPg (from @prisma/adapter-pg) backed by a standard pg.Pool.
 *   On Vercel this uses the same Neon TCP endpoint.
 *   On VPS it uses the same standard TCP connection — no WebSocket needed.
 *
 * NOTE: Run `npx prisma generate` after any schema migration.
 *       Until then, cast to `(db as any)` for new schema fields.
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

function createBotClient(): PrismaClient {
  if (!process.env.DATABASE_URL) {
    throw new Error("[bots/db] DATABASE_URL is not set");
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // Bots are long-lived processes: keep the pool small to avoid
    // exhausting Neon's connection limit on the free tier.
    max: 3,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  const adapter = new PrismaPg(pool);

  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : [],
  });
}

// Singleton: prevents multiple Pool instances on tsx --watch hot-reloads.
const g = globalThis as Record<string, unknown>;

export const db: PrismaClient =
  (g.__botPrisma as PrismaClient | undefined) ?? createBotClient();

g.__botPrisma = db;

export default db;
