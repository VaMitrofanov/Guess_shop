/* ─────────────────────────────────────────────────────────────────────────────
   ИИ в чатах заказов WB (13.11.2026). Живёт в TG-боте рядом с синком DBS.

   Не в цикле синка: модель отвечает секунды, а синк каждые 5 с ловит коды
   доставки. Отдельный проход раз в минуту берёт чаты, где последнее слово —
   покупателя (старше 90 с, моложе суток) и на него ещё никто не ответил.

   Берём только то, что автоматика не решает сама:
   • заказ с выданным кодом гейта (до выдачи разговор про доставку — человеку);
   • без кода доставки, без пасса в тексте (их разбирает синк);
   • «где робуксы?» по выкупленному заказу — на него есть точный ответ синка;
   • без открытой заявки на возврат и отмены.

   Режимы (`/support_mode wb on|dry|off`): dry — только карточка «бот ответил
   бы», on — отвечает в чат WB сам, проблемы — в нить заказа с черновиком.
   Сбой модели в режиме on — обычное «сообщение покупателя» админам, как до ИИ.
   ───────────────────────────────────────────────────────────────────────── */

import { CATEGORY_RU, guardDecision, plain } from "./pa-ai-support";
import { decideSupport, supportChannelMode, type SupportTurn } from "./support-ai";
import { loadSupportCustomer } from "./support-ai-context";
import { findGamepassRefInChatText } from "./wb-chat-gamepass";
import { isArrivalQuestion } from "./robux-eta";
import { dbsRef } from "./wb-dbs-thread";
import { identityLinesFor } from "./buyer-identity";
import { notifyBuyerViaWbChat } from "./wb-chat-notify";
import { notifyDbsAiEscalation, notifyDbsBuyerMessage } from "./wb-delivery-admin-notify";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

const MIN_AGE_MS = 90_000;
const MAX_AGE_MS = 24 * 3600_000;
const PER_PASS = 10;

export function isBuyerSender(sender: string): boolean {
  return !/seller|supplier|manager/i.test(sender);
}

/** Сообщение, которое ИИ может взять, — без похода в базу. */
export function wbChatTextForAi(text: string | null | undefined, nmId?: number | null): boolean {
  const t = (text ?? "").trim();
  if (t.length < 2) return false;
  if (/\d{3}\s?\d{3}/.test(t) && t.replace(/\D/g, "").length >= 5 && t.length < 20) return false;
  if (findGamepassRefInChatText(t, nmId)) return false;
  return true;
}

/**
 * Синк спрашивает перед обычным уведомлением «сообщение покупателя»: в режиме
 * on это сообщение возьмёт ИИ (и при сбое сам позовёт человека).
 */
export async function wbChatAiTakesOver(
  db: Db,
  order: { wbCodeId?: string | null; cancelledAt: Date | null; claimOpenedAt?: Date | null; nmId?: number | null },
  text: string,
): Promise<boolean> {
  if (!order.wbCodeId || order.cancelledAt || order.claimOpenedAt) return false;
  if (isArrivalQuestion(text) || !wbChatTextForAi(text, order.nmId)) return false;
  return (await supportChannelMode(db, "wb_chat")) === "on";
}

interface ChatEvent { id: string; wbEventId: string; chatId: string; sender: string; textRedacted: string | null; containsDeliveryCode: boolean; sentAt: Date; marketplaceOrderId: string | null }

/** Последнее событие каждого чата за сутки: ждёт ответа, если оно от покупателя. */
export function chatsAwaitingReply(events: ChatEvent[], now: number): ChatEvent[] {
  const latest = new Map<string, ChatEvent>();
  for (const e of events) {
    const cur = latest.get(e.chatId);
    if (!cur || new Date(e.sentAt).getTime() > new Date(cur.sentAt).getTime()) latest.set(e.chatId, e);
  }
  return [...latest.values()].filter((e) => {
    const age = now - new Date(e.sentAt).getTime();
    return isBuyerSender(e.sender) && age >= MIN_AGE_MS && age <= MAX_AGE_MS
      && !!e.marketplaceOrderId && !!e.textRedacted?.trim() && !e.containsDeliveryCode;
  });
}

