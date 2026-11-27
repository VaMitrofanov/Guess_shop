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
import { closeAiCards, manualMode, manualRow, sendAiEscalationCard } from "./wb-ai-cards";
import { mskTime } from "./notify-format";

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

/* 🥷 Человек ведёт разговор (27.11.2026, VWU5YU8). Владелец ответил руками в
   кабинете WB, а через 3 минуты в чат ушёл старый черновик воркера. Правило:
   пока в чате недавно писал человек (2 ч) — воркер сам не пишет, а предлагает
   ответ карточкой; его реплики идут модели с пометкой [менеджер], чтобы она
   продолжала разговор, а не начинала заново. Человек ответил и пропал, а
   покупатель ждёт 20 мин — воркер отправляет свой ответ сам (днём). */
export const HUMAN_TAKEOVER_MS = 2 * 3600_000;
export const HUMAN_SILENT_FALLBACK_MS = 20 * 60_000;

const norm = (t: string) => t.replace(/\s+/g, " ").trim().slice(0, 60).toLowerCase();

/** Автотексты, которые шлёт не человек: синк, заглушка, уведомления о выкупе. */
export function isAutoSellerText(text: string): boolean {
  return isHoldingText(text)
    || /^(Здравствуйте! Для успешного получения|Спасибо, код доставки получен|Ваш заказ выполнен|Код вашего заказа)/.test(text.trim());
}

export interface SellerMsg { text: string; sentAt: Date; local: boolean; viaTg?: boolean }

/**
 * Реплика продавца — от человека? Ответ из TG (локальная запись `via: tg-reply`)
 * — да. Текст из кабинета WB — да, если его нет среди ответов воркера и
 * автотекстов. Эхо WB ответа из TG тоже «человек» — для режима это то же самое.
 */
export function isHumanSellerMsg(m: SellerMsg, bot: Set<string>): boolean {
  if (m.local) return !!m.viaTg;
  return !isAutoSellerText(m.text) && !bot.has(norm(m.text));
}

export function botTextSet(texts: Array<string | null | undefined>): Set<string> {
  return new Set(texts.filter((t): t is string => !!t).map(norm));
}

/** Последняя реплика человека за окно (2 ч) — или null. */
export function lastHumanReply(msgs: SellerMsg[], bot: Set<string>, tgReplyTimes: Date[], now: number): Date | null {
  const since = now - HUMAN_TAKEOVER_MS;
  const times = [
    ...tgReplyTimes.map((d) => new Date(d).getTime()),
    ...msgs.filter((m) => isHumanSellerMsg(m, bot)).map((m) => new Date(m.sentAt).getTime()),
  ].filter((t) => t >= since);
  return times.length ? new Date(Math.max(...times)) : null;
}

