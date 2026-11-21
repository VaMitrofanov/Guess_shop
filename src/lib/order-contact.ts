/**
 * 📣 Обращения покупателя по заказу — для карточки (16.11.2026, редизайн v2).
 *
 * Владелец: «кнопка "Ответ клиенту" — только если он пишет. Молчит — карточка
 * максимально пустая, только инфа о выкупе». Обращения уже привязаны к заказу
 * (поддержка TG/VK пишет `OrderEvent`, чат WB — `WbBuyerChatEvent`), их читает
 * блок «Первым делом». Здесь те же строки сводятся по заказу за неделю: сколько
 * раз писал, когда последний раз, его последние слова.
 *
 * «Спасибо», «ок» и эхо наших же ответов в чате WB (`quiet`) обращением не
 * считаются — иначе блок висел бы у каждого, кто просто прислал ник.
 */
import { loadBuyerContacts, contactQuote, type BuyerContact } from "../../bots/shared/buyer-contact";

export const ORDER_CONTACT_WINDOW_DAYS = 7;

export interface OrderContactSummary {
  /** Сколько раз писал за окно (без «спасибо» и эха). */
  count: number;
  lastAt: string;
  lastText: string | null;
  lastChannel: "TG" | "VK" | "WB";
  /** Самое «горячее» за окно: просит вернуть деньги → нужен человек → торопит. */
  kind: "cancel" | "human" | "rush";
}

const KIND_RANK: Record<string, number> = { cancel: 3, human: 2, rush: 1 };

/** Чистая свёртка — тестируется без базы. */
export function summarizeOrderContacts(contacts: Pick<BuyerContact, "orderId" | "at" | "channel" | "text" | "kind">[]): Map<string, OrderContactSummary> {
  const out = new Map<string, OrderContactSummary>();
  const sorted = [...contacts].sort((a, b) => a.at.getTime() - b.at.getTime());
  for (const c of sorted) {
    if (c.kind === "quiet") continue;
    const kind = c.kind as OrderContactSummary["kind"];
    const prev = out.get(c.orderId);
    if (!prev) {
      out.set(c.orderId, {
        count: 1, lastAt: c.at.toISOString(), lastText: contactQuote(c.text), lastChannel: c.channel as OrderContactSummary["lastChannel"], kind,
      });
      continue;
    }
    prev.count += 1;
    prev.lastAt = c.at.toISOString();
    prev.lastChannel = c.channel as OrderContactSummary["lastChannel"];
    // Пустая кнопка «Статус» не затирает последнюю живую цитату.
    if (c.text) prev.lastText = contactQuote(c.text);
    if ((KIND_RANK[kind] ?? 0) > (KIND_RANK[prev.kind] ?? 0)) prev.kind = kind;
  }
  return out;
}

const ID_RE = /^[a-z0-9]{8,40}$/i;

/** Сводка по набору заказов — один заход в базу. Пустой набор не ходит в базу. */
export async function loadOrderContacts(db: unknown, orderIds: string[], now = new Date()): Promise<Map<string, OrderContactSummary>> {
  const ids = orderIds.filter((id) => ID_RE.test(id));
  if (ids.length === 0) return new Map();
  const rows = await loadBuyerContacts(db as never, {
    since: new Date(now.getTime() - ORDER_CONTACT_WINDOW_DAYS * 86_400_000),
    // id — cuid из нашей же выборки, отфильтрован регэкспом выше.
    orderWhereSql: `"id" IN (${ids.map((id) => `'${id}'`).join(",")})`,
  });
  return summarizeOrderContacts(rows);
}
