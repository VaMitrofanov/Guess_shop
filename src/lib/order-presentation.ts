/* ─────────────────────────────────────────────────────────────────────────────
   Как заказ выглядит — одно правило на TWA и на сайт.

   До В3 логика «какой у заказа бейдж, какое главное действие и что написано в
   строке-флаге» жила единственной копией внутри `OrdersScreen` (TWA). Когда тот
   же цикл выкупа появился на сайте, копия неизбежно бы разошлась: один экран
   предлагал бы «Выкуплено» там, где второй — «Вернуть».

   Модуль намеренно чистый: ни prisma, ни react, ни цветов. Он возвращает
   ТОН («green», «red», …), а каждый экран красит тон своей палитрой — тёмной
   TWA или токенами `--rb-*` сайта. Это единственный способ держать одно правило
   в двух разных цветовых мирах.
   ───────────────────────────────────────────────────────────────────────── */

import { expectedGamepassPrice } from "@/lib/purchase-guard";

export type Tone = "green" | "yellow" | "orange" | "red" | "blue" | "ice" | "accent" | "muted";

/** Минимум, который presentation-функции обязаны знать о заказе. */
export interface PresentableOrder {
  amount: number;
  status: string;
  wbCode: string;
  gamepassUrl: string | null;
  splitGamepasses?: { purchasedAt: string | null }[] | null;
  heldAt: string | null;
  heldReason?: string | null;
  isDirectOrder: boolean;
  isFavorite?: boolean;
  orderSource: string;
  buyoutErrorCode: string | null;
  createdAt: string;
  pendingAt: string | null;
  robloxUsername: string | null;
  gpWatchDeclinedAt?: string | null;
  remindersSent?: number | null;
  vkUnreachable?: boolean | null;
  user?: { vkId?: string | null } | null;
}

/** Результат живой проверки геймпасса (`gp-live-check`). */
export interface GpLive {
  isForSale?: boolean | null;
  livePrice?: number | null;
  priceMismatch?: boolean | null;
  expected?: number | null;
  /** Код заказа, в котором этот пасс уже выкуплен. */
  reusedIn?: string | null;
}

/** Грязные робуксы: цена пасса, которая спишется с донора. */
export const grossOf = (amount: number): number => expectedGamepassPrice(amount);

/* ── Робуксы после выкупа ────────────────────────────────────────────────────
   Roblox держит выручку за геймпасс в Pending ~5 дней, и клиенту эту дату
   называют в первом же сообщении после выкупа. Админ до 08.09.2026 её нигде не
   видел: и карточка, и алерт поддержки говорили только «выкуплен», а вопрос у
   человека был «когда придут» (49ANALQ). Правило живёт здесь, потому что это
   ПРЕДСТАВЛЕНИЕ заказа — им пользуются и экраны, и `twa-notify`.
   ────────────────────────────────────────────────────────────────────────── */

export const ROBUX_UNLOCK_DAYS = 5;

export function robuxUnlockAt(completedAt: string | Date): Date {
  const at = completedAt instanceof Date ? completedAt : new Date(completedAt);
  return new Date(at.getTime() + ROBUX_UNLOCK_DAYS * 86_400_000);
}

/** Дата разблокировки словами — одинаково в боте, в алерте и на экране. */
export function fmtUnlockDate(d: Date): string {
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: "Europe/Moscow" });
}

/* ── Возраст ─────────────────────────────────────────────────────────────────
   Шкала считает от «сколько это ждёт человека»: до двух часов — норма рабочего
   ритма, до полусуток — стоит посмотреть, до суток — уже плохо, дальше красное.
   Пороги названы здесь один раз: по ним красятся и карточка TWA, и строка сайта.
   ────────────────────────────────────────────────────────────────────────── */

export function fmtAge(iso: string | null | undefined): string {
  if (!iso) return "—";
  const mins = (Date.now() - new Date(iso).getTime()) / 60_000;
  if (mins < 1) return "< 1 мин";
  if (mins < 60) return `${Math.round(mins)} мин`;
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (days === 0) return `${hours}ч`;
  const rest = hours % 24;
  return rest > 0 ? `${days}д ${rest}ч` : `${days}д`;
}

