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

import { Prisma, PrismaClient, UserIdentityProvider } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

function verifiedDatabaseUrl(raw: string) {
  try {
    const url = new URL(raw);
    if (url.searchParams.get("sslmode") === "require") url.searchParams.set("sslmode", "verify-full");
    return url.toString();
  } catch {
    return raw;
  }
}

function createBotClient(): PrismaClient {
  if (!process.env.DATABASE_URL) {
    throw new Error("[bots/db] DATABASE_URL is not set");
  }

  const pool = new Pool({
    connectionString: verifiedDatabaseUrl(process.env.DATABASE_URL),
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

// Neon scale-to-zero keepalive: lightweight SELECT 1 every 4 min prevents the
// compute from sleeping (5 min inactivity threshold). Costs ~0.25 CU continuous
// instead of $80/mo for always-on, while avoiding cold-start penalties.
if (!(g.__neonKeepalive as boolean)) {
  g.__neonKeepalive = true;
  setInterval(() => {
    (db as any).$queryRawUnsafe("SELECT 1").catch(() => {});
  }, 4 * 60 * 1000);
}

export default db;

export type VerifiedBotProfile = {
  name?: string | null;
  username?: string | null;
  image?: string | null;
  metadata?: Record<string, string | number | boolean | null | undefined>;
};

function cleanProfileValue(value: string | null | undefined): string | undefined {
  const cleaned = value?.trim();
  return cleaned || undefined;
}

function legacyPlatformWhere(provider: "TG" | "VK", subject: string) {
  return provider === "TG" ? { tgId: subject } : { vkId: subject };
}

/**
 * A private bot update is provider-authenticated: Telegram/VK supply the actor
 * id, it is not user-entered text. Persist that evidence in UserIdentity while
 * retaining the legacy columns used by the existing order/notification paths.
 * Conflicting identity/legacy owners fail closed and are never merged here.
 */
export async function syncVerifiedBotUser(
  provider: "TG" | "VK",
  platformId: string | number,
  profile: VerifiedBotProfile = {},
) {
  const subject = String(platformId).trim();
  if (!/^\d+$/.test(subject)) throw new Error(`Invalid ${provider} actor id`);

  const name = cleanProfileValue(profile.name);
  const username = cleanProfileValue(profile.username)?.replace(/^@/, "");
  const image = cleanProfileValue(profile.image);
  const providerEnum = provider as UserIdentityProvider;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await db.$transaction(async (tx) => {
        const [identity, legacyUser] = await Promise.all([
          tx.userIdentity.findUnique({
            where: { provider_subject: { provider: providerEnum, subject } },
            include: { user: true },
          }),
          tx.user.findUnique({ where: legacyPlatformWhere(provider, subject) }),
        ]);

        if (identity && legacyUser && identity.userId !== legacyUser.id) {
          throw new Error(`${provider} identity conflicts with legacy profile`);
        }

        let user = identity?.user ?? legacyUser;
        if (!user) {
          user = await tx.user.create({
            data: {
              ...legacyPlatformWhere(provider, subject),
              ...(name ? { name } : {}),
              ...(username ? { username } : {}),
              ...(image ? { image } : {}),
            },
          });
        }

        const providerAlreadyLinked = identity
          ? null
          : await tx.userIdentity.findFirst({ where: { userId: user.id, provider: providerEnum } });
        if (providerAlreadyLinked && providerAlreadyLinked.subject !== subject) {
          throw new Error(`${provider} profile already has a different verified subject`);
        }

        const previousMetadata = identity?.metadata && typeof identity.metadata === "object" && !Array.isArray(identity.metadata)
          ? identity.metadata as Prisma.JsonObject
          : {};
        const metadata = {
          ...previousMetadata,
          source: "bot-event",
          profileSyncedAt: new Date().toISOString(),
          ...(name ? { name } : {}),
          ...(username ? { username } : {}),
          ...(image ? { image } : {}),
          ...Object.fromEntries(Object.entries(profile.metadata ?? {}).filter(([, value]) => value !== undefined)),
        } as Prisma.InputJsonObject;

        if (identity) {
          await tx.userIdentity.update({
            where: { id: identity.id },
            data: { verifiedAt: new Date(), metadata },
          });
        } else if (!providerAlreadyLinked) {
          await tx.userIdentity.create({
            data: { provider: providerEnum, subject, userId: user.id, metadata },
          });
        }

        const hasOtherLegacyChannel = provider === "TG" ? Boolean(user.vkId) : Boolean(user.tgId);
        return tx.user.update({
          where: { id: user.id },
          data: {
            ...legacyPlatformWhere(provider, subject),
            ...(name && (!hasOtherLegacyChannel || !user.name) ? { name } : {}),
            ...(image && (!hasOtherLegacyChannel || !user.image) ? { image } : {}),
            ...(username && (!hasOtherLegacyChannel || !user.username) ? { username } : {}),
          },
        });
      });
    } catch (error) {
      if (attempt === 0 && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        continue;
      }
      throw error;
    }
  }

  throw new Error(`${provider} bot identity sync exhausted retry budget`);
}

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
  try {
    const where = platform === "TG"
      ? { tgId: String(platformId) }
      : { vkId: String(platformId) };

    const user = await (db as any).user.findUnique({ where, select: { id: true } });
    if (!user) return { isReturning: false, orderCount: 0 };

    const orderCount = await (db as any).wbOrder.count({ where: { userId: user.id } });
    return { isReturning: orderCount > 0, orderCount };
  } catch (err: unknown) {
    const errObj = err instanceof Error ? err : new Error(String(err));
    console.error(`[db] getCustomerStatus failed for ${platformId} on ${platform}: ${errObj.message}`);
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
