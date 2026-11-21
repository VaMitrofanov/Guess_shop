/* ─────────────────────────────────────────────────────────────────────────────
   📦 Паспорт заказа для клиента (Э2, 18.11.2026) — покупки кодов Robux.

   До этого дня «📦 Мой заказ» в боте знал только заказы WB: человек, купивший
   код на сайте, а потом подключивший Telegram, видел «Есть код с WB-карты?».
   Здесь — одна функция, которая собирает покупки кодов человека (свои и
   подключённые из поддержки, `CodeOrderContact`), и одни слова для этапа.
   Номер `CODE-…` клиенту не показываем (правило «никаких номеров заказов»):
   покупка узнаётся по номиналу и дате. Сам код — только в кабинете.
   ───────────────────────────────────────────────────────────────────────── */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

const SHOW_DAYS = 45;
const DAY = 86_400_000;

export interface CustomerCodeOrder {
  id: string;
  amount: number;
  status: "PAID" | "ISSUED";
  createdAt: Date;
  issuedAt: Date | null;
  /** true — подключён к чужой покупке (код видит только владелец). */
  linked: boolean;
}

/** Этап покупки кода одной фразой и одно следующее действие. */
export function codeOrderStage(o: Pick<CustomerCodeOrder, "status" | "linked">): { word: string; action: string } {
  if (o.status === "ISSUED") {
    return o.linked
      ? { word: "код выдан — он в кабинете того, кто покупал", action: "Код откроет тот, кто оформлял покупку." }
      : { word: "код выдан — он в кабинете на сайте и в письме", action: "Откройте кабинет — код там, введите его в Roblox." };
  }
  return { word: "оплачен, готовим код", action: "Пришлём сюда, как только код будет готов." };
}

/** Свои и подключённые покупки кодов за 45 дней, свежие сверху. */
export async function loadCustomerCodeOrders(db: Db, userId: string, now = Date.now()): Promise<CustomerCodeOrder[]> {
  const since = new Date(now - SHOW_DAYS * DAY);
  const where = { status: { in: ["PAID", "ISSUED"] }, refundedAt: null, createdAt: { gte: since } };
  const select = { id: true, denomination: true, status: true, createdAt: true, issuedAt: true, creatorUserId: true } as const;
  const [own, linked] = await Promise.all([
    db.codeOrder.findMany({ where: { ...where, creatorUserId: userId }, select, orderBy: { createdAt: "desc" }, take: 5 }).catch(() => []),
    db.codeOrderContact.findMany({ where: { userId, removedAt: null, codeOrder: where }, select: { codeOrder: { select } }, take: 5 }).catch(() => []),
  ]);
  const rows = [
    ...own.map((o: Record<string, unknown>) => ({ ...o, linked: false })),
    ...linked.map((l: { codeOrder: Record<string, unknown> }) => ({ ...l.codeOrder, linked: true })),
  ] as Array<{ id: string; denomination: number; status: "PAID" | "ISSUED"; createdAt: Date; issuedAt: Date | null; linked: boolean }>;
  const seen = new Set<string>();
  return rows
    .filter((o) => (seen.has(o.id) ? false : (seen.add(o.id), true)))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .map((o) => ({ id: o.id, amount: o.denomination, status: o.status, createdAt: new Date(o.createdAt), issuedAt: o.issuedAt ? new Date(o.issuedAt) : null, linked: o.linked }));
}

const dayRu = (d: Date) => d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: "Europe/Moscow" });

/** Текст карточки «Мой заказ» (HTML) для покупок кодов; null — показывать нечего. */
export function codeOrdersCardText(orders: CustomerCodeOrder[]): string | null {
  if (!orders.length) return null;
  const shown = orders.slice(0, 3);
  const lines = shown.map((o) => {
    const st = codeOrderStage(o);
    return `🎟 <b>Код Robux · ${o.amount} R$</b> · от ${dayRu(o.createdAt)}\nСтатус: ${st.word}`;
  });
  const next = codeOrderStage(shown[0]).action;
  return `${shown.length > 1 ? "Ваши покупки кодов" : "Ваша покупка кода"}:\n\n${lines.join("\n\n")}\n\n<i>${next}</i>`;
}

/**
 * Для карточки бота: покупки кодов, если они свежее `newerThan` (последнего
 * заказа WB) — иначе важнее WB-заказ и карточка остаётся его.
 */
export async function codeOrdersStatusText(db: Db, userId: string, newerThan: Date | null = null): Promise<string | null> {
  const orders = await loadCustomerCodeOrders(db, userId);
  const fresh = newerThan ? orders.filter((o) => o.createdAt > newerThan || o.status === "PAID") : orders;
  return codeOrdersCardText(fresh);
}
