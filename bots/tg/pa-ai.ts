/* ─────────────────────────────────────────────────────────────────────────────
   ИИ-поддержка @RobloxBank_PA: вызов Claude Haiku 5.5 и карточки админам.

   Режимы (меняются командой в беседе админов, без деплоя):
   • /support_here        — эта беседа = чат админов поддержки;
   • /support_mode dry    — модель думает, покупателю НИЧЕГО не уходит, в беседу
                            приходит «бот ответил бы: …» (по умолчанию);
   • /support_mode on     — отвечает сам, проблемы — карточкой с черновиком;
   • /support_mode off    — выключено (работает старый шаблон «где заказ»).
   Настройки — в `WbSyncCursor` (stream `pa-support`), миграции не нужно.

   Карточка проблемы: суть, заказ, черновик и кнопки «📤 Отправить черновик» /
   «✋ Сам отвечу». Черновики живут в памяти процесса: после рестарта кнопка
   скажет «устарело» — открыть чат и ответить руками.

   Передача человеку (26.11.2026, разбор чата Татьяны К.): пока чат передан,
   бот покупателю не пишет, но каждое новое сообщение покупателя приходит
   карточкой «➕ дописал» со СВЕЖИМ черновиком — модель видит всю переписку.
   Кнопка старой карточки после этого не шлёт (черновик мог спрашивать то, что
   покупатель уже прислал). «📤 Отправить черновик» снимает передачу — бот
   снова отвечает в чате сам; «✋ Сам отвечу» — молчит, пока не ответит оператор.
   ───────────────────────────────────────────────────────────────────────── */

import type { Telegraf } from "telegraf";
import { db } from "../shared/db";
import { ADMIN_IDS } from "../shared/admin";
import { escapeHtml } from "../shared/notify";
import { heldLabel } from "../shared/notify-format";
import { aiLogRecord } from "../shared/support-ai-log";
import {
  CATEGORY_RU, HANDOFF_TEXT, guardDecision, plain, type PaAiDecision,
} from "../shared/pa-ai-support";
import { loadSupportCustomer } from "../shared/support-ai-context";
import { twaOrderRows } from "./twa-order-link";
import { resetSupportModeCache, type SupportAiMode, type SupportChannelKey } from "../shared/support-ai";
import { decideSupportDirect, supportAiCallsToday } from "./support-ai-direct";
import { reactPaMessage } from "./pa-desk-worker";

export type PaAiMode = "on" | "dry" | "off";
const STREAM = "pa-support";
const DAILY_CAP = 300;
/** Сколько последних сообщений чата помним и отдаём модели. */
const HISTORY = 12;
/** После передачи человеку бот молчит в чате столько (или пока не ответит оператор). */
const HANDOFF_QUIET_MS = 6 * 3600_000;

type Turn = { role: "user" | "assistant"; text: string; at: number };
const history = new Map<number, Turn[]>();
/** Чат передан человеку: когда и какой черновик сейчас актуален. */
const handedOff = new Map<number, { at: number; draftId: string | null }>();
const drafts = new Map<string, { connId: string; chatId: number; text: string; at: number }>();
/** Черновики, которые перебил «➕ дописал» со свежим черновиком. */
const staleDrafts = new Set<string>();
/** Темы беседы админов (форум): куда что слать. */
export type PaTopic = "support" | "test" | "digest" | "assistant" | "ideas" | "updates";
type Channels = Partial<Record<SupportChannelKey, SupportAiMode>>;
export type PaSettings = { chatId: number | null; mode: PaAiMode; topics: Partial<Record<PaTopic, number>>; digestDay?: string; channels: Channels; rules: string[]; loadedAt: number };
let settings: PaSettings = { chatId: null, mode: "dry", topics: {}, channels: {}, rules: [], loadedAt: 0 };
let outOfMoneyNotified = 0;

export function rememberTurn(chatId: number, role: Turn["role"], text: string) {
  if (!text.trim()) return;
  const list = history.get(chatId) ?? [];
  list.push({ role, text: text.slice(0, 1500), at: Date.now() });
  while (list.length > HISTORY) list.shift();
  history.set(chatId, list);
  if (history.size > 2000) history.delete(history.keys().next().value as number);
}

