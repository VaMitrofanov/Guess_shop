/* ─────────────────────────────────────────────────────────────────────────────
   Что сторожить у заказа, который стоит в очереди на выкуп.

   Заявка проверяет пасс на входе, прайс-гард — в момент покупки, но между ними
   лежит очередь, и в ней заказ живёт часами. Цену пасса можно поднять в любую
   минуту, поэтому сторож (`watchQueuedGamepassPrices`) перепроверяет её сам.

   Эталон сравнения — номинал ЧАСТИ, а не заказа. У разбитого заказа пасс на
   715 R$ при номинале 1000 R$ — это норма, а не подмена: части закрывают свои
   номиналы, и их сумма равна номиналу заказа. 10.09.2026 заказ NE4SWXJ приняли
   двумя пассами по 715 R$ и тут же получили «🔴 цену пасса подменили: 715 R$
   вместо 1429 R$» — покупатель не менял ничего, сравнение шло не с тем числом.
   ───────────────────────────────────────────────────────────────────────── */

export interface PriceWatchPart {
  gamepassId: string;
  /** Номинал робуксов, который закрывает эта часть. */
  amount: number;
  /** Куплена — цена уже списана, сторожить нечего. */
  purchasedAt: Date | null;
  position: number;
}

export interface PriceWatchTarget {
  gamepassId: string;
  /** Номинал, с которым сверяется цена пасса. */
  amount: number;
  /** «часть 1 из 2» — у неразбитого заказа null. */
  partLabel: string | null;
}

/**
 * Строка-маркер уже стоит на ЭТОМ пассе — повторный алерт каждые пятнадцать
 * минут ничего не добавит. Проверка именно по пассу, а не по заказу: у
 * разбитого заказа пассов несколько, и молчать про второй из-за первого нельзя.
 */
export function priceWatchFlagged(note: string, gamepassId: string): boolean {
  return note
    .split("\n")
    .some((line) =>
      (line.includes("[ЦЕНА-ИЗМЕНИЛАСЬ") || line.includes("[ПАСС-СНЯТ")) && line.includes(gamepassId));
}

/**
 * Повторы одного пасса в разбивке идут с ОДНИМ номиналом (цена у пасса одна),
 * поэтому проверяются один раз, а не по разу на часть.
 */
export function priceWatchTargets(order: {
  amount: number;
  gamepassId: string | null;
  splitGamepasses: PriceWatchPart[];
}): PriceWatchTarget[] {
  const parts = order.splitGamepasses;
  if (parts.length === 0) {
    return order.gamepassId ? [{ gamepassId: order.gamepassId, amount: order.amount, partLabel: null }] : [];
  }

  const seen = new Set<string>();
  const targets: PriceWatchTarget[] = [];
  for (const part of parts) {
    if (part.purchasedAt) continue;
    const key = `${part.gamepassId}:${part.amount}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({
      gamepassId: part.gamepassId,
      amount: part.amount,
      partLabel: `часть ${part.position + 1} из ${parts.length}`,
    });
  }
  return targets;
}
