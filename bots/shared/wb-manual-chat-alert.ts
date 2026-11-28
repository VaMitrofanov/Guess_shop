/**
 * 800code и прочие заказы без номинала ведутся вручную: бот в их чатах молчит
 * намеренно (решение владельца 16.11.2026). До 23.11.2026 о том, что такой
 * покупатель пишет, админы узнавали только обычным «покупатель пишет» — его
 * легко пропустить среди прочих — или через 2 ч сигналом «доставка висит».
 * 6325347265: код доставки в 09:59, «вы тут?» в 10:30, ответ только в 12:47;
 * за неделю 5 из 12 таких обращений остались без ответа.
 *
 * Теперь: первое сообщение покупателя, на которое за минуту никто не ответил, —
 * один громкий сигнал на заказ, сразу с кодом доставки (без него заказ в
 * кабинете WB не закрыть). Минута нужна, чтобы «Здравствуйте» и код следом
 * пришли одним сигналом, а не двумя. Ответили раньше — сигнала нет.
 */

export const MANUAL_CHAT_ALERTED = "MANUAL_CHAT_ALERTED";
export const MANUAL_CHAT_ALERT_DELAY_MS = 60_000;
const LOOKBACK_MS = 24 * 60 * 60_000;
const WB_SYSTEM_LINE_RE = /чат с покупателем по товару/i;

export type ManualChatAlert = {
  orderId: string;
  wbOrderId: string;
  nmId: number;
  firstAt: Date;
  texts: string[];
  /** Зашифрованный код доставки, если он у нас и ещё не использован. */
  deliveryCodeEncrypted: string | null;
};

type Row = { sender: string; sentAt: Date; textRedacted: string | null };

/** Чистое решение по ленте одного заказа: `null` — сигналить не о чем. */
export function manualChatDecision(events: Row[], now: number): { firstAt: Date; texts: string[] } | "answered" | null {
  const sorted = [...events].sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
  const isBuyer = (e: Row) => e.sender === "client" && !WB_SYSTEM_LINE_RE.test(e.textRedacted ?? "");
  const first = sorted.find(isBuyer);
  if (!first) return null;
  const answered = sorted.some((e) => e.sender !== "client" && e.sentAt.getTime() >= first.sentAt.getTime());
  if (answered) return "answered";
  if (now - first.sentAt.getTime() < MANUAL_CHAT_ALERT_DELAY_MS) return null;
  const texts = sorted.filter(isBuyer).map((e) => (e.textRedacted ?? "").trim()).filter(Boolean).slice(-4);
  return { firstAt: first.sentAt, texts };
}

type Db = {
  wbMarketplaceOrder: { findMany: (args: unknown) => Promise<Array<{
    id: string; wbOrderId: string; nmId: number;
    deliverySecret: { encryptedValue: string; consumedAt: Date | null; expiresAt: Date } | null;
    chatEvents: Row[];
  }>> };
  wbMarketplaceEvent: { upsert: (args: unknown) => Promise<unknown> };
};

/**
 * Находит заказы без номинала с неотвеченным покупателем. Помечает событием
 * `MANUAL_CHAT_ALERTED` и те, что уже ответили, — иначе они проверялись бы
 * каждый цикл ещё сутки.
 */
export async function collectManualChatAlerts(db: Db, now = Date.now()): Promise<ManualChatAlert[]> {
  const since = new Date(now - LOOKBACK_MS);
  const orders = await db.wbMarketplaceOrder.findMany({
    where: {
      denominationSnapshot: null,
      isTest: false,
      cancelledAt: null,
      events: { none: { type: MANUAL_CHAT_ALERTED } },
      chatEvents: { some: { sender: "client", sentAt: { gte: since } } },
    },
    select: {
      id: true, wbOrderId: true, nmId: true,
      deliverySecret: { select: { encryptedValue: true, consumedAt: true, expiresAt: true } },
      chatEvents: {
        where: { sentAt: { gte: since } },
        select: { sender: true, sentAt: true, textRedacted: true },
        orderBy: { sentAt: "asc" },
        take: 50,
      },
    },
    take: 10,
  });
  const out: ManualChatAlert[] = [];
  for (const order of orders) {
    const decision = manualChatDecision(order.chatEvents, now);
    if (!decision) continue;
    const answered = decision === "answered";
    await db.wbMarketplaceEvent.upsert({
      where: { idempotencyKey: `manual-chat-alert:${order.id}` },
      create: {
        marketplaceOrderId: order.id,
        type: MANUAL_CHAT_ALERTED,
        idempotencyKey: `manual-chat-alert:${order.id}`,
        actor: "wb-sync",
        payload: { answered },
      },
      update: {},
    });
    if (answered) continue;
    const secret = order.deliverySecret;
    const live = secret && !secret.consumedAt && secret.expiresAt.getTime() > now;
    out.push({
      orderId: order.id,
      wbOrderId: order.wbOrderId,
      nmId: order.nmId,
      firstAt: decision.firstAt,
      texts: decision.texts,
      deliveryCodeEncrypted: live ? secret.encryptedValue : null,
    });
  }
  return out;
}
