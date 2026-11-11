/* ─────────────────────────────────────────────────────────────────────────────
   Корзина WB: несколько наших заказов одной покупкой (01.11.2026).

   WB заводит на каждую карточку отдельный заказ и отдельный чат; общий у них —
   `orderUid`. Здесь — чистое правило «что показать покупателю про соседние
   заказы» (страница инструкции) и «какая метка у заказа» (админка). Prisma и
   react сюда не попадают.
   ───────────────────────────────────────────────────────────────────────── */

type BasketItemState =
  /** Оформлен: ник есть, заказ в работе или выкуплен. */
  | "done"
  /** Ссылка выдана, но заказ не оформлен — его и предлагаем. */
  | "todo"
  /** Доставку ещё не закрыли — ссылки нет, придёт в чат этого заказа. */
  | "waiting"
  | "cancelled";

export interface BasketItem {
  index: number;
  total: number;
  amount: number | null;
  state: BasketItemState;
  /** Код заказа — только у `todo` и только своему же покупателю (у кого код соседа). */
  code: string | null;
  nick: string | null;
  self: boolean;
}

export interface BasketRow {
  wbOrderId: string;
  amount: number | null;
  cancelled: boolean;
  code: string | null;
  orderStatus: string | null;
  nick: string | null;
  gamepassId: string | null;
}

/** Порядок как у WB: по `wbOrderId` (строкой, поэтому сначала по длине). */
function ordered<T extends { wbOrderId: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.wbOrderId.length - b.wbOrderId.length || a.wbOrderId.localeCompare(b.wbOrderId));
}

export function basketItemState(row: BasketRow): BasketItemState {
  if (row.cancelled || row.orderStatus === "REJECTED") return "cancelled";
  if (!row.code) return "waiting";
  // Заказ оформлен, когда указан ник и есть пасс или он ушёл дальше «ждём пасс».
  if (row.orderStatus && row.orderStatus !== "AWAITING_GAMEPASS") return "done";
  if (row.nick && row.gamepassId) return "done";
  return "todo";
}

/**
 * Что покупатель видит про свою корзину. `selfCode` — код, по которому он
 * пришёл. Одиночный заказ — пустой список: «1 из 1» никому не нужно.
 */
export function buildBasket(rows: BasketRow[], selfCode: string): BasketItem[] {
  if (rows.length < 2) return [];
  const list = ordered(rows);
  return list.map((row, i) => {
    const state = basketItemState(row);
    return {
      index: i + 1,
      total: list.length,
      amount: row.amount,
      state,
      code: state === "todo" ? row.code : null,
      nick: row.nick,
      self: row.code === selfCode,
    };
  });
}

/** Следующий заказ, который можно оформить сейчас. */
export function nextBasketItem(items: BasketItem[]): BasketItem | null {
  return items.find((item) => !item.self && item.state === "todo") ?? null;
}

/** Ссылка на оформление соседнего заказа: тот же ник — подставлен, другой — пусто. */
export function basketItemHref(item: BasketItem, nick: string | null): string {
  const base = `/guide?source=wb&skip=1&code=${encodeURIComponent(item.code ?? "")}`;
  return nick ? `${base}&username=${encodeURIComponent(nick)}` : base;
}

/** Метка заказа в админке: «🧺 1/2» и признак «2 аккаунта». */
export function basketLabel(position: { index: number; total: number } | null, nicks: Array<string | null>): {
  text: string;
  twoAccounts: boolean;
} | null {
  if (!position || position.total < 2) return null;
  const known = nicks.filter((n): n is string => Boolean(n)).map((n) => n.toLowerCase());
  return { text: `🧺 ${position.index}/${position.total}`, twoAccounts: new Set(known).size > 1 };
}
