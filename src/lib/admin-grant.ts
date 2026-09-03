import { cache } from "react";
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

/** То же плюс поле, которым `src/auth.ts` отзывает сессию. */
export type AdminCandidateRecord = AdminCandidate & { sessionVersion: number };

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

/* ─────────────────────────────────────────────────────────────────────────────
   Одна строка — один заход в базу.

   База живёт в Сингапуре, приложение — в России: каждый round-trip стоит
   ~210 мс независимо от того, насколько лёгкий запрос. Поэтому цена гейта
   меряется не сложностью SQL, а числом обращений.

   До 04.09.2026 их было пять на КАЖДЫЙ запрос админки: `jwt`-callback читал
   `sessionVersion` (1) и выводил роль через `loadAdminCandidate` (2 — Prisma
   разворачивает `include` в отдельный запрос за личностями), а следом
   `resolveAdminFromSession` звал `loadAdminCandidate` второй раз (ещё 2).
   Секунда уходила ещё до того, как роут начинал свою работу, и её платили и
   страница, и каждый её `fetch`, и `/api/auth/session`.

   Теперь заход один: личности приходят подзапросом в той же строке, а
   `cache()` (React) склеивает повторные вызовы внутри одного запроса — тот
   самый приём, который Next советует для DAL. Проверка при этом осталась
   ЖИВОЙ: состав `ADMIN_IDS` и `sessionVersion` по-прежнему сверяются на каждом
   запросе, ничего не кэшируется между запросами.
   ───────────────────────────────────────────────────────────────────────── */

interface CandidateRow {
  email: string | null;
  role: string;
  sessionVersion: number;
  telegramSubjects: string[] | null;
}

/** Подтягивает из базы ровно то, что нужно `adminGrantFor` — за один заход. */
export const loadAdminCandidate = cache(
  async (userId: string): Promise<AdminCandidateRecord | null> => {
    const rows = await prisma.$queryRaw<CandidateRow[]>`
      SELECT
        u."email",
        u."role",
        u."sessionVersion",
        (
          SELECT array_agg(i."subject")
          FROM "UserIdentity" i
          WHERE i."userId" = u."id" AND i."provider" = 'TG'
        ) AS "telegramSubjects"
      FROM "User" u
      WHERE u."id" = ${userId}
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) return null;
    return {
      email: row.email,
      role: row.role,
      sessionVersion: Number(row.sessionVersion),
      telegramSubjects: row.telegramSubjects ?? [],
    };
  },
);
