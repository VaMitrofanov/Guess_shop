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

/**
 * Ядро живёт в `bots/shared`, а не в `src/lib`: боты не умеют импортировать из
 * `src/`, а веб из `bots/shared` умеет. Разбор «что делать с этим заказом»
 * читают ОБА контура — инструкция на сайте и ветка ника в TG/VK, — и копия
 * здесь означала бы, что сайт и бот просят у покупателя разные пассы.
 * `src/lib/gamepass-plan.ts` — переэкспорт этого файла.
 */

/**
 * Минимальный номинал части. Тот же порог, что у ручной разбивки заказа
 * (`src/lib/order-gamepass-split.ts` переэкспортирует эту константу): часть
 * мельче десяти робуксов не окупает возни с отдельным донором.
 */
export const MIN_SPLIT_PART_ROBUX = 10;

/**
 * Цена пасса, с которой покупателю придёт ровно `amount` робуксов: Roblox
 * забирает 30 % с продажи. Эталон прайс-гарда выкупа — `src/lib/purchase-guard.ts`
 * берёт формулу отсюда, чтобы «сколько просить» и «за сколько выкупаем» не
 * разъехались.
 */
export const expectedGamepassPrice = (amount: number): number => Math.ceil(amount / 0.7);

/**
 * Ёмкость ОДНОГО донора в робуксах «на руки».
 *
 * Аккаунты выкупа держат 1500 чистых (≈2143 грязных: `ceil(1500 / 0.7)`), и это
 * не круглая цифра «для удобства», а физический потолок части: пасс дороже
 * донор не купит вовсе. Отсюда же следует, почему 1500 лучше отдавать ОДНИМ
 * пассом: три пасса по 500 стоят 715 × 3 = 2145, пара 1000 + 500 — 2144, и в
 * 2143 не влезает ни та, ни другая (округление цены вверх съедает баланс).
 */
export const DONOR_NET_CAPACITY = 1500;

/**
 * Шаг номинала части. Кратность 500 держит остатки на донорах пригодными:
 * часть на 70 или 430 робуксов оставляет на аккаунте огрызок, которым уже не
 * закрыть ни одну следующую часть.
 */
export const SPLIT_STEP = 500;

/** Мельче этого автоматика части не делает (руками админ по-прежнему может всё). */
export const MIN_AUTO_PART_ROBUX = SPLIT_STEP;

/**
 * Разрешён ли такой номинал части.
 *
 * Весь заказ одной частью законен всегда: номиналы 300, 800 и 1200 существуют
 * в каталоге ВБ (и их там больше тысячи), на 500 не делятся, но целиком
 * помещаются в одного донора — дробить их не нужно и нечем.
 *
 * Некратная часть законна в одном случае: заказ больше донора (его всё равно
 * дробить) и часть несёт «хвост» самого заказа (`amount ≡ orderAmount mod 500`).
 * Заказ на 1700 иначе не собрать вовсе — до 24.09.2026 разбивка просила создать
 * 850 + 850, а это же правило их отвергало, и инструкция бесконечно просила
 * создать те же два пасса. Заказ, который влезает в донора (1200), по-прежнему
 * идёт ОДНИМ пассом, а не 500 + 700.
 */
export function isAllowedPartAmount(amount: number, orderAmount: number): boolean {
  if (!Number.isInteger(amount) || amount <= 0) return false;
  if (amount > Math.min(orderAmount, DONOR_NET_CAPACITY)) return false;
  if (amount === orderAmount) return true;
  if (amount < MIN_AUTO_PART_ROBUX) return false;
  if (amount % SPLIT_STEP === 0) return true;
  return orderAmount > DONOR_NET_CAPACITY && amount % SPLIT_STEP === orderAmount % SPLIT_STEP;
}

