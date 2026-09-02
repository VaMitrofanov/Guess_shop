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
}

/** Грязные робуксы: цена пасса, которая спишется с донора. */
export const grossOf = (amount: number): number => expectedGamepassPrice(amount);

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

export function primaryActionFor(order: PresentableOrder): PrimaryAction | null {
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
  options: { splitProgress?: boolean } = {},
): { text: string; tone: Tone } | null {
  if (order.heldAt) return { text: `❄️ ${order.heldReason ?? "заморожен — не выкупать"}`, tone: "ice" };
  if (order.buyoutErrorCode === "REGIONAL_PRICE")
    return { text: "🌍 рег. цена на доноре — замена по нику не найдена", tone: "red" };
  if (live?.isForSale === false) return { text: "⛔ геймпасс снят с продажи", tone: "red" };
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
