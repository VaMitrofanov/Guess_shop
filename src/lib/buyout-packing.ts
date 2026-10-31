/* ─────────────────────────────────────────────────────────────────────────────
   Набор заказов под баланс выкупного аккаунта.

   Донора как одной большой кассы больше нет: с 30.08.2026 выкуп идёт с мелких
   аккаунтов, которые пополняются на фиксированную сумму. Значит вопрос
   закупщика звучит не «сколько всего в очереди», а «что положить в аккаунт,
   на котором лежит вот столько».

   Порядок — по СТАРШИНСТВУ очереди, а не по цене. Плотнее набивает сортировка
   по убыванию цены (FFD), но она уводит старейший заказ в хвост, а очередь
   упорядочена по возрасту именно затем, чтобы он шёл первым. Аккаунт стоит
   копейки, покупатель на четвёртых сутках — нет.

   Заказ дороже баланса не режется и не прячется: он выносится отдельно. Заказ
   на 2 000 R$ стоит 2 858 грязными и в аккаунт на 2 000 не влезет никогда;
   молча выкинуть его значило бы потерять его из виду.
   ───────────────────────────────────────────────────────────────────────── */

export interface Packable {
  /** Грязные робуксы: цена геймпасса, которая спишется с аккаунта. */
  expectedPrice: number;
}

export interface BuyoutFit<T extends Packable> {
  /** Что кладём в этот аккаунт — в порядке очереди. */
  picked: T[];
  /** Заказы дешевле баланса, но в этот аккаунт уже не влезшие. */
  rest: T[];
  /** Заказы дороже баланса целиком: им нужен аккаунт крупнее. */
  unfit: T[];
  /** Сколько спишется. */
  gross: number;
  /** Сколько останется на аккаунте. */
  left: number;
  /** Заполненность 0…1 — по ней видно, что баланс подобран неудачно. */
  fill: number;
  /** Сколько ещё таких же аккаунтов нужно, чтобы разобрать остаток. */
  moreAccounts: number;
}

/**
 * Набрать заказы под один баланс и сказать, сколько ещё таких аккаунтов надо.
 *
 * `orders` ожидается уже упорядоченным по старшинству очереди — так их отдаёт
 * выгрузка (`orderByForTab` для BUYOUT сортирует по `pendingAt asc`).
 */
export function fitToBalance<T extends Packable>(orders: T[], balance: number): BuyoutFit<T> {
  const picked: T[] = [];
  const rest: T[] = [];
  const unfit: T[] = [];
  let gross = 0;

  for (const order of orders) {
    if (order.expectedPrice > balance) { unfit.push(order); continue; }
    if (gross + order.expectedPrice <= balance) {
      picked.push(order);
      gross += order.expectedPrice;
    } else {
      rest.push(order);
    }
  }

  // Сколько аккаунтов того же размера съест остаток — тем же правилом,
  // чтобы число под кнопкой не расходилось с тем, что она наберёт.
  let moreAccounts = 0;
  let remaining = [...rest];
  while (remaining.length > 0 && moreAccounts < 100) {
    moreAccounts += 1;
    const next = fitOnce(remaining, balance);
    if (next.length === remaining.length) break;
    remaining = next;
  }

  return {
    picked,
    rest,
    unfit,
    gross,
    left: Math.max(0, balance - gross),
    fill: balance > 0 ? gross / balance : 0,
    moreAccounts,
  };
}

/** Один проход набора: возвращает то, что не поместилось. */
function fitOnce<T extends Packable>(orders: T[], balance: number): T[] {
  const left: T[] = [];
  let spent = 0;
  for (const order of orders) {
    if (spent + order.expectedPrice <= balance) spent += order.expectedPrice;
    else left.push(order);
  }
  return left;
}

/** Быстрые кнопки под типовые пополнения аккаунта. */
export const BALANCE_PRESETS = [2000, 3000, 5000, 10000] as const;
