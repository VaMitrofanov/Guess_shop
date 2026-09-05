/* ─────────────────────────────────────────────────────────────────────────────
   Что покупателю нужно сделать, чтобы заказ можно было выкупить.

   Одно место, где живут два решения, которые раньше принимались вразнобой —
   инструкцией на сайте, ботом и админом руками:

   1. **Сколько пассов просить создать под номинал.** Один пасс на 2000 стоит
      `ceil(2000 / 0.7)` = 2858 R$, и выкупить его может только донор, у
      которого столько есть целиком. В очереди аккаунты по 2–3 тысячи, поэтому
      номинал 2000 висел дольше остальных. Пара 2143 + 715 стоит ровно те же
      2858 (покупатель не теряет ни робукса), но выкупается двумя донорами
      параллельно. Таблица `SPLIT_PLANS` — единственное место, где это задано.

   2. **Что делать с тем, что у покупателя уже выставлено.** Раньше страница
      спрашивала «создай пасс ровно за N» и не смотрела на аккаунт вовсе. При
      этом заказ на 1000 закрывается двумя выкупами пасса на 715 (по 500 на
      руки) — просить создавать что-то ещё незачем. Здесь это считается
      разменом без остатка: тот же приём, что в `planSplitFor`, но без её
      требования «частей минимум две» и с ответом «достроить одним пассом»,
      когда точная сумма не набирается вовсе.

   Инвариант общий с разбивкой: сумма номиналов частей равна номиналу заказа
   ровно, без допуска. Цену каждой части считает прайс-гард
   (`expectedGamepassPrice`), своей арифметики здесь нет.
   ───────────────────────────────────────────────────────────────────────── */

import { MIN_SPLIT_PART_ROBUX } from "./order-gamepass-split";
import { expectedGamepassPrice } from "./purchase-guard";

/**
 * Номиналы, которые выдаются НЕСКОЛЬКИМИ пассами, и на какие части.
 * Сумма частей обязана равняться ключу — это проверяет тест.
 */
export const SPLIT_PLANS: Record<number, number[]> = {
  2000: [1500, 500],
};

/**
 * Сколько частей заказ может получить без участия админа.
 *
 * Каждая часть — отдельный выкуп с отдельного донора: повтор одного пасса с
 * того же аккаунта Roblox вернёт `AlreadyOwned`. Четыре части — потолок, за
 * которым набор перестаёт быть «удобнее выкупать» и становится работой.
 */
export const MAX_AUTO_PARTS = 4;

/** Номинал, который закрывает пасс с такой ценой: обратная сторона `ceil(x / 0.7)`. */
export const netFromPrice = (price: number): number => Math.floor(price * 0.7);

export interface PlanOptions {
  /** Сколько частей заказ может получить. На сайте это всегда 1: оформление и
   *  оплата несут один `gamepassId`, и набор из двух пассов там был бы тупиком. */
  maxParts?: number;
  /** Разрешена ли раскладка номинала на пару пассов (`SPLIT_PLANS`). */
  splitPlan?: boolean;
}

/** Пассы, которые мы просим создать под этот номинал (в робуксах НА РУКИ). */
export function idealTargetsFor(amount: number, splitPlan = true): number[] {
  const plan = splitPlan ? SPLIT_PLANS[amount] : undefined;
  if (plan && plan.reduce((sum, part) => sum + part, 0) === amount) return [...plan];
  return [amount];
}

export interface OwnedPass {
  gamepassId: string;
  name: string;
  price: number;
  image?: string | null;
  isForSale?: boolean;
  /** Активный заказ, который уже стоит на этом пассе: занятый пасс не берём. */
  busyWith?: string | null;
}

export interface PlanPart {
  gamepassId: string;
  name: string;
  price: number;
  image?: string | null;
  /** Номинал этой части — робуксы, которые она приносит покупателю. */
  amount: number;
  /** Этот же пасс уже стоит в наборе выше: выкупать его будет другой донор. */
  repeat: boolean;
}

export interface CreateTarget {
  /** Цена, которую надо выставить в Roblox. */
  price: number;
  /** Сколько робуксов с неё придёт на руки. */
  amount: number;
}

export type CheckPlan =
  /** Заказ закрывается тем, что уже выставлено, и каждый пасс берётся один раз. */
  | { kind: "ready"; parts: PlanPart[] }
  /** Закрывается, но какой-то пасс придётся выкупить несколько раз. */
  | { kind: "assembled"; parts: PlanPart[] }
  /** Точной суммы не набрать; засчитываем что есть и просим создать ОДИН пасс. */
  | { kind: "build"; parts: PlanPart[]; create: CreateTarget }
  /** Годных пассов нет вовсе — создаём набор с нуля. */
  | { kind: "empty"; create: CreateTarget[] };

const target = (amount: number): CreateTarget => ({ amount, price: expectedGamepassPrice(amount) });

/** Пассы, которые вообще можно взять в заказ: продаются, свободны, не дороже номинала. */
function usableCandidates(owned: readonly OwnedPass[], orderAmount: number): OwnedPass[] {
  return owned.filter((pass) => {
    if (pass.isForSale === false) return false;
    if (pass.busyWith) return false;
    const amount = netFromPrice(pass.price);
    return amount >= MIN_SPLIT_PART_ROBUX && amount <= orderAmount;
  });
}

/**
 * Размен `total` номиналами `amounts` без остатка, минимальным числом частей.
 *
 * Своя ДП, а не `planSplitFor`, по двум причинам: там жёстко «частей минимум
 * две» (нам нужен и случай одного пасса ровно под номинал), и там нельзя
 * спросить «а на сколько частей хватит, если одну я досоздам».
 */
