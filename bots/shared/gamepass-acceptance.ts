/* ─────────────────────────────────────────────────────────────────────────────
   Приём геймпассов под заказ — ОДНО правило на все входы.

   Эталон — гейт коридора ВБ (`/api/wb-code/select-gamepass`), каким он стал к
   21.09.2026: для выкупа нужен только Pass ID. Пасс существует, выставлен на
   продажу и его цена совпадает с номиналом ЕГО части — значит принимаем, в
   закрытой он игре или нет. Робуксы уходят владельцу пасса, поэтому получателем
   становится владелец, а не набранный ник; расхождение не отказ, а пометка.

   До 24.09.2026 касса сайта и прямой заказ в ботах проверяли пассы каждый
   по-своему: сайт отказывал, если пасс «чужой», боты не знали набора из
   нескольких пассов вовсе, а гейт ВБ не сверял владельцев частей между собой.
   Теперь все они зовут `acceptGamepasses`, а различаются только тем, как
   достают сведения о пассе и что делать, когда Roblox молчит:

   • ВБ и боты — `onUnreachable: "accept"`: деньги уже у нас (или заказ ещё
     проверит админ перед выкупом), а прайс-гард выкупа всё равно сверит цену.
   • Касса сайта — `"reject"`: деньги ещё не списаны, и честнее попросить
     повторить через минуту, чем принять оплату под непроверенный пасс.

   Модуль чистый — ни базы, ни сети: сведения о пассе приходят функцией.
   ───────────────────────────────────────────────────────────────────────── */

import {
  MAX_AUTO_PARTS,
  expectedGamepassPrice,
  isAllowedPartAmount,
} from "./gamepass-plan";

/** Допуск цены — тот же, что у прайс-гарда выкупа (`PRICE_TOL`). */
export const ACCEPT_PRICE_TOL = 2;

const NICK_RE = /^[A-Za-z0-9_]{3,20}$/;
const PASS_ID_RE = /^\d{1,20}$/;

/** Что нужно знать о пассе. `null` — Roblox не ответил. */
export type AcceptanceDetails = {
  price: number;
  isActive: boolean;
  creatorId?: number | string | null;
  creatorName?: string | null;
} | null;

export interface AcceptancePart {
  gamepassId: string;
  /** Номинал части — робуксы, которые она приносит. */
  amount: number;
}

export type AcceptanceErrorCode =
  | "BAD_SPLIT"
  | "TOO_MANY_PARTS"
  | "NOT_FOR_SALE"
  | "WRONG_PRICE"
  | "MIXED_OWNERS"
  | "ROBLOX_UNAVAILABLE"
  | "NO_NICK";

export type AcceptanceResult =
  | {
      ok: true;
      /** Всегда хотя бы одна часть; одиночный пасс — одна часть на весь заказ. */
      parts: AcceptancePart[];
      /** Заказ закрывается НЕСКОЛЬКИМИ частями (пишутся в `WbOrderGamepass`). */
      split: boolean;
      /** Кому придут робуксы: владелец головного пасса, иначе названный ник. */
      recipient: string | null;
      /** Покупатель назвал другой ник — кого он назвал. */
      ownerSwitchedFrom: string | null;
      /** Пассы, о которых Roblox не ответил (принято без проверки). */
      unverified: string[];
      /** Сведения, которые удалось получить, — чтобы не спрашивать второй раз. */
      details: Map<string, Exclude<AcceptanceDetails, null>>;
    }
  | {
      ok: false;
      code: AcceptanceErrorCode;
      message: string;
      gamepassId?: string;
      expectedPrice?: number;
    };

const fail = (
  code: AcceptanceErrorCode,
  message: string,
  extra: { gamepassId?: string; expectedPrice?: number } = {},
): AcceptanceResult => ({ ok: false, code, message, ...extra });

/**
 * Привести вход к списку частей. Одна часть — это обычный одиночный заказ,
 * а не ошибка: до 24.09.2026 касса отвечала на неё 400 («частей минимум две»),
 * хотя план честно сказал «хватит одного пасса».
 */
