/**
 * Рельсы коридора: пока заказ не собран, вторую покупку не начинаем.
 *
 * Решение владельца 07.09.2026: «Как только заказ создан полностью — пользователь
 * идёт в свободное плавание… но перед его глазами всегда висит: ваш заказ такой-то,
 * статус такой-то». Обратное тоже верно: пока заказ НЕ создан, человека ведут за
 * руку и не показывают ему второй способ потратить деньги.
 *
 * Живой случай, из которого выросло правило (`JS6NQB9`, 07.09.2026): заказ WB DBS
 * ждал геймпасс, а покупатель в это же время завёл на сайте платный заказ на те же
 * 500 R$ — и бросил его в оплате. В боте дверь к тому же самому лежит на каждом
 * экране кнопкой «💎 Купить напрямую».
 *
 * Запрета здесь нет: это ОДИН экран с выбором, где «продолжить заказ» стоит
 * первым, а «всё равно куплю» — рядом. Отказывать покупателю в покупке мы не
 * вправе; вести его к очевидному следующему шагу — обязаны.
 */

/** Источники, где деньги уже получены не нами. */
export const CORRIDOR_SOURCES = ["WB", "WB_DBS"] as const;

export interface UnfinishedCorridorOrder {
  wbCode: string;
  amount: number;
  /** Ник, если уже назывался: ссылка на инструкцию тогда откроется сразу с ним. */
  nick: string | null;
}

interface CorridorOrderRow {
  wbCode: string;
  amount: number;
  robloxUsername: string | null;
  probableNick: string | null;
}

export type CorridorGuardClient = {
  wbOrder: { findFirst: (args: Record<string, unknown>) => Promise<CorridorOrderRow | null> };
};

/**
 * Заказ коридора, который ждёт геймпасс. `null` — покупать можно свободно.
 */
export async function findUnfinishedCorridorOrder(
  db: CorridorGuardClient,
  userId: string,
): Promise<UnfinishedCorridorOrder | null> {
  const order = await db.wbOrder
    .findFirst({
      where: { userId, status: "AWAITING_GAMEPASS", orderSource: { in: [...CORRIDOR_SOURCES] } },
      orderBy: { createdAt: "desc" },
      select: { wbCode: true, amount: true, robloxUsername: true, probableNick: true },
    })
    .catch(() => null);
  if (!order) return null;
  return {
    wbCode: order.wbCode,
    amount: order.amount,
    nick: order.robloxUsername ?? order.probableNick ?? null,
  };
}

/**
 * Текст экрана «сначала закончим то, что оплачено».
 *
 * Слова подобраны так, чтобы это не читалось как отказ: покупатель ничего не
 * нарушил, ему просто напоминают, что за первый заказ он уже заплатил.
 */
export function corridorHoldText(order: UnfinishedCorridorOrder): string {
  return (
    `📦 У тебя есть оплаченный заказ <b>${order.wbCode}</b> на <b>${order.amount} R$</b> — ` +
    `он ждёт только геймпасс.\n\n` +
    `За него ты уже заплатил на Wildberries, второй раз платить не нужно. ` +
    `Давай закончим его — это пара минут, я всё покажу.`
  );
}
