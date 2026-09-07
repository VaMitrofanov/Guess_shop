/**
 * Живой заказ покупателя — один ответ на вопрос «что у него сейчас в работе».
 *
 * Зачем отдельный модуль. Разбор 07.09.2026 по `JS6NQB9`: покупатель с
 * ОПЛАЧЕННЫМ заказом WB DBS зашёл в кабинет, нажал там «Подробнее» у активного
 * заказа — и попал в `/guide?source=site&flow=order`, то есть в ПЛАТНУЮ воронку
 * сайта. Через три минуты у него висел второй заказ `WEB-07E4BC427E4A17747E4C`
 * на те же 500 R$, тот же ник и тот же геймпасс, в `PAYMENT_PENDING` навсегда.
 * Ссылка «продолжить» вела не в его коридор, а в кассу.
 *
 * Отсюда правило, которое держит этот файл: у заказа коридора (карта WB или
 * доставка DBS — деньги уже получены на Wildberries) есть РОВНО ОДНА ссылка
 * «продолжить», и она ведёт в его собственную инструкцию с его кодом. Никакой
 * `flow=order` — этот признак включает на странице кнопку «Перейти к
 * оформлению», а оформлять коридорному покупателю нечего.
 *
 * Второе правило — про рельсы. Пока заказ не собран (`AWAITING_GAMEPASS`),
 * покупателя нельзя выпускать в платную покупку: он уже заплатил. Как только
 * заказ собран (`PENDING` и дальше) — свободное плавание, но заказ остаётся
 * перед глазами строкой сверху (`ActiveOrderBar`) и в боте.
 */

import { prisma } from "@/lib/prisma";
import { customerOrderStatus } from "@/lib/customer-dashboard";

/** Источники, где деньги уже получены не нами и повторная оплата — ошибка. */
export const CORRIDOR_SOURCES = ["WB", "WB_DBS"] as const;

/** Статусы, при которых заказ считается живым и показывается покупателю. */
export const ACTIVE_STATUSES = [
  "AWAITING_GAMEPASS",
  "PENDING",
  "IN_PROGRESS",
  "AWAITING_PAYMENT",
  "PAYMENT_PENDING",
] as const;

/**
 * Брошенная оплата перестаёт быть «живым заказом» через два часа.
 *
 * Ссылка банка к этому времени всё равно протухла, а строка сверху «проверяем
 * оплату» на неделю вперёд — это ложь, которая ещё и закрывает собой настоящий
 * заказ коридора.
 */
export const STALE_PAYMENT_MS = 2 * 60 * 60 * 1000;

export interface ActiveOrderView {
  id: string;
  wbCode: string;
  /** Что показать покупателю как имя заказа: код ВБ или публичный номер сайта. */
  ref: string;
  amount: number;
  status: string;
  source: string;
  robloxUsername: string | null;
  /** Оплачено вне сайта (WB/DBS): вторая оплата этому человеку не нужна. */
  corridor: boolean;
  /** Заказ ещё не собран — покупателя ведём за руку и в кассу не пускаем. */
  needsGamepass: boolean;
  /** Единственная правильная ссылка «продолжить». */
  href: string;
  label: string;
  tone: string;
  createdAt: Date;
}

/** Похоже ли на код с карточки WB — семь символов, буквы и цифры. */
export function isWbCode(code: string): boolean {
  return /^[A-Z0-9]{7}$/.test(code);
}

/**
 * Куда вести покупателя, чтобы он закончил ИМЕННО этот заказ.
 *
 * У коридора это его личная инструкция с кодом: страница сама подтянет номинал,
 * ник и уже выбранный геймпасс. У прямого заказа из бота — та же инструкция без
 * кода. У сайтового заказа продолжение — это касса, там и статус оплаты.
 */