export function normalizeParts(
  gamepassId: string,
  rawParts: readonly { gamepassId: unknown; amount: unknown }[] | null | undefined,
  orderAmount: number,
): { ok: true; parts: AcceptancePart[] } | { ok: false; code: AcceptanceErrorCode; message: string } {
  if (!PASS_ID_RE.test(gamepassId)) {
    return { ok: false, code: "BAD_SPLIT", message: "Некорректный номер геймпасса" };
  }
  if (!rawParts || rawParts.length <= 1) {
    const only = rawParts?.[0];
    if (only && (String(only.gamepassId) !== gamepassId || Number(only.amount) !== orderAmount)) {
      return { ok: false, code: "BAD_SPLIT", message: "Единственная часть должна закрывать весь заказ выбранным геймпассом" };
    }
    return { ok: true, parts: [{ gamepassId, amount: orderAmount }] };
  }
  if (rawParts.length > MAX_AUTO_PARTS) {
    return { ok: false, code: "TOO_MANY_PARTS", message: `Заказ можно закрыть максимум ${MAX_AUTO_PARTS} геймпассами` };
  }

  const parts: AcceptancePart[] = [];
  const amountById = new Map<string, number>();
  for (const [index, raw] of rawParts.entries()) {
    const id = String(raw.gamepassId ?? "").trim();
    const amount = Number(raw.amount);
    if (!PASS_ID_RE.test(id)) {
      return { ok: false, code: "BAD_SPLIT", message: `Часть ${index + 1}: некорректный номер геймпасса` };
    }
    if (!isAllowedPartAmount(amount, orderAmount)) {
      return { ok: false, code: "BAD_SPLIT", message: `Часть на ${amount} R$ не годится для заказа на ${orderAmount} R$` };
    }
    // Один пасс может закрыть несколько частей (их выкупают разные доноры), но
    // с ОДНИМ номиналом: цена у пасса одна.
    const known = amountById.get(id);
    if (known !== undefined && known !== amount) {
      return { ok: false, code: "BAD_SPLIT", message: `Геймпасс ${id} указан с разными номиналами — у пасса одна цена` };
    }
    amountById.set(id, amount);
    parts.push({ gamepassId: id, amount });
  }
  if (parts[0].gamepassId !== gamepassId) {
    return { ok: false, code: "BAD_SPLIT", message: "Первая часть должна совпадать с выбранным геймпассом" };
  }
  // Инвариант без допуска: сумма частей — ровно сумма заказа, иначе покупатель
  // получит не то количество робуксов, за которое заплатил.
  const sum = parts.reduce((acc, part) => acc + part.amount, 0);
  if (sum !== orderAmount) {
    return { ok: false, code: "BAD_SPLIT", message: `Сумма частей ${sum} R$ ≠ сумме заказа ${orderAmount} R$` };
  }
  return { ok: true, parts };
}

/**
 * Проверить набор пассов под заказ.
 *
 * Порядок проверок — от дешёвой к дорогой: форма набора, затем Roblox (один
 * запрос на уникальный пасс), затем владельцы и получатель.
 */
