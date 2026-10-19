/* ─────────────────────────────────────────────────────────────────────────────
   «Настройка геймпассов» заказа — ОДНО меню на все поверхности админки.

   Замечание владельца 19.10.2026: «видел фикс по добавлению ключа вручную, но
   только в одном месте (в ТВА в меню в заказах), сделай, чтобы можно было везде
   добавить (как и остальное)… наше меню настройки геймпассов должно быть
   удобным и одинаковым, что в ТВА, что на сайте, что в разных разделах».

   Почему это модуль, а не договорённость: инструментов четыре, живут они на
   пяти поверхностях (карточка TWA, лист заказа TWA, досье сайта, правка сайта,
   полная карточка сайта), и каждая поверхность раньше решала сама, какие из них
   показать, как назвать и в каком порядке. Ключ в итоге оказался в одной.
   Теперь список, слова и предусловия лежат здесь, а поверхность только
   рисует — как `order-presentation.ts` держит единый ТОН карточек.

   Порядок инструментов — по скорости для админа и по решению владельца
   08.09.2026 (в ботах тот же: «сначала ключ, потом инструкция, потом пасс уже
   есть»): ключом мы закрываем заказ САМИ и за одну минуту, ссылка требует, чтобы
   пасс уже существовал, поиск по нику — чтобы Roblox ответил, разбивка нужна
   редко и только большим заказам.

   Предусловия продублированы с сервером (`/api/twa/orders`): интерфейс не
   должен предлагать то, что роут отвергнет, — и наоборот, не должен прятать
   то, что роут разрешает (ровно так ключ и пропал с четырёх поверхностей).
   ───────────────────────────────────────────────────────────────────────── */

export type GamepassToolId = "key" | "link" | "nick" | "split";

export interface GamepassTool {
  id: GamepassToolId;
  /** Значок — он же опознавательный знак инструмента во всех админках. */
  icon: string;
  /** Короткое имя. Одинаковое на сайте и в TWA — иначе это два разных меню. */
  label: string;
  /** Зачем он нужен: читается под именем, в одну строку. */
  hint: string;
}

/** Порядок = порядок показа. Менять только вместе с обеими админками. */
export const GAMEPASS_TOOLS: readonly GamepassTool[] = [
  {
    id: "key",
    icon: "🔑",
    label: "Ключ покупателя",
    hint: "создадим пассы сами — покупателю делать нечего",
  },
  {
    id: "link",
    icon: "🔗",
    label: "Ссылка или ID",
    hint: "пасс уже создан — привязать к заказу",
  },
  {
    id: "nick",
    icon: "🔎",
    label: "Пассы ника",
    hint: "посмотреть, что выставлено на аккаунте",
  },
  {
    id: "split",
    icon: "🧩",
    label: "Разбить выкуп",
    hint: "набор пассов под номинал — заказ не влезает в один аккаунт",
  },
] as const;

export function gamepassTool(id: GamepassToolId): GamepassTool {
  const tool = GAMEPASS_TOOLS.find((item) => item.id === id);
  if (!tool) throw new Error(`[gamepass-tools] неизвестный инструмент: ${id}`);
  return tool;
}

/** Минимум, который нужен о заказе, чтобы решить, что ему можно. */
export interface GamepassToolOrder {
  status: string;
  heldAt?: string | Date | null;
  isDirectOrder?: boolean | null;
  paidAt?: string | Date | null;
  /**
   * Готовый ответ «прямой и не оплачен» — его присылает сервер там, где `paidAt`
   * на клиент не приходит (цель листа заказа в TWA). Если он есть, верим ему.
   */
  unpaidDirect?: boolean;
  robloxUsername?: string | null;
  probableNick?: string | null;
}

/** Статусы, в которых сервер принимает ключ и привязку (`attach-gamepass`). */
export const GAMEPASS_ATTACHABLE_STATUSES = ["AWAITING_GAMEPASS", "REJECTED", "ERROR", "PENDING"];
/** Статусы, в которых сервер принимает разбивку (`set-gamepass-split`). */
export const GAMEPASS_SPLITTABLE_STATUSES = ["AWAITING_GAMEPASS", "REJECTED", "ERROR", "PENDING", "IN_PROGRESS"];

/** Неоплаченный прямой заказ до выкупа не доходит ни одним путём. */
export function isUnpaidDirectOrder(order: GamepassToolOrder): boolean {
  if (typeof order.unpaidDirect === "boolean") return order.unpaidDirect;
  return Boolean(order.isDirectOrder) && !order.paidAt;
}

/**
 * Какие инструменты доступны этому заказу.
 *
 * ❄️ Заморозка выключает всё: каждый из четырёх ставит заказ в очередь выкупа
 * (прямо или следующим шагом), а это ровно то, что заморозка запрещает.
 */
export function gamepassToolsFor(order: GamepassToolOrder): GamepassTool[] {
  if (order.heldAt) return [];
  if (isUnpaidDirectOrder(order)) return [];
  const nick = (order.robloxUsername ?? order.probableNick ?? "").trim();
  return GAMEPASS_TOOLS.filter((tool) => {
    switch (tool.id) {
      case "key":
      case "link":
        return GAMEPASS_ATTACHABLE_STATUSES.includes(order.status);
      // Смотреть пассы ника можно всегда, пока он известен: это чтение.
      case "nick":
        return Boolean(nick) && GAMEPASS_SPLITTABLE_STATUSES.includes(order.status);
      case "split":
        return Boolean(nick) && GAMEPASS_SPLITTABLE_STATUSES.includes(order.status);
      default:
        return false;
    }
  });
}

export function hasGamepassTool(order: GamepassToolOrder, id: GamepassToolId): boolean {
  return gamepassToolsFor(order).some((tool) => tool.id === id);
}

/**
 * Почему инструментов нет — тем же языком, что и отказ сервера. Без этой
 * строки пустое меню выглядит как сломанное.
 */
export function gamepassToolsRefusal(order: GamepassToolOrder): string | null {
  if (order.heldAt) return "❄️ Заказ заморожен — сначала разморозь: выкупать его нельзя ни одним путём.";
  if (isUnpaidDirectOrder(order)) return "💳 Прямой заказ не оплачен — сначала подтверди оплату.";
  if (!GAMEPASS_SPLITTABLE_STATUSES.includes(order.status)) {
    return `В статусе ${order.status} геймпасс не меняют: заказ уже закрыт.`;
  }
  if (!(order.robloxUsername ?? order.probableNick ?? "").trim()) {
    return "Ника Roblox нет — впиши его в правке, тогда появятся поиск пассов и разбивка.";
  }
  return null;
}
