import { prisma } from "@/lib/prisma";
import { isAdminTelegramId, isBreakGlassEmail } from "@/lib/admin-roster";

/**
 * Правило «админ или нет» в чистом виде (этап A1).
 *
 * Лежит отдельно от `admin-access.ts` намеренно: тот тянет `@/auth` ради
 * сессии, а `src/auth.ts` сам обязан выводить роль на каждом запросе — прямой
 * импорт замкнул бы цикл. Здесь только Prisma и список из env, поэтому модуль
 * безопасно использовать из обеих сторон.
 */

export type AdminGrant =
  | { via: "telegram"; telegramId: string }
  | { via: "break-glass" };

export type AdminCandidate = {
  email: string | null;
  role: string;
  /** Только **проверенные** сервером Telegram-личности (`UserIdentity`). */
  telegramSubjects: string[];
};

/**
 * Порядок намеренный: сначала Telegram (основной путь), потом запасной вход.
 *
 * Запасной требует **два** независимых условия — адрес в
 * `ADMIN_BREAKGLASS_EMAILS` и `role = "ADMIN"` в базе. Одной роли недостаточно:
 * иначе доступа к БД хватило бы, чтобы выписать себе админку в обход
 * `ADMIN_IDS`. Одного env-списка — тоже, иначе опечатка в переменной раздавала
 * бы права по чужому адресу.
 */
export function adminGrantFor(user: AdminCandidate): AdminGrant | null {
  const telegramId = user.telegramSubjects.find((subject) => isAdminTelegramId(subject));
  if (telegramId) return { via: "telegram", telegramId };
  if (user.role === "ADMIN" && isBreakGlassEmail(user.email)) return { via: "break-glass" };
  return null;
}

/** Подтягивает из базы ровно то, что нужно `adminGrantFor`. */
export async function loadAdminCandidate(userId: string): Promise<AdminCandidate | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      email: true,
      role: true,
      identities: { where: { provider: "TG" }, select: { subject: true } },
    },
  });
  if (!user) return null;
  return {
    email: user.email,
    role: user.role,
    telegramSubjects: user.identities.map((identity) => identity.subject),
  };
}
