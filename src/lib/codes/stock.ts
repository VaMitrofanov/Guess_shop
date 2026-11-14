import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Склад кодов активации.
 *
 * Резерв ставится при переходе к оплате и живёт `RESERVATION_TTL_MS`. Протухший
 * резерв неоплаченного заказа снова считается свободным. Захват — одним
 * условным UPDATE с `FOR UPDATE SKIP LOCKED`: два одновременных платежа не
 * могут получить один и тот же код.
 *
 * Время в SQL — только параметром из приложения, а не серверной функцией
 * текущего времени: колонки `timestamp` без пояса, Prisma пишет в них UTC, а
 * серверное «сейчас» приводится по поясу СЕССИИ базы. При поясе сессии не UTC
 * свежий резерв выглядел «протухшим», и последний код получали два заказа
 * (поймано сквозным тестом 14.11.2026).
 */

export const RESERVATION_TTL_MS = 2 * 60 * 60 * 1000;

type Db = Prisma.TransactionClient | typeof prisma;

/** Сколько кодов каждого номинала можно продать прямо сейчас. */
export async function availableStock(db: Db = prisma): Promise<Map<number, number>> {
  const now = new Date();
  const rows = await db.$queryRaw<{ denomination: number; n: bigint }[]>`
    SELECT denomination, COUNT(*)::bigint AS n
    FROM "ActivationCode"
    WHERE status = 'IN_STOCK'
       OR (status = 'RESERVED' AND "reservedUntil" < ${now})
    GROUP BY denomination
  `;
  return new Map(rows.map((row) => [Number(row.denomination), Number(row.n)]));
}

export async function hasStock(denomination: number, db: Db = prisma): Promise<boolean> {
  return ((await availableStock(db)).get(denomination) ?? 0) > 0;
}

/**
 * Резерв под заказ. Уже есть живой резерв этого заказа — продлеваем его;
 * иначе берём свободный код. Возвращает id кода или null (нет в наличии).
 */
export async function reserveCodeForOrder(
  db: Db,
  orderId: string,
  denomination: number,
  until = new Date(Date.now() + RESERVATION_TTL_MS),
): Promise<string | null> {
  const now = new Date();
  const own = await db.$queryRaw<{ id: string }[]>`
    UPDATE "ActivationCode" SET "reservedUntil" = ${until}, "updatedAt" = ${now}
    WHERE "reservedForOrderId" = ${orderId} AND status = 'RESERVED' AND denomination = ${denomination}
    RETURNING id
  `;
  if (own[0]) return own[0].id;
  const taken = await db.$queryRaw<{ id: string }[]>`
    UPDATE "ActivationCode" SET status = 'RESERVED', "reservedForOrderId" = ${orderId},
      "reservedUntil" = ${until}, "updatedAt" = ${now}
    WHERE id = (
      SELECT id FROM "ActivationCode"
      WHERE denomination = ${denomination}
        AND (status = 'IN_STOCK' OR (status = 'RESERVED' AND "reservedUntil" < ${now}))
      ORDER BY "createdAt" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id
  `;
  return taken[0]?.id ?? null;
}

/**
 * Выдача после подтверждённой оплаты (внутри транзакции webhook). Сначала свой
 * резерв — даже протухший, если его ещё никто не забрал; иначе любой свободный.
 * Код переходит в ISSUED и навсегда закрепляется за заказом.
 */
export async function issueCodeForOrder(db: Db, orderId: string, denomination: number): Promise<string | null> {
  const now = new Date();
  const own = await db.$queryRaw<{ id: string }[]>`
    UPDATE "ActivationCode" SET status = 'ISSUED', "issuedAt" = ${now}, "reservedUntil" = NULL, "updatedAt" = ${now}
    WHERE id = (
      SELECT id FROM "ActivationCode"
      WHERE "reservedForOrderId" = ${orderId} AND status = 'RESERVED' AND denomination = ${denomination}
      LIMIT 1
      FOR UPDATE
    )
    RETURNING id
  `;
  if (own[0]) return own[0].id;
  const fresh = await db.$queryRaw<{ id: string }[]>`
    UPDATE "ActivationCode" SET status = 'ISSUED', "issuedAt" = ${now}, "reservedForOrderId" = ${orderId},
      "reservedUntil" = NULL, "updatedAt" = ${now}
    WHERE id = (
      SELECT id FROM "ActivationCode"
      WHERE denomination = ${denomination}
        AND (status = 'IN_STOCK' OR (status = 'RESERVED' AND "reservedUntil" < ${now}))
      ORDER BY "createdAt" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id
  `;
  return fresh[0]?.id ?? null;
}