/**
 * Разложить номинал на части, каждую из которых покупает один донор.
 *
 * Правило: пока номинал влезает в донора — не дробим вовсе; выше — куски по
 * 1500, остаток последней частью. Огрызок мельче шага (1700 → 1500 + 200) не
 * выпускаем: последний кусок вместе с огрызком делится на 1000 + остаток
 * (1700 → 1000 + 700). Так некратной остаётся ровно одна часть, и она
 * проходит `isAllowedPartAmount` — раньше здесь было 850 + 850, которые это
 * правило отвергало, и заказ зацикливался на «создай пассы».
 */
export function splitIntoDonorChunks(amount: number): number[] {
  if (!Number.isInteger(amount) || amount <= 0) return [];
  if (amount <= DONOR_NET_CAPACITY) return [amount];
  const chunks: number[] = [];
  let rest = amount;
  while (rest > DONOR_NET_CAPACITY) {
    chunks.push(DONOR_NET_CAPACITY);
    rest -= DONOR_NET_CAPACITY;
  }
  if (rest === 0) return chunks;
  if (rest >= MIN_AUTO_PART_ROBUX) {
    chunks.push(rest);
    return chunks;
  }
  chunks.pop();
  return [...chunks, DONOR_NET_CAPACITY - SPLIT_STEP, SPLIT_STEP + rest];
}

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
  /** Сколько частей заказ может получить (по умолчанию `MAX_AUTO_PARTS`). */
  maxParts?: number;
  /** Разрешена ли раскладка номинала на пару пассов (`SPLIT_PLANS`). */
  splitPlan?: boolean;
}

/** Пассы, которые мы просим создать под этот номинал (в робуксах НА РУКИ). */
export function idealTargetsFor(amount: number, splitPlan = true): number[] {
  if (!splitPlan) return [amount];
  const chunks = splitIntoDonorChunks(amount);
  return chunks.length > 0 ? chunks : [amount];
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
    // Кратность 500 и потолок донора — те же, что у создаваемых частей: пасс на
    // 430 робуксов «подходит» только на бумаге, а выкупать его придётся с
    // отдельного донора, у которого после этого останется непригодный огрызок.
    return isAllowedPartAmount(netFromPrice(pass.price), orderAmount);
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
  // Кандидаты на недостающую часть: кратные шагу и те, что несут «хвост»
  // заказа (1700 = 1000 + 700) — других частей `isAllowedPartAmount` не пустит.
  const tail = orderAmount % SPLIT_STEP;
  const restCandidates: number[] = [];
  for (let base = MIN_AUTO_PART_ROBUX; base <= orderAmount - MIN_AUTO_PART_ROBUX; base += SPLIT_STEP) {
    restCandidates.push(base);
    if (tail > 0 && base + tail <= orderAmount - MIN_AUTO_PART_ROBUX) restCandidates.push(base + tail);
  }
  for (const rest of restCandidates) {
    // Достраиваем только «рабочей» частью в пределах донора.
    if (!isAllowedPartAmount(rest, orderAmount)) continue;
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

/**
 * Набор, который создаём САМИ, когда у нас есть ключ покупателя.
 *
 * Отличается от `targetsToCreate` намеренно, и вот почему. Разбор плана
 * экономит РУЧНОЙ труд покупателя: он засчитывает всё, что уже выставлено, и
 * просит создать только недостающее — потому что каждый пасс человек делает
 * руками. С ключом руками не делает никто, и экономить нечего: значение имеет
 * только то, насколько удобно НАМ выкупать.
 *
 * Живой случай (07.09.2026, заказ TST2000): на аккаунте лежал пасс на 20 R$
 * (14 на руки), план его засчитал и попросил создать один пасс на 2838 —
 * получилась пара «2838 + 20» вместо «2143 + 715». Первый выкупается только с
 * крупного донора, второй — это отдельный поход к донору ради 14 робуксов.
 * Поэтому по ключу создаётся ЭТАЛОННЫЙ набор (`SPLIT_PLANS`), а что лежит на
 * аккаунте — не важно: лишний пасс никому не мешает и ничего не стоит.
 */
export function createTargetsFor(amount: number, splitPlan = true): CreateTarget[] {
  return idealTargetsFor(amount, splitPlan).map(target);
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