export function ageTone(iso: string | null | undefined): Tone {
  if (!iso) return "muted";
  const mins = (Date.now() - new Date(iso).getTime()) / 60_000;
  if (mins < 120) return "green";
  if (mins < 720) return "yellow";
  if (mins < 1440) return "orange";
  return "red";
}

/** Возраст, относящийся к делу: в очереди выкупа — с момента попадания в неё. */
export function ageBasis(order: Pick<PresentableOrder, "status" | "pendingAt" | "createdAt">): string {
  return ["PENDING", "IN_PROGRESS"].includes(order.status) && order.pendingAt
    ? order.pendingAt
    : order.createdAt;
}

/* ── Бейдж состояния ─────────────────────────────────────────────────────── */

/** Порог, после которого заказ без ссылки перестаёт быть «новым» (см. order-queue). */
const NEW_CUTOFF_HOURS = 40;

export function orderBadge(order: PresentableOrder): { label: string; tone: Tone } | null {
  const created = new Date(order.createdAt).getTime();
  const cutoff = Date.now() - NEW_CUTOFF_HOURS * 3600_000;

  // ❄️ Заморозка бьёт все остальные бейджи: это единственное, что определяет,
  // можно ли с заказом вообще что-то делать.
  if (order.heldAt) return { label: "❄️ Заморожен", tone: "ice" };
  if (order.isFavorite) return { label: "Избранное", tone: "yellow" };
  if (order.status === "COMPLETED") return { label: "Готово", tone: "green" };
  if (order.status === "REJECTED") return { label: "Отменено", tone: "red" };
  if (order.status === "ERROR") return { label: "Ошибка", tone: "red" };
  if (order.orderSource === "AVITO" && ["PENDING", "IN_PROGRESS", "AWAITING_GAMEPASS", "ERROR"].includes(order.status))
    return { label: "Авито", tone: "orange" };
  if (order.isDirectOrder && ["PENDING", "IN_PROGRESS", "AWAITING_PAYMENT", "PAYMENT_PENDING"].includes(order.status))
    return { label: "Прямой", tone: "blue" };
  if (order.status === "AWAITING_GAMEPASS" && created > cutoff) return { label: "Новый", tone: "accent" };
  if (order.status === "AWAITING_GAMEPASS") return { label: "Ждёт ссылку", tone: "yellow" };
  if (["PENDING", "IN_PROGRESS"].includes(order.status)) return { label: "К выкупу", tone: "green" };
  return null;
}

/* ── Главное действие ────────────────────────────────────────────────────────
   Одна цель на заказ, видимая прямо из ленты. Подпись определяется СОСТОЯНИЕМ
   заказа, а не срезом, на котором он показан: иначе один и тот же заказ
   предлагал бы в «Выкупить» и в «Все» разные кнопки — и однажды не ту.
   ────────────────────────────────────────────────────────────────────────── */

export type OrderActionKind = "action" | "contact";

export interface PrimaryAction {
  kind: OrderActionKind;
  /** POST-действие `/api/admin/orders`; пусто у `contact`. */
  action?: string;
  icon: string;
  /** Короткая подпись — для кнопки в строке и на карточке телефона. */
  label: string;
  /** Развёрнутая подпись — там, где есть ширина (досье на сайте). */
  labelLong?: string;
  tone: Tone;
}