/** Оператор написал в чат — передача закрыта, бот снова может отвечать позже. */
export function operatorReplied(chatId: number) {
  handedOff.delete(chatId);
}

/**
 * Сообщение покупателя в переданном чате разобрал не ИИ, а другой обработчик
 * (бот сам предложил привязать заказ по коду, принял пасс) — старый черновик
 * мог просить ровно это. Снимаем его и коротко сообщаем админам.
 */
export async function handledDuringHandoff(bot: Telegraf, chatId: number, who: string, text: string, what: string): Promise<void> {
  const h = handedOff.get(chatId);
  if (!h || Date.now() - h.at >= HANDOFF_QUIET_MS) return;
  if (h.draftId) staleDrafts.add(h.draftId);
  h.draftId = null;
  await card(bot, `➕ <b>${escapeHtml(who)}</b> дописал:\n💬 «${escapeHtml(text.slice(0, 600))}»\n\n🤖 ${escapeHtml(what)}. Черновик в карточке выше устарел — не отправляется.`).catch(() => undefined);
}

const newDraftId = () => Math.random().toString(36).slice(2, 10);

function putDraft(id: string, d: { connId: string; chatId: number; text: string }) {
  drafts.set(id, { ...d, at: Date.now() });
  if (drafts.size > 500) drafts.delete(drafts.keys().next().value as string);
  if (staleDrafts.size > 1000) staleDrafts.delete(staleDrafts.values().next().value as string);
}

function draftButtons(id: string, hasDraft: boolean) {
  return [[
    ...(hasDraft ? [{ text: "📤 Отправить черновик", callback_data: `paai:send:${id}` }] : []),
    { text: "✋ Сам отвечу", callback_data: `paai:own:${id}` },
  ]];
}

export async function loadSettings(force = false): Promise<PaSettings> {
  if (!force && Date.now() - settings.loadedAt < 60_000) return settings;
  const row = await db.wbSyncCursor.findUnique({ where: { stream: STREAM } }).catch(() => null);
  const meta = (row?.metadata ?? {}) as { mode?: PaAiMode; topics?: PaSettings["topics"]; digestDay?: string; channels?: Channels; rules?: string[] };
  settings = {
    chatId: row?.cursor ? Number(row.cursor) : null,
    mode: meta.mode === "on" || meta.mode === "off" ? meta.mode : "dry",
    topics: meta.topics ?? {},
    digestDay: meta.digestDay,
    channels: meta.channels ?? {},
    rules: Array.isArray(meta.rules) ? meta.rules.filter((r) => typeof r === "string") : [],
    loadedAt: Date.now(),
  };
  return settings;
}

export async function saveSettings(patch: { chatId?: number; mode?: PaAiMode; topics?: PaSettings["topics"]; digestDay?: string; channels?: Channels; rules?: string[] }) {
  const cur = await loadSettings(true);
  const chatId = patch.chatId ?? cur.chatId;
  const next = {
    mode: patch.mode ?? cur.mode,
    topics: patch.topics ?? (patch.chatId && patch.chatId !== cur.chatId ? {} : cur.topics),
    digestDay: patch.digestDay ?? cur.digestDay,
    // Режимы ВК и WB живут в этой же строке — терять их при любой другой правке нельзя.
    channels: { ...cur.channels, ...patch.channels },
    // Правила владельца для ИИ (`/ai_rule`) — тоже здесь; терять при другой правке нельзя.
    rules: patch.rules ?? cur.rules,
  };
  resetSupportModeCache();
  await db.wbSyncCursor.upsert({
    where: { stream: STREAM },
    create: { stream: STREAM, cursor: chatId ? String(chatId) : null, metadata: next },
    update: { cursor: chatId ? String(chatId) : null, metadata: next },
  });
  settings = { chatId, ...next, loadedAt: Date.now() };
}

export async function paAiMode(): Promise<PaAiMode> {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) return "off";
  return (await loadSettings()).mode;
}

