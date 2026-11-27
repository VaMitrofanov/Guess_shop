/* ─────────────────────────────────────────────────────────────────────────────
   ИИ в чатах заказов WB (13.11.2026). Живёт в TG-боте рядом с синком DBS.

   Не в цикле синка: модель отвечает секунды, а синк каждые 5 с ловит коды
   доставки. Отдельный проход раз в минуту берёт чаты, где последнее слово —
   покупателя (старше 90 с, моложе суток) и на него ещё никто не ответил.

   Берём только то, что автоматика не решает сама:
   • заказ с выданным кодом гейта (до выдачи разговор про доставку — человеку);
   • без кода доставки, без пасса в тексте (их разбирает синк);
   • «где робуксы?» по выкупленному заказу — на него есть точный ответ синка;
   • без отмены. Открытая заявка на возврат (27.11.2026) — берём: заказ остаётся
     в очереди (заявка — только пометка), ИИ отвечает по этапу и предлагает
     отменить заявку, если робуксы нужны.
   • Картинки (27.11.2026): до этого дня ни одна из 61 картинки покупателей за
     две недели не доходила до модели — событие без текста пропускалось, а
     следом ИИ отвечал «снимок не прикрепился». Теперь свежая картинка из
     последних сообщений покупателя качается из WB и идёт модели.

   Режимы (`/support_mode wb on|dry|off`): dry — только карточка «бот ответил
   бы», on — отвечает в чат WB сам, проблемы — в нить заказа с черновиком.
   Сбой модели в режиме on — обычное «сообщение покупателя» админам, как до ИИ.
   ───────────────────────────────────────────────────────────────────────── */

import { CATEGORY_RU, guardDecision, plain } from "./pa-ai-support";
import { downloadBuyerChatImage } from "./wb-delivery-api";
import { screenshotFact } from "./support-ai-facts";
import { decideSupport, supportChannelMode, type SupportTurn } from "./support-ai";
import { loadSupportCustomer } from "./support-ai-context";
import { findGamepassRefInChatText } from "./wb-chat-gamepass";
import { isArrivalQuestion } from "./robux-eta";
import { dbsRef } from "./wb-dbs-thread";
import { identityLinesFor } from "./buyer-identity";
import { notifyBuyerViaWbChat } from "./wb-chat-notify";
import { aiLogCard, aiLogRecord } from "./support-ai-log";
import { escapeHtml } from "./notify";
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
  if (!order.wbCodeId || order.cancelledAt) return false;
  // Заявка открыта — синк молчит про «где робуксы» сам, ответит ИИ (27.11.2026).
  if ((!order.claimOpenedAt && isArrivalQuestion(text)) || !wbChatTextForAi(text, order.nmId)) return false;
  return (await supportChannelMode(db, "wb_chat")) === "on";
}

/** Ночь по МСК (23:00–09:00): люди спят, обещать «скоро» нельзя. */
export function isNightMsk(now = new Date()): boolean {
  const h = (now.getUTCHours() + 3) % 24;
  return h >= 23 || h < 9;
}

/** Заглушка покупателю, когда вопрос ушёл человеку (владелец 27.11.2026: «да»). */
export function holdingText(now = new Date()): string {
  return isNightMsk(now)
    ? "Передали ваш вопрос коллеге — ответим утром здесь же, в этом чате."
    : "Передали ваш вопрос коллеге — ответим здесь же, в этом чате.";
}

export function isHoldingText(text: string): boolean {
  return /^Передали ваш вопрос коллеге/.test(text.trim());
}

interface ChatEvent { id: string; wbEventId: string; chatId: string; sender: string; textRedacted: string | null; containsDeliveryCode: boolean; sentAt: Date; marketplaceOrderId: string | null; attachmentsMeta?: unknown }