export function primaryActionFor(order: PresentableOrder, live?: GpLive | null): PrimaryAction | null {
  // ❄️ У замороженного заказа кнопок выкупа нет вовсе — не серых и
  // продавливаемых, а отсутствующих. Единственный выход — снять заморозку.
  if (order.heldAt) return { kind: "action", action: "unhold", icon: "❄", label: "Разморозить", tone: "ice" };
  if (order.status === "COMPLETED" || order.status === "REJECTED") return null;
  // Прямой заказ до подтверждения оплаты: выкупать и закрывать нечего.
  if (order.status === "AWAITING_PAYMENT" || order.status === "PAYMENT_PENDING") return null;

  const split = order.splitGamepasses ?? [];
  const hasGamepass = !!order.gamepassUrl || split.length > 0;

  if (order.status === "ERROR") {
    return hasGamepass
      ? { kind: "action", action: "restore-to-buyout", icon: "↩", label: "Вернуть", labelLong: "Вернуть к выкупу", tone: "blue" }
      : null;
  }
  if (order.status === "AWAITING_GAMEPASS") {
    return { kind: "contact", icon: "✉", label: "Написать", tone: "blue" };
  }
  // PENDING / IN_PROGRESS. У разбитого заказа «Выкуплено» появляется только
  // когда закрыта последняя часть: раньше него оно означало бы «закрыть заказ,
  // купив не всё», и клиент получил бы меньше оплаченного.
  if (split.length > 0 && split.some(part => !part.purchasedAt)) return null;
  if (!hasGamepass) return null;
  /* Пасс снят с продажи — купить его нельзя никому, главное действие —
     написать покупателю. «Выкуплено» остаётся в меню.

     Повтор пасса (`reusedIn`) сюда НЕ относится. 20.10 он тоже прятал
     «Выкуплено», но выкуп идёт с разных мелких аккаунтов, и другой аккаунт
     тот же пасс покупает спокойно: в базе 59 закрытых повторов, а 3FBF66L
     21.10 админ закрыл через меню, потому что кнопки не было. Повтор —
     предупреждение «бери с другого аккаунта», а не запрет. */
  if (live?.isForSale === false)
    return { kind: "contact", icon: "✉", label: "Написать", labelLong: "Написать за новым пассом", tone: "blue" };
  return { kind: "action", action: "complete", icon: "✓", label: "Выкуплено", tone: "green" };
}

/* ── Строка-флаг ─────────────────────────────────────────────────────────────
   Появляется только когда есть что сказать. Порядок веток = порядок срочности:
   строка одна, и если пасс снят с продажи, а бот вдобавок не достучался в VK,
   менеджеру нужно узнать про пасс — второе он увидит в досье.
   ────────────────────────────────────────────────────────────────────────── */

export function orderFlag(
  order: PresentableOrder,
  live?: GpLive | null,
  reminders = 0,
  /**
   * `splitProgress` включает строку «куплено 2 из 3». На сайте она нужна —
   * в таблице другого места для прогресса частей нет; в TWA прогресс уже
   * стоит на самой карточке, и второй раз он был бы шумом.
   */
  options: { splitProgress?: boolean; packDupIn?: string | null } = {},
): { text: string; tone: Tone } | null {
  if (order.heldAt) return { text: `❄️ ${order.heldReason ?? "заморожен — не выкупать"}`, tone: "ice" };
  if (order.buyoutErrorCode === "REGIONAL_PRICE")
    return { text: "🌍 рег. цена на доноре — замена по нику не найдена", tone: "red" };
  if (live?.isForSale === false) return { text: "⛔ геймпасс снят с продажи", tone: "red" };
  /* Тот же пасс стоит ещё в одном заказе ТЕКУЩЕЙ очереди — то есть в одной
     пачке выкупа. Это единственный повтор, о котором кричим: оба заказа уйдут
     в работу рядом, и одним аккаунтом второй уже не купить (`AlreadyOwned`).
     Повтор с закрытым заказом (`reusedIn`) с 21.10 строкой не считается —
     выкуп идёт с разных аккаунтов, и это справка в досье, а не флаг. */
  if (options.packDupIn) return { text: `♻️ тот же пасс в ${options.packDupIn} — второй брать с другого аккаунта`, tone: "orange" };
  if (live?.priceMismatch && live.livePrice != null)
    return {
      text: `⚠ цена пасса ${live.livePrice.toLocaleString("ru-RU")} R$ ≠ ${(live.expected ?? grossOf(order.amount)).toLocaleString("ru-RU")} R$`,
      tone: "orange",
    };
  if (order.gpWatchDeclinedAt && order.status === "AWAITING_GAMEPASS" && !order.robloxUsername)
    return { text: "❌ клиент отклонил найденный ник", tone: "red" };
  if (order.vkUnreachable === true && order.user?.vkId)
    return { text: "🚫 бот не может написать в VK — только с личного", tone: "red" };
  if (order.status === "AWAITING_GAMEPASS" && reminders >= 3)
    return { text: "бот отмолчал все три напоминания — дожимать вручную", tone: "muted" };
  const split = order.splitGamepasses ?? [];
  if (options.splitProgress && split.length > 0 && split.some(p => !p.purchasedAt))
    return {
      text: `🧩 куплено ${split.filter(p => p.purchasedAt).length} из ${split.length} частей`,
      tone: "muted",
    };
  if (order.status === "ERROR") return { text: "заказ требует исправления", tone: "red" };
  // Зелёная строка — не украшение: она значит «живая проверка прошла», и без
  // самой проверки её быть не должно.
  if (live && live.isForSale === true && !live.priceMismatch && ["PENDING", "IN_PROGRESS"].includes(order.status))
    return { text: "✓ пасс продаётся, цена сходится", tone: "green" };
  return null;
}