export async function acceptGamepasses(input: {
  orderAmount: number;
  gamepassId: string;
  parts?: readonly { gamepassId: unknown; amount: unknown }[] | null;
  /** Ник, который назвал покупатель (может быть пустым при вводе Pass ID). */
  claimedNick?: string | null;
  getDetails: (gamepassId: string) => Promise<AcceptanceDetails>;
  /** Имя владельца по его id — для источников, которые отдают только id. */
  resolveCreatorName?: (creatorId: string) => Promise<string | null>;
  onUnreachable: "accept" | "reject";
}): Promise<AcceptanceResult> {
  const shape = normalizeParts(input.gamepassId, input.parts, input.orderAmount);
  if (!shape.ok) return fail(shape.code, shape.message);
  const { parts } = shape;

  const details = new Map<string, Exclude<AcceptanceDetails, null>>();
  const unverified: string[] = [];
  for (const id of new Set(parts.map((part) => part.gamepassId))) {
    const info = await input.getDetails(id).catch(() => null);
    if (info) details.set(id, info);
    else unverified.push(id);
  }
  if (unverified.length > 0 && input.onUnreachable === "reject") {
    return fail(
      "ROBLOX_UNAVAILABLE",
      "Roblox сейчас не ответил про геймпасс. Подожди минуту и нажми ещё раз — заказ не создан, деньги не списаны.",
      { gamepassId: unverified[0] },
    );
  }

  for (const part of parts) {
    const info = details.get(part.gamepassId);
    if (!info) continue;
    if (info.isActive === false) {
      return fail("NOT_FOR_SALE", `Геймпасс ${part.gamepassId} не выставлен на продажу — включи Item for sale`, {
        gamepassId: part.gamepassId,
      });
    }
    // Номинал неизвестен (код ВБ без номинала) — цену сверить не с чем, как и раньше.
    if (part.amount <= 0) continue;
    const want = expectedGamepassPrice(part.amount);
    if (Math.abs(Number(info.price ?? 0) - want) > ACCEPT_PRICE_TOL) {
      return fail(
        "WRONG_PRICE",
        `Цена геймпасса ${part.gamepassId} должна быть ${want} R$, а стоит ${Number(info.price ?? 0)} R$. ` +
          "Если цену ставил правильно — выключи Managed pricing на странице пасса.",
        { gamepassId: part.gamepassId, expectedPrice: want },
      );
    }
  }

  // Робуксы уходят владельцу КАЖДОГО пасса. Набор из пассов разных аккаунтов
  // раздал бы оплаченное разным людям — такой набор не принимаем.
  const owners = new Set(
    [...details.values()]
      .map((info) => String(info.creatorId ?? "").trim())
      .filter((id) => id && id !== "0"),
  );
  if (owners.size > 1) {
    return fail("MIXED_OWNERS", "Все геймпассы набора должны принадлежать одному аккаунту Roblox — робуксы придут владельцу каждого пасса.");
  }

  const claimed = (input.claimedNick ?? "").trim().replace(/^@/, "");
  const head = details.get(parts[0].gamepassId);
  let owner = (head?.creatorName ?? "").trim();
  if (!owner && head?.creatorId && input.resolveCreatorName) {
    owner = ((await input.resolveCreatorName(String(head.creatorId)).catch(() => null)) ?? "").trim();
  }
  const recipient = NICK_RE.test(owner) ? owner : NICK_RE.test(claimed) ? claimed : null;
  const ownerSwitchedFrom =
    NICK_RE.test(owner) && NICK_RE.test(claimed) && owner.toLowerCase() !== claimed.toLowerCase() ? claimed : null;

  return { ok: true, parts, split: parts.length > 1, recipient, ownerSwitchedFrom, unverified, details };
}

/** Строка в заметку заказа: покупатель назвал один ник, пасс — другого аккаунта. */
export function ownerSwitchNote(opts: { from: string; to: string; gamepassId: string; now?: Date }): string {
  const day = (opts.now ?? new Date()).toISOString().slice(0, 10);
  return `[ПАСС ДРУГОГО НИКА ${day}] назван ${opts.from}, пасс ${opts.gamepassId} принадлежит ${opts.to} — робуксы владельцу пасса`;
}

/**
 * Набор частей, сохранённый в прямой заявке (`DirectIntent.parts`, JSON).
 * Возвращает строки для `WbOrderGamepass` или `null`, если набора нет или он
 * не сходится с суммой: одиночный заказ идёт по старому пути через `gamepassUrl`.
 */
export function intentPartsRows(
  raw: unknown,
  orderAmount: number,
  orderId: string,
): Array<{ orderId: string; gamepassId: string; gamepassUrl: string; amount: number; position: number }> | null {
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const head = raw[0] as { gamepassId?: unknown } | undefined;
  const shape = normalizeParts(String(head?.gamepassId ?? ""), raw as { gamepassId: unknown; amount: unknown }[], orderAmount);
  if (!shape.ok || shape.parts.length < 2) return null;
  return shape.parts.map((part, position) => ({
    orderId,
    gamepassId: part.gamepassId,
    gamepassUrl: `https://www.roblox.com/game-pass/${part.gamepassId}`,
    amount: part.amount,
    position,
  }));
}