/** Совместимость с тестами: писал ли человек за окно. */
export function humanRepliedRecently(msgs: SellerMsg[], botTexts: string[], tgReplyTimes: Date[], now: number): boolean {
  return lastHumanReply(msgs, botTextSet(botTexts), tgReplyTimes, now) !== null;
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

function sellerMsgOf(e: ChatEvent): SellerMsg {
  const meta = (e.attachmentsMeta ?? {}) as { via?: unknown };
  return { text: e.textRedacted ?? "", sentAt: e.sentAt, local: e.wbEventId.startsWith("local:"), viaTg: meta.via === "tg-reply" };
}

/** Кто ведёт чат: ручной режим или живой ответ человека за 2 ч. */
async function whoLeads(db: Db, orderId: string, code: string, chat: ChatEvent[], now: number) {
  const manual = await manualMode(db, orderId, now);
  const [tgReplies, botLog] = await Promise.all([
    db.wbMarketplaceEvent.findMany({
      where: { marketplaceOrderId: orderId, type: "TG_REPLY_SENT", createdAt: { gte: new Date(now - HUMAN_TAKEOVER_MS) } },
      select: { createdAt: true, actor: true }, orderBy: { createdAt: "desc" },
    }).catch(() => [] as { createdAt: Date; actor: string | null }[]),
    db.aiSupportLog.findMany({
      where: { orderCode: code, channel: "wb_chat", answer: { not: null } }, select: { answer: true }, take: 50, orderBy: { createdAt: "desc" },
    }).catch(() => [] as { answer: string | null }[]),
  ]);
  const bot = botTextSet(botLog.map((r: { answer: string | null }) => r.answer));
  const sellers = chat.filter((e) => !isBuyerSender(e.sender) && e.textRedacted);
  const lastHuman = lastHumanReply(sellers.map(sellerMsgOf), bot, tgReplies.map((r: { createdAt: Date }) => r.createdAt), now);
  const tgActor = tgReplies[0] && lastHuman && Math.abs(new Date(tgReplies[0].createdAt).getTime() - lastHuman.getTime()) < 120_000 ? tgReplies[0].actor : null;
  const by = manual?.by ?? (lastHuman ? tgActor ?? "менеджер в кабинете WB" : null);
  return { manual, lastHuman, by, bot, led: !!manual || !!lastHuman };
}

/**
 * ✅ Ответили в кабинете WB — открытые карточки заказа теряют «📤 Отправить».
 * Карточки, после которых в чате появилась реплика человека.
 */
async function closeAnsweredCards(db: Db, events: ChatEvent[], now: number): Promise<void> {
  const open = await db.wbMarketplaceEvent.findMany({
    where: { type: "AI_CHAT_ESCALATED", createdAt: { gte: new Date(now - 24 * 3600_000) } },
    select: { marketplaceOrderId: true, createdAt: true, payload: true },
  }).catch(() => [] as Array<{ marketplaceOrderId: string; createdAt: Date; payload: unknown }>);
  const done = new Set<string>();
  for (const ev of open) {
    const p = (ev.payload ?? {}) as { closed?: string; sentBy?: string; cards?: unknown[]; code?: string };
    if (p.closed || p.sentBy || !p.cards?.length || done.has(ev.marketplaceOrderId)) continue;
    const after = events.filter((e) => e.marketplaceOrderId === ev.marketplaceOrderId && !isBuyerSender(e.sender)
      && e.textRedacted && new Date(e.sentAt).getTime() > new Date(ev.createdAt).getTime());
    if (!after.length) continue;
    const botLog = p.code ? await db.aiSupportLog.findMany({
      where: { orderCode: p.code, channel: "wb_chat", answer: { not: null } }, select: { answer: true }, take: 50,
    }).catch(() => []) : [];
    const bot = botTextSet(botLog.map((r: { answer: string | null }) => r.answer));
    const human = after.map(sellerMsgOf).filter((m) => isHumanSellerMsg(m, bot) && !m.viaTg);
    if (!human.length) continue;
    done.add(ev.marketplaceOrderId);
    await closeAiCards(db, ev.marketplaceOrderId, `✅ ответили в кабинете WB ${mskTime(new Date(human[human.length - 1].sentAt))}`);
  }
}

/**
 * Ответ на нашу просьбу (27.11.2026, TM6MZJ3): мы попросили ник, покупатель прислал
 * «ACMVPO» — модель решила, что это код заказа. Если последняя наша реплика
 * просила ник/пасс, а покупатель ответил одним словом — подсказка, чем оно является.
 */
export function replyHint(history: { role: "user" | "assistant"; text: string }[], orderCode?: string | null): string | null {
  let i = history.length - 1;
  const tail: string[] = [];
  while (i >= 0 && history[i].role === "user") tail.unshift(history[i--].text.trim());
  const ours = i >= 0 ? history[i].text.toLowerCase() : "";
  const word = tail.join(" ").trim();
  if (!ours || !/^\S{3,20}$/.test(word)) return null;
  if (orderCode && word.toUpperCase() === orderCode.toUpperCase()) return null;
  const asks = /(пришлите|напишите|укажите|отправьте|скиньте)/.test(ours);
  if (asks && /ник/.test(ours) && !/^\d+$/.test(word)) {
    return `Покупатель ответил на нашу просьбу прислать ник: «${word}» — это НИК Roblox, а не код. Не переспрашивай и не называй его кодом. Смену ника делает менеджер: escalate, черновик — «Спасибо, ник ${word} получили, меняем его в заказе и напишем здесь же».`;
  }
  if (asks && /(геймпасс|game-pass|id пасса|ссылк)/.test(ours) && /^\d{6,}$/.test(word)) {
    return `Покупатель ответил на нашу просьбу: «${word}» — это ID геймпасса, а не код.`;
  }
  return null;
}

export async function runWbChatAiSweep(db: Db, now = Date.now()): Promise<{ seen: number; replied: number; escalated: number; dry: number }> {
  const out = { seen: 0, replied: 0, escalated: 0, dry: 0 };
  const mode = await supportChannelMode(db, "wb_chat");
  if (mode === "off") return out;

  const events: ChatEvent[] = await db.wbBuyerChatEvent.findMany({
    where: { sentAt: { gte: new Date(now - MAX_AGE_MS) } },
    orderBy: { sentAt: "desc" },
    take: 1000,
    select: { id: true, wbEventId: true, chatId: true, sender: true, textRedacted: true, containsDeliveryCode: true, sentAt: true, marketplaceOrderId: true, attachmentsMeta: true },
  });
  if (mode === "on") await closeAnsweredCards(db, events, now).catch((e) => console.warn("[wb-chat-ai] закрытие карточек:", e?.message ?? e));
  // Ответы из TG пишутся локальными записями: для «кто ведёт» они нужны,
  // а «ждёт ли чат ответа» решает только то, что пришло из WB.
  const wbEvents = events.filter((e) => !e.wbEventId.startsWith("local:"));

  for (const last of chatsAwaitingReply(wbEvents, now).slice(0, PER_PASS)) {
    const key = `ai-chat:${last.wbEventId}`;
    const done = await db.wbMarketplaceEvent.findUnique({ where: { idempotencyKey: key }, select: { id: true, type: true, payload: true, marketplaceOrderId: true } });
    if (done) {
      if (mode === "on") await fallbackIfHumanSilent(db, done, last, events, now);
      continue;
    }
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

    const chat = events.filter((e) => e.chatId === last.chatId);
    const lead = await whoLeads(db, order.id, ref.code, chat, now);
    // Контекст: реплики человека помечены — модель продолжает за ним.
    const history: SupportTurn[] = chat
      .filter((e) => eventTextForAi(e))
      .sort((a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime())
      .slice(-16)
      .map((e) => {
        if (isBuyerSender(e.sender)) return { role: "user" as const, text: eventTextForAi(e) };
        const human = isHumanSellerMsg(sellerMsgOf(e), lead.bot);
        return { role: "assistant" as const, text: human ? `[менеджер] ${eventTextForAi(e)}` : eventTextForAi(e) };
      });
    const asked = buyerTailText(history) || text;
    const leadLine = lead.led
      ? `Разговор сейчас ведёт менеджер (его реплики помечены [менеджер]). Продолжай за ним: не повторяй то, что он или ты уже предложили, не противоречь ему, отвечай на последний вопрос покупателя с учётом сказанного менеджером. Пометку [менеджер] в ответ не пиши.`
      : null;

    const imageId = latestBuyerImageId(wbEvents, last.chatId);
    const image = imageId ? await downloadBuyerChatImage(imageId) : null;
    if (imageId && !image) console.warn(`[wb-chat-ai] картинка ${ref.code} не скачалась — отвечаем по тексту`);
    const ocrLine = image ? await screenshotFact(image.data, orders[0]?.amount, orders[0]?.robloxUsername) : null;
    const hintLine = replyHint(history.map((t) => ({ ...t, text: t.text.replace(/^\[менеджер\] /, "") })), ref.code);
    const fullContext = [context, ocrLine, leadLine, hintLine].filter(Boolean).join("\n");
    const raw = await decideSupport({ channel: "wb_chat", context: fullContext, turns: history, ...(image ? { image } : {}) });
    const mark = (type: string, payload: Record<string, unknown>) =>
      db.wbMarketplaceEvent.upsert({
        where: { idempotencyKey: key },
        create: { marketplaceOrderId: order.id, type, idempotencyKey: key, actor: "wb-chat-ai", payload },
        update: {},
      });
    const who = await identityLinesFor(db, order.id).catch(() => [] as string[]);

    if (!raw || raw === "out_of_money") {
      if (mode === "on") notifyDbsBuyerMessage(ref, asked, who);
      await mark("AI_CHAT_FAILED", { reason: raw ?? "no_answer" });
      continue;
    }
    const decided = guardDecision(raw, text, "wb_chat", {
      greeted: history.some((t) => t.role === "assistant"),
      known: `${context}\n${history.map((t) => t.text).join("\n")}`,
    });
    // Человек ведёт чат — ответ воркера становится предложением с кнопкой.
    const d = lead.led && decided.action === "reply"
      ? { ...decided, action: "escalate" as const, draft: decided.reply, summary: decided.summary || "" }
      : decided;
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
      const sent = await notifyBuyerViaWbChat(db, ref.code, plain(d.reply), { skipIfClaimOpen: false });
      if (sent.sent) {
        out.replied++;
        await closeAiCards(db, order.id, `🤖 ответил воркер ${mskTime(new Date(now))}`);
        void aiLogCard(db, [
          `🤖 <b>Чат WB: ответил сам</b> · ${CATEGORY_RU[d.category]}`,
          `👤 ${escapeHtml(order.buyerName ?? "покупатель")} · чат WB`,
          `📦 ${ref.code}${orders[0] ? ` · ${orders[0].amount} R$ · ${orders[0].status}` : ""}`,
          "",
          `💬 «${escapeHtml(asked.slice(0, 600))}»`,
          "",
          `🤖 ${escapeHtml(plain(d.reply))}`,
        ].join("\n"), { silent: true, keyboard: [manualRow(order.id, false)] });
        await mark("AI_CHAT_REPLIED", { category: d.category });
        continue;
      }
      notifyDbsAiEscalation(ref, { text: asked, summary: `Ответ не ушёл в чат WB (${sent.reason ?? "ошибка"}) — отправьте сами`, draft: plain(d.reply), category: CATEGORY_RU[d.category] }, who);
      await mark("AI_CHAT_SEND_FAILED", { reason: sent.reason ?? null });
      continue;
    }
    if (d.action === "escalate") {
      const draft = plain(d.draft || "").trim();
      // Новая карточка — у прежних «Отправить» больше не нажать.
      await closeAiCards(db, order.id, "⤵️ есть ответ новее");
      const leadText = lead.led
        ? lead.manual
          ? `Ведёт ${lead.manual.by} (✋) — воркер только предлагает`
          : `Чат ведёт ${lead.by} — воркер предлагает${isNightMsk(new Date(now)) ? "" : `; молчим 20 мин — отправит сам`}`
        : null;
      const cards = await sendAiEscalationCard(ref, order.id, {
        text: asked, summary: d.summary, draft, category: d.category, categoryRu: CATEGORY_RU[d.category],
        sendKey: last.wbEventId, manual: !!lead.manual, lead: leadText,
      }, who);
      out.escalated++;
      // 🕐 Заглушка — только если разговор ещё никто из людей не ведёт.
      if (!lead.led && !history.some((t) => t.role === "assistant" && isHoldingText(t.text))) {
        await notifyBuyerViaWbChat(db, ref.code, holdingText(), { skipIfClaimOpen: false }).catch(() => undefined);
      }
      await mark("AI_CHAT_ESCALATED", {
        category: d.category, draft: draft || null, code: ref.code, cards, sendKey: last.wbEventId,
        humanLed: lead.led && !lead.manual && !!draft && decided.action === "reply",
      });
      continue;
    }
    await mark("AI_CHAT_IGNORED", { category: d.category });
  }
  return out;
}

/**
 * 4️⃣ Человек ответил и пропал: покупатель ждёт 20 мин, а в чате тишина —
 * воркер отправляет предложенный ответ сам. Только если модель сама хотела
 * ответить (а не звала человека), не ночью и не в ручном режиме.
 */
async function fallbackIfHumanSilent(db: Db, done: { id: string; type: string; payload: unknown; marketplaceOrderId: string }, last: ChatEvent, events: ChatEvent[], now: number): Promise<void> {
  const p = (done.payload ?? {}) as { humanLed?: boolean; sentBy?: string; autoSent?: string; closed?: string; draft?: string; code?: string };
  if (done.type !== "AI_CHAT_ESCALATED" || !p.humanLed || p.sentBy || p.autoSent || p.closed || !p.draft || !p.code) return;
  if (now - new Date(last.sentAt).getTime() < HUMAN_SILENT_FALLBACK_MS || isNightMsk(new Date(now))) return;
  if (await manualMode(db, done.marketplaceOrderId, now)) return;
  // После сообщения покупателя кто-то ответил из TG (локальная запись) — молчим.
  if (events.some((e) => e.chatId === last.chatId && !isBuyerSender(e.sender) && new Date(e.sentAt).getTime() > new Date(last.sentAt).getTime())) return;
  const sent = await notifyBuyerViaWbChat(db, p.code, p.draft, { skipIfClaimOpen: false });
  if (!sent.sent) return;
  const at = new Date(now);
  await db.wbMarketplaceEvent.update({ where: { id: done.id }, data: { payload: { ...p, autoSent: at.toISOString() } } }).catch(() => undefined);
  await closeAiCards(db, done.marketplaceOrderId, `🤖 20 мин тишины — отправил воркер ${mskTime(at)}`);
}