/* ── Полоса источника ────────────────────────────────────────────────────── */

export type LaneId = "WB" | "WB_DBS" | "DIRECT";

export const LANE_META: Record<LaneId, { label: string; tone: Tone }> = {
  WB: { label: "ВБ", tone: "green" },
  WB_DBS: { label: "DBS", tone: "blue" },
  DIRECT: { label: "Прямой", tone: "accent" },
};

export function laneOf(order: Pick<PresentableOrder, "orderSource" | "isDirectOrder">): LaneId {
  if (order.orderSource === "WB_DBS") return "WB_DBS";
  if (order.isDirectOrder) return "DIRECT";
  return "WB";
}

/** Заказ выключен из выкупа намеренно — пачка обязана его пропускать. */
export const isHeld = (order: Pick<PresentableOrder, "heldAt">): boolean => order.heldAt != null;

/**
 * Заказ можно отметить выкупленным прямо сейчас. Пачка собирается ровно по
 * этому предикату, поэтому он один и тот же для одиночной кнопки и для «×7».
 */
export function canComplete(order: PresentableOrder): boolean {
  return primaryActionFor(order)?.action === "complete";
}

/* ── Слова вместо enum ───────────────────────────────────────────────────────
   До 19.10.2026 полная карточка `/admin/orders/<id>` печатала `PENDING` и
   `WB_DBS` как есть, а рядом лежал неиспользуемый второй словарь
   (`admin-order-presentation.ts`) со своими словами. Теперь словарь один, и
   слова — те же, что во вкладках ленты и на бейджах.
   ────────────────────────────────────────────────────────────────────────── */

export const STATUS_LABEL: Readonly<Record<string, string>> = {
  AWAITING_PAYMENT: "Ждёт оплаты",
  PAYMENT_PENDING: "Оплата проверяется",
  AWAITING_GAMEPASS: "Ждёт ссылку",
  PENDING: "К выкупу",
  IN_PROGRESS: "Выкупается",
  COMPLETED: "Готово",
  REJECTED: "Отменено",
  ERROR: "Ошибка",
};

export const statusLabel = (status: string): string => STATUS_LABEL[status] ?? status;

export const SOURCE_LABEL: Readonly<Record<string, string>> = {
  WB: "ВБ · карта",
  WB_DBS: "ВБ · доставка (DBS)",
  DIRECT: "Прямой",
  SITE: "Сайт",
  AVITO: "Авито",
  MANUAL: "Ручной",
};

/** Коротко — для тесных мест (таблица «Выкупа»): те же слова, что у полос ленты. */
export const SOURCE_SHORT: Readonly<Record<string, string>> = {
  WB: "ВБ", WB_DBS: "DBS", DIRECT: "Прямой", SITE: "Сайт", AVITO: "Авито", MANUAL: "Ручной",
};

export const sourceLabel = (source: string | null | undefined): string =>
  source ? SOURCE_LABEL[source] ?? source : "—";