/** `downloadID` картинок события WB — не больше трёх, только похожие на id. */
export function wbChatImageIds(images: unknown[] | undefined): string[] {
  return (images ?? [])
    .map((i) => (i && typeof i === "object" ? (i as { downloadID?: unknown }).downloadID : null))
    .filter((id): id is string => typeof id === "string" && /^[\w-]{8,80}$/.test(id))
    .slice(0, 3);
}

/** Сколько картинок в событии и их `downloadID` (`imageIds` пишет синк с 27.11.2026). */
export function eventImages(e: Pick<ChatEvent, "attachmentsMeta">): { count: number; ids: string[] } {
  const m = (e.attachmentsMeta ?? {}) as { images?: unknown; imageIds?: unknown };
  const ids = Array.isArray(m.imageIds) ? m.imageIds.filter((x): x is string => typeof x === "string") : [];
  const count = typeof m.images === "number" ? m.images : ids.length;
  return { count, ids };
}

/** Текст события для модели: картинка без подписи — пометкой. */
export function eventTextForAi(e: Pick<ChatEvent, "textRedacted" | "attachmentsMeta">): string {
  const text = e.textRedacted?.trim() ?? "";
  if (eventImages(e).count === 0) return text;
  return text ? `[прислал скриншот] ${text}` : "[прислал скриншот]";
}

/**
 * Последние сообщения покупателя после нашего ответа — самая свежая картинка
 * среди них. Покупатель шлёт скрин, а следом «вот» или «увидели?».
 */
export function latestBuyerImageId(events: ChatEvent[], chatId: string): string | null {
  const chat = events.filter((e) => e.chatId === chatId)
    .sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime());
  for (const e of chat) {
    if (!isBuyerSender(e.sender)) return null;
    const ids = eventImages(e).ids;
    if (ids.length) return ids[ids.length - 1];
  }
  return null;
}

/**
 * Все реплики покупателя после нашего последнего ответа — для карточки и журнала.
 * Покупатель пишет очередью («Что за геймпасс?» / «Я делаю дочке» / «Сейчас скрин»),
 * ИИ отвечает на всю очередь, а в карточке было только последнее — ответ
 * выглядел выдуманным (VWU5YU8, 27.11.2026).
 */