async function decide(chatId: number, context: string, image?: { data: string; mediaType: "image/jpeg" | "image/png" | "image/webp" }): Promise<PaAiDecision | "out_of_money" | null> {
  const turns = (history.get(chatId) ?? []).map(({ role, text }) => ({ role, text }));
  // Скриншот покупателя — к последнему сообщению: Haiku читает картинки
  // (Pending 0 или 500, «Managed pricing» включён, цена не та…).
  return decideSupportDirect({ channel: "tg_pa", context, turns, image });
}

export interface PaIncoming {
  connId: string;
  chatId: number;
  messageId: number;
  fromId: number;
  fromName: string;
  username: string | null;
  text: string;
  hasMedia: boolean;
  /** file_id самой крупной версии фото, если покупатель прислал фото. */
  photoFileId?: string | null;
}

/** Скачать фото покупателя для модели. Ошибка — без картинки, не падаем. */
async function loadPhoto(bot: Telegraf, fileId: string) {
  try {
    const link = await bot.telegram.getFileLink(fileId);
    const res = await fetch(link.toString(), { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return undefined;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 4_500_000) return undefined;
    return { data: buf.toString("base64"), mediaType: "image/jpeg" as const };
  } catch {
    return undefined;
  }
}

/**
 * Обработать входящее. Возвращает `true`, если ИИ взял сообщение на себя
 * (ответил, передал или сознательно промолчал); `false` — пусть работает
 * старый шаблон.
 */
export async function handleWithAi(bot: Telegraf, m: PaIncoming): Promise<boolean> {
  const mode = await paAiMode();
  if (mode === "off") return false;
  const api = (method: string, payload: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (bot.telegram as any).callApi(method, payload);
  const text = m.text || (m.photoFileId ? "[прислал скриншот]" : m.hasMedia ? "[прислал файл без текста]" : "");
  if (!text) return true;
  rememberTurn(m.chatId, "user", text);

  // Уже передали человеку — покупателю бот не пишет, а админам — «➕ дописал»
  // со свежим черновиком: модель видит всю переписку, включая новое сообщение.
  const handedRaw = handedOff.get(m.chatId);
  const handed = handedRaw && Date.now() - handedRaw.at < HANDOFF_QUIET_MS ? handedRaw : null;
  const addedHead = `➕ <b>${escapeHtml(m.fromName)}</b> дописал${m.username ? ` (@${escapeHtml(m.username)})` : ""}:\n💬 «${escapeHtml(text.slice(0, 600))}»`;

  const user = await db.user.findUnique({ where: { tgId: String(m.fromId) }, select: { id: true, name: true } });
  const { context, orders, codeOrders } = await loadSupportCustomer(db, { userId: user?.id, name: user?.name ?? m.fromName });
  const image = m.photoFileId ? await loadPhoto(bot, m.photoFileId) : undefined;
  const raw = await decide(m.chatId, context, image);
  if (handed && (raw === "out_of_money" || !raw)) {
    await card(bot, addedHead);
    return true;
  }
  if (raw === "out_of_money") {
    if (Date.now() - outOfMoneyNotified > 6 * 3600_000) {
      outOfMoneyNotified = Date.now();
      await card(bot, "⚠️ <b>ИИ-поддержка встала: закончились деньги на счёте Anthropic.</b>\nПополните баланс в console.anthropic.com — пока отвечает старый шаблон «где заказ».");
    }
    return false;
  }
  if (!raw) return false;
  const d = guardDecision(raw, text);
  void aiLogRecord(db, {
    // Пока чат у человека, ответ модели — лишь черновик: в статистике это передача, не «сам».
    channel: "tg_pa", action: handed && d.action === "reply" ? "escalate" : d.action, mode: mode as "on" | "dry", category: d.category,
    peerKey: `tg:${m.chatId}`, orderCode: orders[0]?.wbCode ?? null,
    question: text, answer: d.action === "reply" ? plain(d.reply) : d.draft || null, summary: d.summary || null,
  });
  const order = orders[0];
  const orderLine = order ? `📦 ${order.wbCode} · ${order.amount} R$ · ${order.status}${order.heldAt ? ` · ${heldLabel(order.heldReason ?? null, 60)}` : ""}` : codeOrders.length ? "🎟 покупка кода Robux на сайте (заказов WB нет)" : "📦 заказов в базе нет";
  const who = `👤 <b>${escapeHtml(m.fromName)}</b>${m.username ? ` @${escapeHtml(m.username)}` : ""}`;
  const quote = `💬 «${escapeHtml(text.slice(0, 600))}»`;

  if (handed) {
    // Ответ, который модель дала бы сама, здесь — тоже лишь черновик: чат у человека.
    const draft = (d.action === "reply" ? d.reply : d.action === "escalate" ? d.draft : "").trim();
    if (!draft) {
      await card(bot, `${addedHead}\n\n🧾 ${escapeHtml(d.summary || "—")}`);
      return true;
    }
    const id = newDraftId();
    putDraft(id, { connId: m.connId, chatId: m.chatId, text: draft });
    if (handed.draftId) staleDrafts.add(handed.draftId);
    handed.draftId = id;
    await card(bot, [
      addedHead,
      orderLine,
      "",
      `🧾 ${escapeHtml(d.summary || "—")}`,
      `\n✍️ <b>Свежий черновик</b> (с учётом нового сообщения):\n${escapeHtml(draft)}`,
    ].join("\n"), draftButtons(id, true));
    return true;
  }

  if (d.action === "ignore") return true;

  if (d.action === "reply") {
    if (mode === "dry") {
      await card(bot, `🧪 <b>Тест: бот ответил бы сам</b> · ${CATEGORY_RU[d.category]}\n${who}\n${orderLine}\n\n${quote}\n\n🤖 ${escapeHtml(d.reply)}`, undefined, "test");
      return true;
    }
    await api("sendMessage", { business_connection_id: m.connId, chat_id: m.chatId, text: d.reply });
    await api("readBusinessMessage", { business_connection_id: m.connId, chat_id: m.chatId, message_id: m.messageId }).catch(() => undefined);
    rememberTurn(m.chatId, "assistant", d.reply);
    // Журнал: каждый ответ ИИ виден админам, без звука (26.11.2026).
    await card(bot, `🤖 <b>@RobloxBank_PA: ответил сам</b> · ${CATEGORY_RU[d.category]}\n${who}\n${orderLine}\n\n${quote}\n\n🤖 ${escapeHtml(d.reply)}`, undefined, "test", true);
    return true;
  }

  // escalate
  const id = newDraftId();
  if (d.draft.trim()) putDraft(id, { connId: m.connId, chatId: m.chatId, text: d.draft.trim() });
  const head = mode === "dry" ? "🧪 <b>Тест: бот передал бы вам</b>" : "🆘 <b>Нужен человек</b>";
  const body = [
    `${head} · ${CATEGORY_RU[d.category]}`,
    who,
    orderLine,
    "",
    quote,
    "",
    `🧾 ${escapeHtml(d.summary || "—")}`,
    d.draft.trim() ? `\n✍️ <b>Черновик:</b>\n${escapeHtml(d.draft.trim())}` : "",
  ].join("\n");
  const buttons = mode === "on" ? draftButtons(id, Boolean(d.draft.trim())) : undefined;
  await card(bot, body, buttons, mode === "dry" ? "test" : "support");
  if (mode === "on") {
    handedOff.set(m.chatId, { at: Date.now(), draftId: d.draft.trim() ? id : null });
    // ✨ З7: 👀 на сообщение клиента — «взяли в работу». Ставит сам аккаунт:
    // Bot API через бизнес-подключение отвечал «message to react not found».
    await reactPaMessage(String(m.chatId), m.messageId, "👀")
      .catch((e: unknown) => console.warn("[pa-ai] 👀 не встала:", e instanceof Error ? e.message : e));
    await api("sendMessage", { business_connection_id: m.connId, chat_id: m.chatId, text: HANDOFF_TEXT });
    rememberTurn(m.chatId, "assistant", HANDOFF_TEXT);
  }
  return true;
}

/**
 * Карточка в беседу админов — в нужную тему, если беседа с темами (или, если
 * беседу не назначили, — каждому админу в личку).
 */
export async function card(
  bot: Telegraf,
  html: string,
  inline?: Array<Array<{ text: string; callback_data: string }>>,
  topic: PaTopic = "support",
  silent = false,
) {
  const s = await loadSettings();
  const targets = s.chatId ? [s.chatId] : ADMIN_IDS.map(Number);
  const thread = s.chatId ? s.topics[topic] : undefined;
  // Заказ в карточке — сразу кнопка «открыть в TWA» (сводкам не нужна: там списки).
  const twa = topic === "digest" || topic === "updates" ? [] : await twaOrderRows(bot.botInfo?.username, html);
  const keyboard = [...(inline ?? []), ...twa];
  const extra = {
    parse_mode: "HTML" as const,
    link_preview_options: { is_disabled: true },
    ...(thread ? { message_thread_id: thread } : {}),
    ...(keyboard.length ? { reply_markup: { inline_keyboard: keyboard } } : {}),
    ...(silent ? { disable_notification: true } : {}),
  };
  await Promise.allSettled(targets.map((t) => bot.telegram.sendMessage(t, html.slice(0, 4000), extra)));
}

const isAdmin = (id: number | undefined) => id !== undefined && ADMIN_IDS.map(String).includes(String(id));

/** Команды беседы и кнопки карточек. Регистрировать до общих обработчиков. */
export function registerPaAiAdmin(bot: Telegraf): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const api = (method: string, payload: Record<string, unknown>) => (bot.telegram as any).callApi(method, payload);

  bot.command("support_here", async (ctx) => {
    if (!isAdmin(ctx.from?.id) || !ctx.chat || ctx.chat.type === "private") return;
    await saveSettings({ chatId: ctx.chat.id });
    await ctx.reply(`✅ Эта беседа — чат поддержки @RobloxBank_PA. Режим: ${settings.mode}.\n/support_mode dry — бот только показывает, что ответил бы\n/support_mode on — отвечает сам, проблемы шлёт сюда\n/support_mode off — выключить`);
  });

  bot.command("support_mode", async (ctx) => {
    if (!isAdmin(ctx.from?.id)) return;
    const args = (ctx.message?.text ?? "").split(/\s+/).slice(1).map((a) => a.toLowerCase());
    const isMode = (a: string | undefined): a is SupportAiMode => a === "on" || a === "dry" || a === "off";
    const channel: SupportChannelKey | null =
      args[0] === "vk" ? "vk_bot" : args[0] === "wb" ? "wb_chat" : args[0] === "bot" ? "tg_bot" : null;
    const channelRu: Record<SupportChannelKey, string> = { tg_bot: "боте @RobloxBankBot", vk_bot: "ВКонтакте", wb_chat: "чатах WB" };
    if (channel && isMode(args[1])) {
      await saveSettings({ channels: { [channel]: args[1] } });
      await ctx.reply(`✅ ИИ в ${channelRu[channel]}: ${args[1]}`);
      return;
    }
    if (!channel && isMode(args[0])) {
      await saveSettings({ mode: args[0] });
      await ctx.reply(`✅ Режим ИИ-поддержки @RobloxBank_PA: ${args[0]}`);
      return;
    }
    const s = await loadSettings(true);
    await ctx.reply(
      `ИИ-поддержка, сегодня вызовов (лимит ${DAILY_CAP} на канал):\n` +
      `• @RobloxBank_PA — ${s.mode} · ${supportAiCallsToday("tg_pa")}\n` +
      `• бот @RobloxBankBot — ${s.channels.tg_bot ?? "off"} · ${supportAiCallsToday("tg_bot")}\n` +
      `• ВКонтакте — ${s.channels.vk_bot ?? "off"} · ${supportAiCallsToday("vk_bot")}\n` +
      `• чаты WB — ${s.channels.wb_chat ?? "off"} · ${supportAiCallsToday("wb_chat")}\n\n` +
      `Сменить: /support_mode on|dry|off · /support_mode bot|vk|wb on|dry|off`,
    );
  });

  // Правила владельца для ИИ (26.11.2026): действуют сразу, без деплоя, во всех
  // каналах — блоком «ПРАВИЛА ВЛАДЕЛЬЦА» после базы знаний (`support-ai-direct`).
  bot.command("ai_rule", async (ctx) => {
    if (!isAdmin(ctx.from?.id)) return;
    const rule = (ctx.message?.text ?? "").replace(/^\/ai_rule(@\w+)?\s*/i, "").trim();
    if (rule.length < 10) {
      await ctx.reply("Напишите правило после команды, например:\n/ai_rule Если в Pending пусто — попросить скриншот профиля с ником и Transactions за месяц");
      return;
    }
    const s = await loadSettings(true);
    const rules = [...s.rules, rule.slice(0, 600)].slice(-40);
    await saveSettings({ rules });
    await ctx.reply(`✅ Правило №${rules.length} добавлено — ИИ учтёт его в течение минуты.\nВсе правила: /ai_rules`);
  });

  bot.command("ai_rules", async (ctx) => {
    if (!isAdmin(ctx.from?.id)) return;
    const s = await loadSettings(true);
    await ctx.reply(s.rules.length
      ? `Правила ИИ (${s.rules.length}):\n\n${s.rules.map((r, i) => `${i + 1}. ${r}`).join("\n\n")}\n\nУдалить: /ai_rule_del N`
      : "Своих правил пока нет. Добавить: /ai_rule текст");
  });

  bot.command("ai_rule_del", async (ctx) => {
    if (!isAdmin(ctx.from?.id)) return;
    const n = Number((ctx.message?.text ?? "").split(/\s+/)[1]);
    const s = await loadSettings(true);
    if (!Number.isInteger(n) || n < 1 || n > s.rules.length) {
      await ctx.reply(`Укажите номер от 1 до ${s.rules.length}: /ai_rule_del N`);
      return;
    }
    const rules = s.rules.filter((_, i) => i !== n - 1);
    await saveSettings({ rules });
    await ctx.reply(`🗑 Правило №${n} удалено. Осталось: ${rules.length}.`);
  });

  bot.action(/^paai:(send|own):(\w+)$/, async (ctx) => {
    if (!isAdmin(ctx.from?.id)) return ctx.answerCbQuery("Только для админов").catch(() => undefined);
    const [, act, id] = ctx.match;
    const who = ctx.from?.username ? `@${ctx.from.username}` : ctx.from?.first_name ?? "админ";
    const draft = drafts.get(id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const original = ((ctx.callbackQuery?.message as any)?.text ?? "") as string;
    if (act === "send" && staleDrafts.has(id)) {
      await ctx.answerCbQuery("Покупатель дописал после этой карточки — ниже карточка «➕ дописал» со свежим черновиком", { show_alert: true }).catch(() => undefined);
      return;
    }
    if (act === "own") {
      await ctx.answerCbQuery("Ок, бот в этом чате молчит").catch(() => undefined);
      await ctx.editMessageText(`${escapeHtml(original).slice(0, 3500)}\n\n✋ Отвечает ${escapeHtml(who)}`, { parse_mode: "HTML" }).catch(() => undefined);
      return;
    }
    if (!draft) {
      await ctx.answerCbQuery("Черновик устарел (бот перезапускался) — ответьте в чате вручную", { show_alert: true }).catch(() => undefined);
      return;
    }
    try {
      await api("sendMessage", { business_connection_id: draft.connId, chat_id: draft.chatId, text: draft.text });
      rememberTurn(draft.chatId, "assistant", draft.text);
      drafts.delete(id);
      // Черновик ушёл — передача закрыта, на следующее сообщение бот отвечает
      // сам (раньше молчал ещё до 6 часов, и покупатель с кодом ждал впустую).
      handedOff.delete(draft.chatId);
      await ctx.answerCbQuery("Отправлено").catch(() => undefined);
      await ctx.editMessageText(`${escapeHtml(original).slice(0, 3500)}\n\n📤 Черновик отправил ${escapeHtml(who)} · дальше бот отвечает в чате сам`, { parse_mode: "HTML" }).catch(() => undefined);
    } catch (error) {
      await ctx.answerCbQuery(`Не ушло: ${error instanceof Error ? error.message.slice(0, 120) : "ошибка"}`, { show_alert: true }).catch(() => undefined);
    }
  });
}
