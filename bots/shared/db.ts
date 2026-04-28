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
    // Keep the pool small — bots are long-lived and Neon free tier has low connection limits.
    max: 3,
    idleTimeoutMillis:    30_000,
    connectionTimeoutMillis: 15_000, // Neon may need ~10 s to wake from cold state
    // Kill individual queries that exceed 8 s — prevents ETIMEDOUT from hanging the process.
    options: "--statement_timeout=8000",
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

// ─────────────────────────────────────────────────────────────────────────────
// Customer recognition
// ─────────────────────────────────────────────────────────────────────────────

export interface CustomerStatus {
  isReturning: boolean;
  orderCount:  number; // total WbOrders ever placed
}

/**
 * Checks whether a user has placed at least one WbOrder before.
 * Always fail-open (returns isReturning=false on any DB error) so it never
 * blocks the message path.
 */
export async function getCustomerStatus(
  platformId: string,
  platform:   "TG" | "VK"
): Promise<CustomerStatus> {
  console.log(`[DB DEBUG] Querying loyalty for ID: ${platformId} (platform: ${platform}, type: ${typeof platformId})`);
  try {
    const where = platform === "TG"
      ? { tgId: String(platformId) }
      : { vkId: String(platformId) };
    console.log(`[DB DEBUG] findUnique where:`, JSON.stringify(where));

    const user = await (db as any).user.findUnique({ where, select: { id: true } });
    console.log(`[DB DEBUG] User lookup for ${platformId}: ${user ? `found (id=${user.id})` : "NOT FOUND"}`);
    if (!user) return { isReturning: false, orderCount: 0 };

    const orderCount = await (db as any).wbOrder.count({ where: { userId: user.id } });
    console.log(`[DB DEBUG] Found ${orderCount} orders for user ${platformId} (userId=${user.id})`);
    return { isReturning: orderCount > 0, orderCount };
  } catch (err: unknown) {
    const errObj = err instanceof Error ? err : new Error(String(err));
    console.error(
      `[DB DEBUG] getCustomerStatus FAILED for ${platformId} on ${platform}:\n` +
      `  message: ${errObj.message}\n` +
      `  stack: ${errObj.stack}`
    );
    return { isReturning: false, orderCount: 0 };
  }
}

/**
 * Short greeting prefix used inside the ACTIVE flow (code activation / gamepass step).
 * Caller appends operational instructions ("send gamepass", etc.) after it.
 *
 * Tiers:
 *   VIP  (5+ orders)  — crown, priority, concierge tone
 *   Returning (1–4)   — warm, personal, encouraging
 *   New  (0 orders)   — welcoming, intro to service
 */
export function getGreeting(status: CustomerStatus, name?: string): string {
  const n = name ?? "";

  if (status.orderCount >= 5) {
    return n
      ? `👑 С возвращением, наш VIP-клиент, ${n}! Спасибо, что ты с нами. `
      : `👑 С возвращением, наш VIP-клиент! Спасибо, что ты с нами. `;
  }

  if (status.isReturning) {
    return n
      ? `👋 Рады тебя видеть снова, ${n}! `
      : `👋 Рады тебя видеть снова! `;
  }

  return n
    ? `👋 Привет, ${n}! Добро пожаловать в RobloxBank. `
    : `👋 Привет! Добро пожаловать в RobloxBank. `;
}

/**
 * Full standalone greeting for IDLE state (no active code / gamepass in session).
 * Returns a self-contained message with a direct-sales upsell for returning/VIP tiers.
 * New users fall back to the short getGreeting prefix (caller appends onboarding copy).
 */
export function getIdleGreeting(status: CustomerStatus, name?: string): string {
  const n = name ?? "";

  if (status.orderCount >= 5) {
    return n
      ? `👑 С возвращением, наш VIP-клиент, ${n}! Всегда рады тебя видеть.\n\nПланируешь пополнить баланс? Напоминаем, что покупка напрямую через нас или сайт — это самый быстрый способ получить робуксы по лучшему курсу. 💎`
      : `👑 С возвращением, наш VIP-клиент! Всегда рады тебя видеть.\n\nПланируешь пополнить баланс? Напоминаем, что покупка напрямую через нас или сайт — это самый быстрый способ получить робуксы по лучшему курсу. 💎`;
  }

  if (status.isReturning) {
    return n
      ? `👋 Рады видеть тебя снова, ${n}! Если ты здесь за робуксами — мы на связи.\n\nКстати, покупка напрямую у нас выходит выгоднее, чем на маркетплейсах. Попробуем? 💛`
      : `👋 Рады видеть тебя снова! Если ты здесь за робуксами — мы на связи.\n\nКстати, покупка напрямую у нас выходит выгоднее, чем на маркетплейсах. Попробуем? 💛`;
  }

  // New users: return the short prefix — caller appends onboarding instructions
  return getGreeting(status, name);
}