export const PLATFORM_LABEL: Readonly<Record<string, string>> = { TG: "Telegram", VK: "VK", WEB: "сайт", SITE: "сайт" };

/* ── «Дальше: …» ─────────────────────────────────────────────────────────────
   Одна строка «что от НАС дальше» — как «👉 От тебя» у покупателя в боте.
   Раньше админ собирал вывод сам из статуса, возраста и флага. Порядок веток —
   порядок срочности, как у `orderFlag`; строка одна.
   ────────────────────────────────────────────────────────────────────────── */

export function nextStepFor(
  order: PresentableOrder,
  live?: GpLive | null,
  reminders = order.remindersSent ?? 0,
  options: { packDupIn?: string | null } = {},
): { text: string; tone: Tone } | null {
  if (order.heldAt) return { text: "снять заморозку, когда причина отпадёт — до этого не выкупать", tone: "ice" };
  if (order.status === "COMPLETED" || order.status === "REJECTED") return null;
  if (order.status === "AWAITING_PAYMENT" || order.status === "PAYMENT_PENDING")
    return { text: "ждём оплату — выкупать нельзя", tone: "muted" };

  const split = order.splitGamepasses ?? [];
  const hasGamepass = !!order.gamepassUrl || split.length > 0;

  if (order.status === "ERROR") {
    if (order.buyoutErrorCode === "REGIONAL_PRICE")
      return { text: "найти замену пасса по нику или написать покупателю — у донора рег. цена", tone: "red" };
    return hasGamepass
      ? { text: "разобраться с ошибкой и вернуть к выкупу", tone: "red" }
      : { text: "привязать пасс — без него к выкупу не вернуть", tone: "red" };
  }

  if (order.status === "AWAITING_GAMEPASS") {
    if (order.vkUnreachable === true && order.user?.vkId)
      return { text: "написать покупателю с личного — бот в VK до него не достаёт", tone: "red" };
    if (order.gpWatchDeclinedAt && !order.robloxUsername)
      return { text: "уточнить ник — покупатель отклонил найденный", tone: "orange" };
    if (reminders >= 3)
      return { text: "дожать вручную: ключ или пасс по нику — бот отправил все 3 напоминания и замолчал", tone: "orange" };
    return {
      text: reminders > 0 ? `ждём пасс от покупателя · напоминаний ${reminders} из 3` : "ждём пасс от покупателя",
      tone: "muted",
    };
  }

  // PENDING / IN_PROGRESS
  if (live?.isForSale === false) return { text: "попросить покупателя вернуть пасс в продажу", tone: "red" };
  if (options.packDupIn) return { text: `выкупить с другого аккаунта — тот же пасс в ${options.packDupIn} из этой очереди`, tone: "orange" };
  if (live?.priceMismatch && live.livePrice != null)
    return {
      text: `проверить цену: пасс ${live.livePrice.toLocaleString("ru-RU")} R$, нужен ${(live.expected ?? grossOf(order.amount)).toLocaleString("ru-RU")} R$`,
      tone: "orange",
    };
  if (!hasGamepass) return { text: "привязать пасс", tone: "orange" };
  if (split.length > 0 && split.some(p => !p.purchasedAt)) {
    const left = split.filter(p => !p.purchasedAt).length;
    return { text: `выкупить оставшиеся части: ${left} из ${split.length}`, tone: "green" };
  }
  return { text: `выкупить пасс за ${grossOf(order.amount).toLocaleString("ru-RU")} R$`, tone: "green" };
}

/* ── Повтор пасса внутри очереди («пачки выкупа») ────────────────────────────
   Заказы, ждущие выкупа, с одним и тем же ID пасса. Ключ — заказ, значение —
   код ДРУГОГО заказа с тем же пассом (первого по списку). Считается по тому,
   что лежит на экране: пачка — это и есть текущая очередь.
   ────────────────────────────────────────────────────────────────────────── */