export function continueHref(order: {
  wbCode: string;
  orderSource: string;
  publicOrderId?: string | null;
  robloxUsername?: string | null;
}): string {
  if (CORRIDOR_SOURCES.includes(order.orderSource as (typeof CORRIDOR_SOURCES)[number]) && isWbCode(order.wbCode)) {
    const base = `/guide?source=wb&skip=1&code=${encodeURIComponent(order.wbCode)}`;
    return order.robloxUsername ? `${base}&username=${encodeURIComponent(order.robloxUsername)}` : base;
  }
  if (order.wbCode.startsWith("DIR-")) return "/guide?source=direct";
  if (order.publicOrderId) return `/payment/status?orderId=${encodeURIComponent(order.publicOrderId)}`;
  return "/dashboard";
}

interface OrderRow {
  id: string;
  wbCode: string;
  publicOrderId: string | null;
  amount: number;
  status: string;
  orderSource: string;
  robloxUsername: string | null;
  createdAt: Date;
}

/**
 * Порядок важности: сначала тот заказ, который ЖДЁТ действия покупателя, потом
 * тот, что в работе. Иначе строка сверху показывала бы «выкупаем» человеку,
 * от которого мы ждём геймпасс.
 */
function rank(order: OrderRow): number {
  if (order.status === "AWAITING_GAMEPASS") return 0;
  if (order.status === "PENDING" || order.status === "IN_PROGRESS") return 1;
  return 2;
}

export function toActiveOrderView(order: OrderRow): ActiveOrderView {
  const meta = customerOrderStatus("canonical", order.status);
  const corridor = CORRIDOR_SOURCES.includes(order.orderSource as (typeof CORRIDOR_SOURCES)[number]);
  return {
    id: order.id,
    wbCode: order.wbCode,
    ref: order.publicOrderId ?? order.wbCode,
    amount: order.amount,
    status: order.status,
    source: order.orderSource,
    robloxUsername: order.robloxUsername,
    corridor,
    needsGamepass: order.status === "AWAITING_GAMEPASS",
    href: continueHref(order),
    label: meta.label,
    tone: meta.tone,
    createdAt: order.createdAt,
  };
}

/** Живой заказ этого покупателя — тот единственный, который показываем везде. */
export async function findActiveOrder(userId: string): Promise<ActiveOrderView | null> {
  const rows = (await prisma.wbOrder.findMany({
    where: { userId, status: { in: [...ACTIVE_STATUSES] } },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true,
      wbCode: true,
      publicOrderId: true,
      amount: true,
      status: true,
      orderSource: true,
      robloxUsername: true,
      createdAt: true,
    },
  })) as OrderRow[];

  const now = Date.now();
  const live = rows.filter((order) => {
    const unpaid = order.status === "AWAITING_PAYMENT" || order.status === "PAYMENT_PENDING";
    return !unpaid || now - order.createdAt.getTime() < STALE_PAYMENT_MS;
  });
  if (live.length === 0) return null;

  live.sort((a, b) => rank(a) - rank(b) || b.createdAt.getTime() - a.createdAt.getTime());
  return toActiveOrderView(live[0]);
}

/**
 * Заказ коридора, который ещё не собран, — причина не пускать в платную кассу.
 *
 * Возвращает `null`, когда покупать на сайте можно: коридорных незакрытых
 * заказов нет. Отдельная функция, а не флаг у `findActiveOrder`, потому что у
 * кассы вопрос другой — не «что показать», а «можно ли брать деньги».
 */
export async function findBlockingCorridorOrder(userId: string): Promise<ActiveOrderView | null> {
  const row = (await prisma.wbOrder.findFirst({
    where: {
      userId,
      status: "AWAITING_GAMEPASS",
      orderSource: { in: [...CORRIDOR_SOURCES] },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      wbCode: true,
      publicOrderId: true,
      amount: true,
      status: true,
      orderSource: true,
      robloxUsername: true,
      createdAt: true,
    },
  })) as OrderRow | null;
  return row ? toActiveOrderView(row) : null;
}
