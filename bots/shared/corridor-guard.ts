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

/**
 * «Всё равно куплю» — согласие, которое надо запомнить.
 *
 * Экран-рельса живёт в `startDirectFlow`/`handleStartDirect`, а дальше поток
 * идёт своими callback-ами (`dp:` в Telegram, `direct_pack` во ВКонтакте), и
 * они гарда не спрашивали вовсе. Инлайн-клавиатуры в обоих мессенджерах живут
 * вечно: нажатие на СТАРОЕ сообщение с паками — законный вход мимо рельсы, и
 * человек с оплаченным заказом коридора уезжал сразу в оплату.
 *
 * Гард на самом `dp:` без памяти о согласии зациклил бы «Всё равно куплю»:
 * рельса → паки → тап по паку → снова рельса. Поэтому согласие держится
 * отдельно и живёт полчаса — дольше любого живого прохода по паку и заметно
 * короче, чем сам заказ коридора.
 *
 * Память процессная: у TG и VK это разные контейнеры, и общий тут — код, а не
 * состояние. Перезапуск бота согласие теряет — покупатель увидит рельсу ещё
 * раз, это дешевле, чем незамеченная вторая оплата.
 */
export const CORRIDOR_OVERRIDE_TTL_MS = 30 * 60 * 1000;

export interface CorridorOverride {
  /** Человек нажал «Всё равно купить напрямую» — рельсу ему больше не показываем. */
  allow(id: string | number): void;
  /** Согласие ещё действует? Протухшее удаляется на месте. */
  taken(id: string | number): boolean;
  /** Проход завершён (заказ создан или отменён) — согласие больше не нужно. */
  clear(id: string | number): void;
}

export function createCorridorOverride(ttlMs = CORRIDOR_OVERRIDE_TTL_MS): CorridorOverride {
  const until = new Map<string, number>();
  const key = (id: string | number) => String(id);
  return {
    allow(id) { until.set(key(id), Date.now() + ttlMs); },
    taken(id) {
      const expires = until.get(key(id));
      if (expires === undefined) return false;
      if (expires <= Date.now()) { until.delete(key(id)); return false; }
      return true;
    },
    clear(id) { until.delete(key(id)); },
  };
}
