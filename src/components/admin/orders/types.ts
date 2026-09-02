import type { OrderSlicesPayload, SliceKey } from "@/lib/order-slices";
import type { Tone } from "@/lib/order-presentation";

/** Заказ в том виде, в котором его отдаёт `/api/admin/orders`. */
export interface AdminOrder {
  id: string;
  amount: number;
  status: string;
  platform: string;
  wbCode: string;
  publicOrderId?: string | null;
  gamepassUrl: string | null;
  gamepassId?: string | null;
  splitGamepasses?: { id: string; gamepassId: string; amount: number; position: number; chargedPrice: number | null; purchasedAt: string | null }[];
  rejectionReason: string | null;
  adminNote: string | null;
  buyoutErrorCode: string | null;
  heldAt: string | null;
  heldReason: string | null;
  heldBy: string | null;
  isDirectOrder: boolean;
  isFavorite: boolean;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
  pendingAt: string | null;
  completedAt?: string | null;
  remindersSent?: number | null;
  robloxUsername: string | null;
  probableNick: string | null;
  purchaserUsername: string | null;
  orderSource: string;
  reviewStatus?: "PENDING" | "SUBMITTED" | null;
  vkUnreachable?: boolean | null;
  gpWatchDeclinedAt?: string | null;
  saleAmountKopecks?: number | null;
  paymentAttempts?: { status: string; amountKopecks: number; refundedAmountKopecks: number }[];
  user: {
    tgId: string | null;
    vkId: string | null;
    name: string | null;
    username: string | null;
    balance?: number | null;
  };
}

export interface OrdersResponse {
  orders: AdminOrder[];
  total: number;
  page: number;
  pages: number;
  counts: Record<string, number> | null;
  sums: Record<string, number> | null;
  oldest: Record<string, string | null> | null;
  slices: OrderSlicesPayload | null;
}

export interface LiveCheck {
  isForSale?: boolean | null;
  livePrice?: number | null;
  priceMismatch?: boolean | null;
  expected?: number | null;
  sellerName?: string | null;
  checkedAt?: number;
}

export type Narrow = {
  lane?: string | null;
  age?: string | null;
  amount?: number | null;
  blocked?: string | null;
};

/** Тон → цвет тёмной оболочки админки. Один словарь на все экраны заказов. */
export const TONE_COLOR: Record<Tone, string> = {
  green: "var(--o-green)",
  yellow: "var(--o-yellow)",
  orange: "var(--o-orange)",
  red: "var(--o-red)",
  blue: "var(--o-blue)",
  ice: "var(--o-ice)",
  accent: "var(--o-accent)",
  muted: "var(--o-muted)",
};

export const SLICE_META: { key: SliceKey; label: string; tone: Tone; hint: string }[] = [
  { key: "BUYOUT", label: "Выкупить", tone: "green", hint: "деньги получены, пасс есть — ждёт покупки робуксов" },
  { key: "ERROR", label: "Починить", tone: "red", hint: "выкуп сорвался, почти всё чинится одной кнопкой" },
  { key: "AWAITING_LINK", label: "Дожать", tone: "yellow", hint: "покупатель не прислал ссылку на геймпасс" },
  { key: "DONE", label: "История", tone: "muted", hint: "закрытые заказы" },
];

/** Всё, что не является ежедневной работой, — в шторке фильтров. */
export const EXTRA_TABS: { key: string; label: string }[] = [
  { key: "ALL", label: "Все" },
  { key: "WORK", label: "В работе" },
  { key: "NEW", label: "Новые" },
  { key: "DIRECT", label: "Прямые" },
  { key: "AVITO", label: "Авито" },
  { key: "FAVORITES", label: "Избранное" },
  { key: "ATTENTION", label: "Требуют внимания" },
  { key: "STALE_LINK", label: "Висяки" },
  { key: "HELD", label: "Заморожены" },
  { key: "REJECTED", label: "Отменены" },
];

export const money = (kopecks: number | null | undefined): string =>
  typeof kopecks === "number"
    ? new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(kopecks / 100)
    : "—";

export const rub = (kopecks: number | null | undefined): string => money(kopecks);

export const num = (value: number): string => value.toLocaleString("ru-RU");

/** ID геймпасса из ссылки — то, что вставляется в донора. */
export function gamepassIdOf(order: Pick<AdminOrder, "gamepassUrl" | "gamepassId">): string | null {
  if (order.gamepassId) return String(order.gamepassId);
  const match = order.gamepassUrl?.match(/game-pass(?:es)?\/(\d+)/);
  return match ? match[1] : null;
}

/** Все ID заказа: у разбитого — по одному на часть. */
export function gamepassIdsOf(order: AdminOrder): string[] {
  const parts = order.splitGamepasses ?? [];
  if (parts.length > 0) return parts.map(part => String(part.gamepassId));
  const single = gamepassIdOf(order);
  return single ? [single] : [];
}

export function clientLabel(order: AdminOrder): string {
  const name = order.user?.name?.trim();
  const username = order.user?.username?.trim();
  if (name && username) return `${name} · @${username}`;
  if (name) return name;
  if (username) return `@${username}`;
  if (order.user?.tgId) return `TG ${order.user.tgId}`;
  if (order.user?.vkId) return `VK ${order.user.vkId}`;
  return "Клиент не привязан";
}

/** Ссылка в мессенджер клиента — «написать» без выхода из админки. */
export function contactHref(order: AdminOrder): string | null {
  if (order.user?.username) return `https://t.me/${order.user.username}`;
  if (order.user?.vkId) return `https://vk.com/id${order.user.vkId}`;
  return null;
}

export function copyText(text: string): void {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    return;
  }
  fallbackCopy(text);
}

function fallbackCopy(text: string): void {
  const el = document.createElement("textarea");
  el.value = text;
  el.setAttribute("readonly", "");
  el.style.position = "fixed";
  el.style.left = "-9999px";
  document.body.appendChild(el);
  el.select();
  try { document.execCommand("copy"); } catch { /* буфер недоступен — молчим */ }
  document.body.removeChild(el);
}