export function packDuplicates<T extends { id: string; wbCode: string; status: string; heldAt: string | null }>(
  orders: T[],
  passIdsOf: (order: T) => string[],
): Map<string, string> {
  const byPass = new Map<string, T[]>();
  for (const order of orders) {
    if (order.heldAt || !["PENDING", "IN_PROGRESS"].includes(order.status)) continue;
    for (const id of new Set(passIdsOf(order))) {
      const list = byPass.get(id) ?? [];
      list.push(order);
      byPass.set(id, list);
    }
  }
  const out = new Map<string, string>();
  for (const list of byPass.values()) {
    if (list.length < 2) continue;
    for (const order of list) {
      const other = list.find(o => o.id !== order.id);
      if (other && !out.has(order.id)) out.set(order.id, other.wbCode);
    }
  }
  return out;
}

/* ── Готовность к выкупу ─────────────────────────────────────────────────────
   Четыре шага, которые проходит каждый заказ: оплата → ник → пасс → выкуп.
   Карточка рисует их полоской, а над полоской — одно слово состояния
   («Готов к выкупу», «Ждём пасс»). Правило общее для TWA и сайта; цвет каждый
   экран берёт из тона сам.
   ────────────────────────────────────────────────────────────────────────── */

export type StepState = "done" | "now" | "wait" | "bad" | "todo";

export interface Readiness {
  /** Оплата · Ник · Пасс · Выкуп. */
  steps: [StepState, StepState, StepState, StepState];
  /** Доля закрытых частей у разбитого заказа (0..1) — для шага «Выкуп». */
  buyoutShare: number;
  label: string;
  tone: Tone;
  /** Заказ можно выкупать прямо сейчас. */
  ready: boolean;
}

export const READINESS_STEPS = ["Оплата", "Ник", "Пасс", "Выкуп"] as const;

export function readinessFor(order: PresentableOrder & { probableNick?: string | null }, live?: GpLive | null): Readiness {
  const split = order.splitGamepasses ?? [];
  const hasGamepass = !!order.gamepassUrl || split.length > 0;
  const bought = split.filter(p => p.purchasedAt).length;
  const share = split.length > 0 ? bought / split.length : 0;

  const paid: StepState = ["AWAITING_PAYMENT", "PAYMENT_PENDING"].includes(order.status) ? "wait" : "done";
  const nick: StepState = order.robloxUsername || hasGamepass ? "done" : "wait";
  const passBad = live?.isForSale === false || (!!live?.priceMismatch && live.livePrice != null);
  const pass: StepState = !hasGamepass ? "wait" : passBad || order.buyoutErrorCode === "REGIONAL_PRICE" ? "bad" : "done";

  const make = (steps: Readiness["steps"], label: string, tone: Tone, ready = false): Readiness =>
    ({ steps, buyoutShare: share, label, tone, ready });

  if (order.status === "COMPLETED") return make(["done", "done", "done", "done"], "Выкуплен", "green");
  if (order.status === "REJECTED") return make(["todo", "todo", "todo", "todo"], "Отменён", "red");
  if (order.heldAt) return make([paid, nick, pass, "todo"], "Заморожен", "ice");
  if (paid === "wait") return make(["wait", "todo", "todo", "todo"], "Ждём оплату", "muted");
  if (order.status === "ERROR") return make([paid, nick, hasGamepass ? "bad" : "wait", "todo"], "Ошибка", "red");
  if (order.status === "AWAITING_GAMEPASS" || !hasGamepass) {
    const guess = !order.robloxUsername && !!order.probableNick;
    return make([paid, guess ? "wait" : nick, "wait", "todo"], guess ? "Ник под вопросом" : "Ждём пасс", "orange");
  }
  if (live?.isForSale === false) return make([paid, nick, "bad", "todo"], "Пасс снят", "red");
  if (pass === "bad") return make([paid, nick, "bad", "todo"], "Цена не та", "orange");
  if (split.length > 0 && bought > 0) return make([paid, nick, pass, "now"], `Выкуп · ${bought} из ${split.length}`, "green", true);
  return make([paid, nick, pass, "now"], "Готов к выкупу", "green", true);
}