export async function runWbChatAiSweep(db: Db, now = Date.now()): Promise<{ seen: number; replied: number; escalated: number; dry: number }> {
  const out = { seen: 0, replied: 0, escalated: 0, dry: 0 };
  const mode = await supportChannelMode(db, "wb_chat");
  if (mode === "off") return out;

  const events: ChatEvent[] = await db.wbBuyerChatEvent.findMany({
    where: { sentAt: { gte: new Date(now - MAX_AGE_MS) }, NOT: { wbEventId: { startsWith: "local:" } } },
    orderBy: { sentAt: "desc" },
    take: 800,
    select: { id: true, wbEventId: true, chatId: true, sender: true, textRedacted: true, containsDeliveryCode: true, sentAt: true, marketplaceOrderId: true },
  });

  for (const last of chatsAwaitingReply(events, now).slice(0, PER_PASS)) {
    const key = `ai-chat:${last.wbEventId}`;
    const done = await db.wbMarketplaceEvent.findUnique({ where: { idempotencyKey: key }, select: { id: true } });
    if (done) continue;
    const order = await db.wbMarketplaceOrder.findUnique({
      where: { id: last.marketplaceOrderId! },
      select: { id: true, wbOrderId: true, nmId: true, wbCodeId: true, cancelledAt: true, claimOpenedAt: true, buyerName: true, isTest: true },
    });
    const text = last.textRedacted!.trim();
    if (!order || order.isTest || !order.wbCodeId || order.cancelledAt || order.claimOpenedAt) continue;
    if (!wbChatTextForAi(text, order.nmId)) continue;
    const ref = await dbsRef(db, order.id, order.wbOrderId);
    if (!ref.code) continue;
    const { context, orders } = await loadSupportCustomer(db, { wbCodes: [ref.code], name: order.buyerName });
    if (isArrivalQuestion(text) && orders[0]?.status === "COMPLETED") continue;
    out.seen++;

    const history: SupportTurn[] = events
      .filter((e) => e.chatId === last.chatId && e.textRedacted?.trim())
      .sort((a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime())
      .slice(-12)
      .map((e) => ({ role: isBuyerSender(e.sender) ? "user" as const : "assistant" as const, text: e.textRedacted!.trim() }));

    const raw = await decideSupport({ channel: "wb_chat", context, turns: history });
    const mark = (type: string, payload: Record<string, string | number | boolean | null>) =>
      db.wbMarketplaceEvent.upsert({
        where: { idempotencyKey: key },
        create: { marketplaceOrderId: order.id, type, idempotencyKey: key, actor: "wb-chat-ai", payload },
        update: {},
      });
    const who = await identityLinesFor(db, order.id).catch(() => [] as string[]);

    if (!raw || raw === "out_of_money") {
      // Синк в режиме on промолчал, полагаясь на ИИ, — значит, человека зовём мы.
      if (mode === "on") notifyDbsBuyerMessage(ref, text, who);
      await mark("AI_CHAT_FAILED", { reason: raw ?? "no_answer" });
      continue;
    }
    const d = guardDecision(raw, text, "wb_chat");

    if (mode === "dry") {
      if (d.action !== "ignore") {
        notifyDbsAiEscalation(ref, {
          text,
          summary: d.action === "reply" ? `🧪 тест — бот ответил бы сам: ${plain(d.reply)}` : `🧪 тест — бот передал бы вам: ${d.summary}`,
          draft: d.action === "escalate" ? d.draft : "",
          category: CATEGORY_RU[d.category],
        }, who);
        out.dry++;
      }
      await mark("AI_CHAT_DRY", { action: d.action, category: d.category });
      continue;
    }

    if (d.action === "reply") {
      const sent = await notifyBuyerViaWbChat(db, ref.code, plain(d.reply), { skipIfClaimOpen: true });
      if (sent.sent) {
        out.replied++;
        await mark("AI_CHAT_REPLIED", { category: d.category });
        continue;
      }
      notifyDbsAiEscalation(ref, { text, summary: `Ответ не ушёл в чат WB (${sent.reason ?? "ошибка"}) — отправьте сами`, draft: plain(d.reply), category: CATEGORY_RU[d.category] }, who);
      await mark("AI_CHAT_SEND_FAILED", { reason: sent.reason ?? null });
      continue;
    }
    if (d.action === "escalate") {
      notifyDbsAiEscalation(ref, { text, summary: d.summary, draft: d.draft, category: CATEGORY_RU[d.category] }, who);
      out.escalated++;
    }
    await mark(d.action === "escalate" ? "AI_CHAT_ESCALATED" : "AI_CHAT_IGNORED", { category: d.category });
  }
  return out;
}