interface ChangeTable {
  /** `best[v]` — минимум частей, которыми набирается ровно `v`. */
  best: number[];
  /** `from[v]` — номинал последней части в этом наборе. */
  from: number[];
}

/** Одна таблица размена на весь разбор: перебор остатков ниже читает её же. */
function changeTable(total: number, amounts: readonly number[]): ChangeTable | null {
  if (!Number.isInteger(total) || total <= 0 || total > 200_000) return null;
  const coins = [...new Set(amounts)].filter((a) => Number.isInteger(a) && a > 0 && a <= total);
  if (coins.length === 0) return null;

  const best = new Array<number>(total + 1).fill(Infinity);
  const from = new Array<number>(total + 1).fill(0);
  best[0] = 0;
  for (let value = 1; value <= total; value++) {
    for (const coin of coins) {
      if (coin > value) continue;
      const candidate = best[value - coin] + 1;
      if (candidate < best[value]) { best[value] = candidate; from[value] = coin; }
    }
  }
  return { best, from };
}

function reconstruct(table: ChangeTable, total: number, maxParts: number): number[] | null {
  if (maxParts <= 0 || !Number.isFinite(table.best[total]) || table.best[total] > maxParts) return null;
  const picked: number[] = [];
  for (let rest = total; rest > 0; rest -= table.from[rest]) picked.push(table.from[rest]);
  // Крупные части первыми: их выкупать дороже, срываться лучше на мелкой.
  return picked.sort((a, b) => b - a);
}

/**
 * Раздача конкретных пассов под выбранные номиналы.
 *
 * Одинаковые номиналы разводятся по РАЗНЫМ пассам, пока разные есть: два пасса
 * по 500 лучше, чем один и тот же дважды — меньше возни с донорами.
 */
function assign(amounts: readonly number[], candidates: readonly OwnedPass[]): PlanPart[] {
  const byAmount = new Map<number, OwnedPass[]>();
  for (const pass of candidates) {
    const amount = netFromPrice(pass.price);
    const bucket = byAmount.get(amount);
    if (bucket) bucket.push(pass);
    else byAmount.set(amount, [pass]);
  }
  const cursor = new Map<number, number>();
  const seen = new Set<string>();
  return amounts.map((amount) => {
    const pool = byAmount.get(amount) ?? [];
    const index = cursor.get(amount) ?? 0;
    cursor.set(amount, index + 1);
    const pass = pool[index % Math.max(1, pool.length)];
    const repeat = seen.has(pass.gamepassId);
    seen.add(pass.gamepassId);
    return {
      gamepassId: pass.gamepassId,
      name: pass.name,
      price: pass.price,
      image: pass.image ?? null,
      amount,
      repeat,
    };
  });
}

/**
 * Что делать с этим заказом, глядя на то, что у покупателя уже выставлено.
 *
 * Порядок веток — от самого дешёвого для покупателя действия к самому дорогому:
 * ничего не делать → подтвердить набор с повтором → создать один пасс →
 * создать всё с нуля.
 */
export function planFromOwned(
  orderAmount: number,
  owned: readonly OwnedPass[],
  options: PlanOptions = {},
): CheckPlan {
  const maxParts = options.maxParts ?? MAX_AUTO_PARTS;
  const splitPlan = options.splitPlan ?? true;
  const empty: CheckPlan = { kind: "empty", create: idealTargetsFor(orderAmount, splitPlan).map(target) };
  if (!Number.isInteger(orderAmount) || orderAmount < MIN_SPLIT_PART_ROBUX) return empty;

  const candidates = usableCandidates(owned, orderAmount);
  if (candidates.length === 0) return empty;

  const amounts = candidates.map((pass) => netFromPrice(pass.price));
  const table = changeTable(orderAmount, amounts);
  if (!table) return empty;

  const full = reconstruct(table, orderAmount, maxParts);
  if (full) {
    const parts = assign(full, candidates);
    return { kind: parts.some((part) => part.repeat) ? "assembled" : "ready", parts };
  }

  // Точной суммы не собрать. Ищем, сколько можно закрыть уже выставленным,
  // чтобы остаток закрылся ОДНИМ новым пассом: два новых пасса вместо одного —
  // это уже не «достроить», а сделать заново.
  let bestRest = 0;
  let bestParts = Infinity;
  for (let rest = MIN_SPLIT_PART_ROBUX; rest <= orderAmount - MIN_SPLIT_PART_ROBUX; rest++) {
    const covered = table.best[orderAmount - rest];
    if (!Number.isFinite(covered) || covered > maxParts - 1) continue;
    // При равном числе частей берём БОЛЬШИЙ остаток: покупателю в любом случае
    // создавать один пасс, а нашим донорам достаётся меньше выкупов.
    if (covered < bestParts || (covered === bestParts && rest > bestRest)) {
      bestParts = covered;
      bestRest = rest;
    }
  }
  if (bestRest > 0) {
    const cover = reconstruct(table, orderAmount - bestRest, maxParts - 1)!;
    return { kind: "build", parts: assign(cover, candidates), create: target(bestRest) };
  }

  return empty;
}

/** Робуксы, которые уже закрыты выставленными пассами. */
export function coveredRobux(plan: CheckPlan): number {
  if (plan.kind === "empty") return 0;
  return plan.parts.reduce((sum, part) => sum + part.amount, 0);
}

/** Пассы, которые покупателю ещё предстоит создать. */
export function targetsToCreate(plan: CheckPlan): CreateTarget[] {
  if (plan.kind === "empty") return plan.create;
  if (plan.kind === "build") return [plan.create];
  return [];
}
