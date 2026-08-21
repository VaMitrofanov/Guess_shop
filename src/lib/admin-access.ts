import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { adminGrantFor, loadAdminCandidate, type AdminGrant } from "@/lib/admin-grant";
import { verifyTwaToken } from "@/lib/twa-auth";

/**
 * Единственный гейт админки (этап A1).
 *
 * До этого правда жила в двух местах: `User.role === "ADMIN"` для desktop
 * `/admin` и `ADMIN_IDS` для TWA с ботами. При трёх админах это гарантированный
 * рассинхрон, а при добавлении второго способа доказать права — ещё и «вторая,
 * более слабая дверь к деньгам». Поэтому оба доказательства (сессия next-auth и
 * Bearer-JWT TWA) сходятся здесь и дают один и тот же ответ.
 *
 * Само правило — в `admin-grant.ts`. Роль **выводится** из актуального состава
 * `ADMIN_IDS`, а не хранится: снятие админа действует со следующего запроса,
 * без перелогина.
 */

export type AdminActor = AdminGrant & {
  /** Внутренний `User.id`. У чистого TWA-пропуска записи может ещё не быть. */
  userId: string | null;
  displayName: string;
};

export type { AdminGrant };

/** Права текущей веб-сессии. `null` — не админ (или не залогинен). */
export async function resolveAdminFromSession(): Promise<AdminActor | null> {
  const session = await auth();
  const sessionUser = session?.user as
    | { id?: string; name?: string | null; email?: string | null }
    | undefined;
  if (!sessionUser?.id) return null;

  const candidate = await loadAdminCandidate(sessionUser.id);
  if (!candidate) return null;

  const grant = adminGrantFor(candidate);
  if (!grant) return null;

  return {
    ...grant,
    userId: sessionUser.id,
    displayName: sessionUser.name ?? sessionUser.email ?? "Admin",
  };
}

/**
 * Гейт для API-роутов: принимает и Bearer-пропуск TWA, и веб-сессию.
 *
 * Bearer проверяется первым, потому что мобильная админка всегда присылает
 * заголовок; `verifyTwaToken` уже сверяет `sub` с `ADMIN_IDS` и отпечаток
 * состава, поэтому отдельной проверки роли для него не нужно.
 */
export async function requireAdmin(req: Request): Promise<AdminActor | null> {
  const header = req.headers.get("Authorization") ?? "";
  if (header.startsWith("Bearer ")) {
    const twaUser = await verifyTwaToken(header.slice(7));
    if (!twaUser) return null;
    const linked = await prisma.userIdentity.findUnique({
      where: { provider_subject: { provider: "TG", subject: String(twaUser.userId) } },
      select: { userId: true },
    });
    return {
      via: "telegram",
      telegramId: String(twaUser.userId),
      userId: linked?.userId ?? null,
      displayName: twaUser.firstName,
    };
  }
  return resolveAdminFromSession();
}