export function buyerTailText(history: SupportTurn[]): string {
  const tail: string[] = [];
  for (let i = history.length - 1; i >= 0 && history[i].role === "user"; i--) tail.unshift(history[i].text);
  return tail.join("\n");
}

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
      && !!e.marketplaceOrderId && !!eventTextForAi(e) && !e.containsDeliveryCode;
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
    select: { id: true, wbEventId: true, chatId: true, sender: true, textRedacted: true, containsDeliveryCode: true, sentAt: true, marketplaceOrderId: true, attachmentsMeta: true },
  });

  for (const last of chatsAwaitingReply(events, now).slice(0, PER_PASS)) {
    const key = `ai-chat:${last.wbEventId}`;
    const done = await db.wbMarketplaceEvent.findUnique({ where: { idempotencyKey: key }, select: { id: true } });
    if (done) continue;
    const order = await db.wbMarketplaceOrder.findUnique({
      where: { id: last.marketplaceOrderId! },
      select: { id: true, wbOrderId: true, nmId: true, wbCodeId: true, cancelledAt: true, claimOpenedAt: true, buyerName: true, isTest: true },
    });
    const text = eventTextForAi(last);
    if (!order || order.isTest || !order.wbCodeId || order.cancelledAt) continue;
    if (!wbChatTextForAi(text, order.nmId)) continue;
    const ref = await dbsRef(db, order.id, order.wbOrderId);
    if (!ref.code) continue;
    const { context, orders } = await loadSupportCustomer(db, { wbCodes: [ref.code], name: order.buyerName });
    if (!order.claimOpenedAt && isArrivalQuestion(text) && orders[0]?.status === "COMPLETED") continue;
    out.seen++;

    const history: SupportTurn[] = events
      .filter((e) => e.chatId === last.chatId && eventTextForAi(e))
      .sort((a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime())
      .slice(-12)
      .map((e) => ({ role: isBuyerSender(e.sender) ? "user" as const : "assistant" as const, text: eventTextForAi(e) }));

    const asked = buyerTailText(history) || text;

    const imageId = latestBuyerImageId(events, last.chatId);
    const image = imageId ? await downloadBuyerChatImage(imageId) : null;
    if (imageId && !image) console.warn(`[wb-chat-ai] картинка ${ref.code} не скачалась — отвечаем по тексту`);
    const ocrLine = image ? await screenshotFact(image.data, orders[0]?.amount, orders[0]?.robloxUsername) : null;
    const raw = await decideSupport({ channel: "wb_chat", context: ocrLine ? `${context}\n${ocrLine}` : context, turns: history, ...(image ? { image } : {}) });
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
    const d = guardDecision(raw, text, "wb_chat", {
      // Наш автотекст в чате («код получен», инструкция) — тоже «уже поздоровались».
      greeted: history.some((t) => t.role === "assistant"),
      known: `${context}\n${history.map((t) => t.text).join("\n")}`,
    });
    void aiLogRecord(db, {
      channel: "wb_chat", action: d.action, mode: mode as "on" | "dry", category: d.category,
      peerKey: `wb:${ref.code}`, orderCode: ref.code,
      question: asked, answer: d.action === "reply" ? plain(d.reply) : d.draft || null, summary: d.summary || null,
    });

    if (mode === "dry") {
      if (d.action !== "ignore") {
        notifyDbsAiEscalation(ref, {
          text: asked,
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
      // Заявка открыта — ИИ как раз и объясняет, что выкуп остановлен (27.11.2026).
      const sent = await notifyBuyerViaWbChat(db, ref.code, plain(d.reply), { skipIfClaimOpen: false });
      if (sent.sent) {
        out.replied++;
        // Журнал: каждый ответ ИИ виден админам, без звука (26.11.2026).
        void aiLogCard(db, [
          `🤖 <b>Чат WB: ответил сам</b> · ${CATEGORY_RU[d.category]}`,
          `👤 ${escapeHtml(order.buyerName ?? "покупатель")} · чат WB`,
          `📦 ${ref.code}${orders[0] ? ` · ${orders[0].amount} R$ · ${orders[0].status}` : ""}`,
          "",
          `💬 «${escapeHtml(asked.slice(0, 600))}»`,
          "",
          `🤖 ${escapeHtml(plain(d.reply))}`,
        ].join("\n"), { silent: true });
        await mark("AI_CHAT_REPLIED", { category: d.category });
        continue;
      }
      notifyDbsAiEscalation(ref, { text: asked, summary: `Ответ не ушёл в чат WB (${sent.reason ?? "ошибка"}) — отправьте сами`, draft: plain(d.reply), category: CATEGORY_RU[d.category] }, who);
      await mark("AI_CHAT_SEND_FAILED", { reason: sent.reason ?? null });
      continue;
    }
    if (d.action === "escalate") {
      const draft = plain(d.draft || "").trim();
      notifyDbsAiEscalation(ref, { text: asked, summary: d.summary, draft, category: CATEGORY_RU[d.category], sendKey: last.wbEventId }, who);
      out.escalated++;
      // 🕐 Покупатель на WB при передаче не получал НИЧЕГО (27.11.2026: 22 из 30
      // обращений, ответ человека — часами). Одна заглушка на разговор.
      if (!history.some((t) => t.role === "assistant" && isHoldingText(t.text))) {
        await notifyBuyerViaWbChat(db, ref.code, holdingText(), { skipIfClaimOpen: false }).catch(() => undefined);
      }
      await mark("AI_CHAT_ESCALATED", { category: d.category, draft: draft || null, code: ref.code });
      continue;
    }
    await mark("AI_CHAT_IGNORED", { category: d.category });
  }
  return out;
}
