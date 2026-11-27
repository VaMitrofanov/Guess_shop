/* ─────────────────────────────────────────────────────────────────────────────
   🥷 Карточки воркера ИИ в чатах WB: мы отвечаем, воркер не мешает (27.11.2026).

   Разбор VWU5YU8: владелец ответил руками в кабинете WB, а через три минуты
   коллега нажал «📤 Отправить» на карточке, черновик которой был написан ДО
   этого ответа, — покупательница получила повтор «двух вариантов».

   Что здесь:
   • id сообщений карточки «ИИ передал вам» лежат в событии `ai-chat:<id>`
     (payload.cards) — по ним карточку можно переписать потом;
   • `closeAiCards` — у открытых карточек заказа кнопка «📤 Отправить» сменяется
     строкой-фактом: «✅ ответил @x 08:41», «⤵️ есть ответ новее», «🤖 отправил
     воркер»; нажать на устаревший ответ больше нельзя;
   • «✋ Веду сам» / «🤖 Вернуть воркеру» — ручной режим заказа событиями
     AI_CHAT_MANUAL_ON/OFF: воркер молчит и не подхватывает, только предлагает.
     Сам гаснет через сутки — забытый режим не должен глушить чат навсегда;
   • «🔐 Взять аккаунт» — готовая просьба прислать логин и пароль + пометка
     заказа «Делаем за клиента».
   ───────────────────────────────────────────────────────────────────────── */

import { escapeHtml, tgSend, tgMessageId } from "./notify";
import { formatAdminNotice, mskTime, orderRef } from "./notify-format";
import { adminTargetsForNotice, replyToRootFor, twaStartappUrl } from "./admin-route";
import type { DbsRef } from "./wb-delivery-admin-notify";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export const WB_AI_SEND_CB = "wbais:";
export const WB_AI_MANUAL_CB = "wbaim:";
export const WB_AI_AUTO_CB = "wbaia:";
export const WB_AI_ACCOUNT_CB = "wbaik:";
export const WB_AI_NOOP_CB = "wbai0";

/** Ручной режим живёт не дольше суток. */
export const MANUAL_TTL_MS = 24 * 3600_000;

export const ACCOUNT_HANDOFF_TEXT =
  "Хорошо, сделаем сами. Пришлите, пожалуйста, данные для входа в аккаунт Roblox — логин и пароль. " +
  "Возможно, Roblox попросит подтвердить вход (код на почту или в приложении) — будьте, пожалуйста, рядом с телефоном. " +
  "После того как всё настроим, пароль лучше сменить.";

type Btn = { text: string; callback_data: string } | { text: string; url: string };
export type CardRef = { c: string; m: number };

/** Ряд «✋ Веду сам» или «🤖 Вернуть воркеру» — по текущему режиму. */
export function manualRow(orderId: string, manual: boolean): Array<{ text: string; callback_data: string }> {
  return manual
    ? [{ text: "🤖 Вернуть воркеру", callback_data: `${WB_AI_AUTO_CB}${orderId}` }]
    : [{ text: "✋ Веду сам", callback_data: `${WB_AI_MANUAL_CB}${orderId}` }];
}

export function escalationKeyboard(input: { orderId: string; sendKey?: string; draft: string; category: string; manual: boolean; code?: string | null }): Btn[][] {
  const rows: Btn[][] = [];
  if (input.draft && input.sendKey) rows.push([{ text: "📤 Отправить", callback_data: `${WB_AI_SEND_CB}${input.sendKey}`.slice(0, 64) }]);
  if (input.category === "gamepass_problem" && input.sendKey) {
    rows.push([{ text: "🔐 Взять аккаунт на себя", callback_data: `${WB_AI_ACCOUNT_CB}${input.sendKey}`.slice(0, 64) }]);
  }
  rows.push(manualRow(input.orderId, input.manual));
  const twa = twaStartappUrl(input.code);
  if (twa) rows.push([{ text: "📱 Открыть в TWA", url: twa }]);
  return rows;
}

/** Карточка «ИИ передал вам». Возвращает id сообщений — чтобы потом закрыть. */
export async function sendAiEscalationCard(
  ref: DbsRef,
  orderId: string,
  input: { text: string; summary: string; draft: string; category: string; categoryRu: string; sendKey?: string; manual: boolean; lead?: string | null },
  who: string[] = [],
): Promise<CardRef[]> {
  const notice = {
    marker: "action" as const,
    zone: "DBS" as const,
    title: `🤖 ИИ передал вам · ${input.categoryRu}`,
    lines: [
      orderRef(ref),
      ...who.map((line) => escapeHtml(line)),
      input.lead ? `🥷 ${escapeHtml(input.lead)}` : null,
      `<i>${escapeHtml(input.text.slice(0, 600))}</i>`,
      input.summary ? `🧾 ${escapeHtml(input.summary)}` : null,
      input.draft ? `🤖 Ответ: ${escapeHtml(input.draft.slice(0, 1200))}` : null,
    ],
    next: input.draft && input.sendKey ? "подошёл ответ — «📤 Отправить», нет — ответьте сами" : "ответить из консоли DBS или из кабинета WB",
  };
  const text = formatAdminNotice(notice);
  const keyboard = escalationKeyboard({ orderId, sendKey: input.sendKey, draft: input.draft, category: input.category, manual: input.manual, code: ref.code });
  const targets = await adminTargetsForNotice(notice).catch(() => []);
  const out: CardRef[] = [];
  await Promise.allSettled(targets.map(async (t) => {
    const res = await tgSend(t.chatId, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: keyboard }, ...replyToRootFor(ref.cardMessages, t), ...t.extra });
    const id = tgMessageId(res);
    if (id !== null) out.push({ c: String(t.chatId), m: id });
    else console.warn(`[wb-ai-cards] карточка не доставлена chat_id=${t.chatId}: ${JSON.stringify(res).slice(0, 200)}`);
  }));
  return out;
}

