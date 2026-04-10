/**
 * Prisma client for bot processes.
 *
 * Bots run as long-lived Node.js processes — we use the standard
 * PrismaClient without the Neon/PrismaPg serverless adapter (which is
 * only needed for Vercel edge functions).
 *
 * NOTE: Run `npx prisma generate` after any schema migration so the
 * generated types match the new schema fields (vkId, tgId, balance, etc.).
 * Until then all bot code casts to `(db as any)` for new fields.
 */

import { PrismaClient } from "@prisma/client";

// Singleton so hot-reload (tsx watch) doesn't open multiple connections
const globalAny = globalThis as Record<string, unknown>;

export const db: PrismaClient =
  (globalAny.__botPrisma as PrismaClient | undefined) ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : [],
  });

globalAny.__botPrisma = db;

export default db;
