import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { packsAvailable } from "@/lib/codes-pricing";

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
 *
 * Заказ = набор кодов поставщика (20.11.2026, `codeComponents`): «2 000 R$» —
 * два кода по 1 000, «199 R$» — код на 200. Склад хранит номиналы поставщика,
 * резерв и выдача идут по списку частей и выдают либо ВСЕ части, либо ни одной.
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

/** Можно ли собрать хотя бы один заказ этого номинала из свободных кодов. */
export async function hasStock(denomination: number, db: Db = prisma): Promise<boolean> {
  return packsAvailable(denomination, await availableStock(db)) > 0;
}

/** Один код части: сначала свой резерв (кроме уже взятых), иначе свободный. */
async function reserveOne(db: Db, orderId: string, denomination: number, until: Date, now: Date, skip: string[]): Promise<string | null> {
  const own = await db.$queryRaw<{ id: string }[]>`
    UPDATE "ActivationCode" SET "reservedUntil" = ${until}, "updatedAt" = ${now}
    WHERE id = (
      SELECT id FROM "ActivationCode"
      WHERE "reservedForOrderId" = ${orderId} AND status = 'RESERVED' AND denomination = ${denomination}
        AND NOT (id = ANY(${skip}::text[]))
      ORDER BY "createdAt" ASC
      LIMIT 1
      FOR UPDATE
    )
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
 * Резерв под заказ: по коду на каждую часть (`codeComponents`). Уже есть живой
 * резерв этого заказа — продлеваем его. Не хватило хоть одной части —
 * возвращает null; взятые части остаются за заказом до конца резерва
 * (повторная попытка их же и продлит).
 */
export async function reserveCodesForOrder(
  db: Db,
  orderId: string,
  components: readonly number[],
  until = new Date(Date.now() + RESERVATION_TTL_MS),
): Promise<string[] | null> {
  const now = new Date();
  const ids: string[] = [];
  for (const denomination of components) {
    const id = await reserveOne(db, orderId, denomination, until, now, ids);
    if (!id) return null;
    ids.push(id);
  }
  return ids;
}

async function issueOne(db: Db, orderId: string, denomination: number, now: Date, skip: string[]): Promise<string | null> {
  const own = await db.$queryRaw<{ id: string }[]>`
    UPDATE "ActivationCode" SET status = 'ISSUED', "issuedAt" = ${now}, "reservedUntil" = NULL, "updatedAt" = ${now}
    WHERE id = (
      SELECT id FROM "ActivationCode"
      WHERE "reservedForOrderId" = ${orderId} AND status = 'RESERVED' AND denomination = ${denomination}
        AND NOT (id = ANY(${skip}::text[]))
      ORDER BY "createdAt" ASC
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

/**
 * Выдача после подтверждённой оплаты (внутри транзакции webhook). Для каждой
 * части — сначала свой резерв (даже протухший, если его ещё никто не забрал),
 * иначе любой свободный. Все части или ни одной: не хватило — уже выданные в
 * этом вызове коды возвращаются в резерв заказа, а заказ уходит на ручную
 * выдачу целиком (полнабора покупателю не отправляем).
 */
export async function issueCodesForOrder(db: Db, orderId: string, components: readonly number[]): Promise<string[] | null> {
  const now = new Date();
  const ids: string[] = [];
  for (const denomination of components) {
    const id = await issueOne(db, orderId, denomination, now, ids);
    if (!id) {
      if (ids.length) {
        const until = new Date(now.getTime() + RESERVATION_TTL_MS);
        await db.$executeRaw`
          UPDATE "ActivationCode" SET status = 'RESERVED', "issuedAt" = NULL, "reservedUntil" = ${until}, "updatedAt" = ${now}
          WHERE id = ANY(${ids}::text[])
        `;
      }
      return null;
    }
    ids.push(id);
  }
  return ids;
}