async function tgEditMarkup(chatId: string, messageId: number, keyboard: Btn[][]): Promise<void> {
  const bridgeUrl = process.env.VALIDATOR_SOURCE_URL?.trim();
  const key = process.env.VALIDATOR_KEY?.trim();
  const payload = { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: keyboard } };
  try {
    if (bridgeUrl) {
      await fetch(`${bridgeUrl}/tg-proxy`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(key ? { "x-validator-key": key } : {}) },
        body: JSON.stringify({ token: process.env.TG_TOKEN, method: "editMessageReplyMarkup", ...payload }),
        signal: AbortSignal.timeout(15_000),
      });
      return;
    }
    await fetch(`https://api.telegram.org/bot${process.env.TG_TOKEN}/editMessageReplyMarkup`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    console.warn("[wb-ai-cards] кнопки не переписались:", err instanceof Error ? err.message : err);
  }
}

/** Клавиатура закрытой карточки: факт вместо «Отправить» + режим. */
export function closedKeyboard(orderId: string, label: string, manual: boolean): Btn[][] {
  return [[{ text: label.slice(0, 60), callback_data: WB_AI_NOOP_CB }], manualRow(orderId, manual)];
}

/**
 * Закрыть открытые карточки заказа: «📤 Отправить» больше не нажать.
 * `exceptKey` — карточка, которая остаётся (свежая или та, с которой отправили).
 */
export async function closeAiCards(db: Db, orderId: string, label: string, opts: { exceptKey?: string; now?: Date } = {}): Promise<number> {
  const since = new Date((opts.now ?? new Date()).getTime() - 48 * 3600_000);
  const evs = await db.wbMarketplaceEvent.findMany({
    where: { marketplaceOrderId: orderId, type: "AI_CHAT_ESCALATED", createdAt: { gte: since } },
    select: { id: true, idempotencyKey: true, payload: true },
  }).catch(() => [] as Array<{ id: string; idempotencyKey: string; payload: unknown }>);
  const manual = await manualMode(db, orderId);
  let closed = 0;
  for (const ev of evs) {
    if (opts.exceptKey && ev.idempotencyKey === opts.exceptKey) continue;
    const p = (ev.payload ?? {}) as { cards?: CardRef[]; closed?: string; sentBy?: string };
    if (p.closed || p.sentBy) continue;
    for (const card of p.cards ?? []) await tgEditMarkup(card.c, card.m, closedKeyboard(orderId, label, !!manual));
    await db.wbMarketplaceEvent.update({ where: { id: ev.id }, data: { payload: { ...p, closed: label } } }).catch(() => undefined);
    closed++;
  }
  return closed;
}

/** Переписать ряд режима на всех карточках заказа (после «✋»/«🤖»). */
export async function refreshManualRow(db: Db, orderId: string, manual: boolean): Promise<void> {
  const evs = await db.wbMarketplaceEvent.findMany({
    where: { marketplaceOrderId: orderId, type: "AI_CHAT_ESCALATED", createdAt: { gte: new Date(Date.now() - 48 * 3600_000) } },
    select: { payload: true },
  }).catch(() => [] as Array<{ payload: unknown }>);
  for (const ev of evs) {
    const p = (ev.payload ?? {}) as { cards?: CardRef[]; closed?: string; sentBy?: string; draft?: string; category?: string; sendKey?: string; code?: string };
    const kb = p.closed || p.sentBy
      ? closedKeyboard(orderId, p.closed ?? `✅ отправил ${p.sentBy}`, manual)
      : escalationKeyboard({ orderId, sendKey: p.sendKey, draft: p.draft ?? "", category: p.category ?? "", manual, code: p.code });
    for (const card of p.cards ?? []) await tgEditMarkup(card.c, card.m, kb);
  }
}

/** Ручной режим заказа: кто включил, или null. */
export async function manualMode(db: Db, orderId: string, now = Date.now()): Promise<{ by: string; at: Date } | null> {
  const ev = await db.wbMarketplaceEvent.findFirst({
    where: { marketplaceOrderId: orderId, type: { in: ["AI_CHAT_MANUAL_ON", "AI_CHAT_MANUAL_OFF"] } },
    orderBy: { createdAt: "desc" },
    select: { type: true, actor: true, createdAt: true },
  }).catch(() => null);
  if (!ev || ev.type !== "AI_CHAT_MANUAL_ON") return null;
  if (now - new Date(ev.createdAt).getTime() > MANUAL_TTL_MS) return null;
  return { by: ev.actor ?? "админ", at: new Date(ev.createdAt) };
}

export async function setManualMode(db: Db, orderId: string, on: boolean, actor: string): Promise<void> {
  const at = new Date();
  await db.wbMarketplaceEvent.create({
    data: {
      marketplaceOrderId: orderId,
      type: on ? "AI_CHAT_MANUAL_ON" : "AI_CHAT_MANUAL_OFF",
      idempotencyKey: `ai-manual:${orderId}:${at.getTime()}`,
      actor: actor.slice(0, 60),
      payload: {},
    },
  });
}

export function answeredLabel(actor: string, at = new Date()): string {
  return `✅ ответил ${actor} ${mskTime(at)}`;
}
