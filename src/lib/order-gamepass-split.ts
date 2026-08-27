/**
 * Разбиение выкупа: один заказ закрывается несколькими геймпассами.
 *
 * Зачем это существует. Прайс-гард (`checkGamepassPrice`) сверяет цену пасса с
 * номиналом ЗАКАЗА: заказ на 3000 R$ ждёт пасс ровно за `ceil(3000/0.7)` = 4286.
 * Пока номинал один, заказ, под который покупатель выставил три пасса по 1000,
 * выкупить нельзя вообще — каждый из них выглядит как «цена не та». Разбиение
 * даёт каждой части собственный номинал, и гард сверяется с ним.
 *
 * Инвариант один и он жёсткий: **сумма номиналов частей равна номиналу заказа**.
 * Он проверяется и при записи разбиения, и повторно перед каждой покупкой —
 * между этими моментами часть могли отредактировать, а разошедшаяся сумма
 * означает, что покупатель получит не то количество робуксов, за которое
 * заплатил. Ослаблять его нельзя: именно он заменяет собой прайс-гард заказа.
 */

import { expectedGamepassPrice, PRICE_TOL } from "./purchase-guard";

/** Ниже этого номинала часть не имеет смысла: пасс дешевле 2 R$ не выставить. */
export const MIN_SPLIT_PART_ROBUX = 10;
/** Больше частей — это уже не «удобнее выкупать», а рассыпанный заказ. */
export const MAX_SPLIT_PARTS = 10;

export type SplitPartInput = {
  gamepassId: string;
  amount: number;
};

export type SplitPart = SplitPartInput & {
  position: number;
  gamepassUrl: string;
  /** Цена, которую обязан показывать этот пасс: `ceil(amount / 0.7)`. */
  expectedPrice: number;
};

export class SplitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SplitError";
  }
}

const ID_RE = /^\d{3,20}$/;

/** Принимает и голый ID, и ссылку — админ копирует то, что под рукой. */
export function parseSplitGamepassId(raw: unknown): string | null {
  const value = String(raw ?? "").trim();
  if (ID_RE.test(value)) return value;
  const m = value.match(/game-pass(?:es)?\/(\d+)/i) ?? value.match(/game_pass(?:es)?\/(\d+)/i);
  return m && ID_RE.test(m[1]) ? m[1] : null;
}

/**
 * Разбор и проверка разбиения. Бросает `SplitError` с текстом, который можно
 * показать админу как есть — каждая проверка объясняет, что именно чинить.
 */
export function buildSplitParts(input: unknown, orderAmount: number): SplitPart[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new SplitError("Нужен список геймпассов");
  }
  if (input.length < 2) {
    throw new SplitError("Разбиение имеет смысл от двух геймпассов — для одного используй обычную привязку");
  }
  if (input.length > MAX_SPLIT_PARTS) {
    throw new SplitError(`Максимум ${MAX_SPLIT_PARTS} геймпассов на заказ`);
  }

  const parts: SplitPart[] = [];
  const seen = new Set<string>();

  input.forEach((raw, index) => {
    const item = (raw ?? {}) as Record<string, unknown>;
    const gamepassId = parseSplitGamepassId(item.gamepassId);
    if (!gamepassId) {
      throw new SplitError(`Часть ${index + 1}: не разобрали ID геймпасса`);
    }
    if (seen.has(gamepassId)) {
      // Один пасс дважды — это двойное списание, а со второго раза Roblox
      // ответит AlreadyOwned, и мы спишем деньги ни за что.
      throw new SplitError(`Геймпасс ${gamepassId} указан дважды`);
    }
    seen.add(gamepassId);

    const amount = Math.trunc(Number(item.amount));
    if (!Number.isFinite(amount) || amount < MIN_SPLIT_PART_ROBUX) {
      throw new SplitError(`Часть ${index + 1}: номинал должен быть целым числом от ${MIN_SPLIT_PART_ROBUX} R$`);
    }

    parts.push({
      gamepassId,
      amount,
      position: index,
      gamepassUrl: `https://www.roblox.com/game-pass/${gamepassId}`,
      expectedPrice: expectedGamepassPrice(amount),
    });
  });

  assertSplitCoversOrder(parts, orderAmount);
  return parts;
}

/**
 * Сумма частей обязана точно совпасть с номиналом заказа.
 *
 * Без допуска намеренно: допуск здесь означал бы, что покупатель систематически
 * получает на несколько робуксов меньше или больше оплаченного. Округление уже
 * заложено в цену каждого пасса (`ceil(amount / 0.7)`), а номиналы — целые.
 */
export function assertSplitCoversOrder(
  parts: readonly { amount: number }[],
  orderAmount: number,
): void {
  const total = parts.reduce((sum, part) => sum + part.amount, 0);
  if (total !== orderAmount) {
    const diff = total - orderAmount;
    throw new SplitError(
      `Сумма частей ${total} R$ ≠ номиналу заказа ${orderAmount} R$ ` +
      `(${diff > 0 ? "лишние" : "не хватает"} ${Math.abs(diff)} R$)`,
    );
  }
}

/** Равные части с остатком в первой — то, что нужно в большинстве случаев. */
export function suggestEqualSplit(orderAmount: number, count: number): number[] {
  if (!Number.isInteger(count) || count < 2 || count > MAX_SPLIT_PARTS) return [];
  const base = Math.floor(orderAmount / count);
  if (base < MIN_SPLIT_PART_ROBUX) return [];
  const parts = Array<number>(count).fill(base);
  parts[0] += orderAmount - base * count;
  return parts;
}

export type StoredPart = {
  id: string;
  gamepassId: string;
  amount: number;
  position: number;
  chargedPrice: number | null;
  purchasedAt: Date | string | null;
};

/** Следующая невыкупленная часть — та, что покупается прямо сейчас. */
export function nextUnpurchasedPart<T extends StoredPart>(parts: readonly T[]): T | null {
  return [...parts].sort((a, b) => a.position - b.position).find((p) => !p.purchasedAt) ?? null;
}

export function splitIsComplete(parts: readonly StoredPart[]): boolean {
  return parts.length > 0 && parts.every((p) => p.purchasedAt);
}

/**
 * Сколько робуксов реально списано по всем купленным частям — база для
 * снимка себестоимости. У обычного заказа это одно списание, здесь — сумма.
 */
export function splitChargedTotal(parts: readonly StoredPart[]): number {
  return parts.reduce((sum, p) => sum + (Number(p.chargedPrice) || 0), 0);
}

/** Совпадает ли живая цена пасса с номиналом его части (тот же допуск). */
export function partPriceMatches(part: { amount: number }, livePrice: number, basePrice?: number | null): {
  ok: boolean;
  expected: number;
} {
  const expected = expectedGamepassPrice(part.amount);
  const validation = Number.isFinite(basePrice) && Number(basePrice) > 0 ? Number(basePrice) : livePrice;
  return { ok: Math.abs(validation - expected) <= PRICE_TOL, expected };
}

export function describeSplitProgress(parts: readonly StoredPart[]): string {
  const done = parts.filter((p) => p.purchasedAt).length;
  return `${done}/${parts.length}`;
}
