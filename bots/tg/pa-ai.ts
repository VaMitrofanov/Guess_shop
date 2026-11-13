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
   ───────────────────────────────────────────────────────────────────────── */

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { Telegraf } from "telegraf";
import { db } from "../shared/db";
import { ADMIN_IDS } from "../shared/admin";
import { escapeHtml } from "../shared/notify";
import {
  CATEGORY_RU, HANDOFF_TEXT, PA_AI_MODEL, PA_AI_SYSTEM, PaAiDecisionSchema,
  customerContext, guardDecision, type PaAiDecision,
} from "../shared/pa-ai-support";

export type PaAiMode = "on" | "dry" | "off";
const STREAM = "pa-support";
/** Потолок вызовов модели в сутки — страховка счёта. */
const DAILY_CAP = 300;
/** Сколько последних сообщений чата помним и отдаём модели. */
const HISTORY = 12;
/** После передачи человеку бот молчит в чате столько (или пока не ответит оператор). */
const HANDOFF_QUIET_MS = 6 * 3600_000;

type Turn = { role: "user" | "assistant"; text: string; at: number };
const history = new Map<number, Turn[]>();
const handedOffAt = new Map<number, number>();
const drafts = new Map<string, { connId: string; chatId: number; text: string; at: number }>();
let calls = { day: "", n: 0 };
/** Темы беседы админов (форум): куда что слать. */
export type PaTopic = "support" | "test" | "digest" | "assistant" | "ideas";
export type PaSettings = { chatId: number | null; mode: PaAiMode; topics: Partial<Record<PaTopic, number>>; digestDay?: string; loadedAt: number };
let settings: PaSettings = { chatId: null, mode: "dry", topics: {}, loadedAt: 0 };
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
  handedOffAt.delete(chatId);
}

export async function loadSettings(force = false): Promise<PaSettings> {
  if (!force && Date.now() - settings.loadedAt < 60_000) return settings;
  const row = await db.wbSyncCursor.findUnique({ where: { stream: STREAM } }).catch(() => null);
  const meta = (row?.metadata ?? {}) as { mode?: PaAiMode; topics?: PaSettings["topics"]; digestDay?: string };
  settings = {
    chatId: row?.cursor ? Number(row.cursor) : null,
    mode: meta.mode === "on" || meta.mode === "off" ? meta.mode : "dry",
    topics: meta.topics ?? {},
    digestDay: meta.digestDay,
    loadedAt: Date.now(),
  };
  return settings;
}

export async function saveSettings(patch: { chatId?: number; mode?: PaAiMode; topics?: PaSettings["topics"]; digestDay?: string }) {
  const cur = await loadSettings(true);
  const chatId = patch.chatId ?? cur.chatId;
  const next = {
    mode: patch.mode ?? cur.mode,
    topics: patch.topics ?? (patch.chatId && patch.chatId !== cur.chatId ? {} : cur.topics),
    digestDay: patch.digestDay ?? cur.digestDay,
  };
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

let client: Anthropic | null = null;
const anthropic = () => (client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!.trim(), maxRetries: 1, timeout: 45_000 }));

async function decide(chatId: number, context: string, image?: { data: string; mediaType: "image/jpeg" | "image/png" | "image/webp" }): Promise<PaAiDecision | "out_of_money" | null> {
  const day = new Date().toISOString().slice(0, 10);
  if (calls.day !== day) calls = { day, n: 0 };
  if (calls.n >= DAILY_CAP) return null;
  calls.n++;
  const turns = history.get(chatId) ?? [];
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: context },
    ...turns.map((t) => ({
      role: t.role,
      content: t.role === "assistant" ? `[поддержка] ${t.text}` : t.text,
    }) as Anthropic.MessageParam),
  ];
  if (messages[messages.length - 1].role !== "user") return null;
  // Скриншот покупателя — к последнему сообщению: Haiku читает картинки
  // (Pending 0 или 500, «Managed pricing» включён, цена не та…).
  if (image) {
    const last = messages[messages.length - 1];
    last.content = [
      { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.data } },
      { type: "text", text: typeof last.content === "string" ? last.content : "[скриншот]" },
    ];
  }
  try {
    const res = await anthropic().messages.parse({
      model: PA_AI_MODEL,
      max_tokens: 2000,
      // Кэшируем только базу знаний: данные покупателя у каждого свои.
      system: [{ type: "text", text: PA_AI_SYSTEM, cache_control: { type: "ephemeral" } }],
      messages,
      output_config: { effort: "low", format: zodOutputFormat(PaAiDecisionSchema) },
    });
    const u = res.usage;
    console.log(`[pa-ai] токены: вход ${u.input_tokens} (+кэш ${u.cache_read_input_tokens ?? 0}/${u.cache_creation_input_tokens ?? 0}), выход ${u.output_tokens}`);
    if (res.stop_reason === "refusal") {
      return { action: "escalate", category: "other", reply: "", summary: "Модель отказалась отвечать — посмотрите сами.", draft: "" };
    }
    return res.parsed_output ?? null;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`[pa-ai] вызов не прошёл: ${msg.slice(0, 200)}`);
    if (/credit balance|billing|insufficient/i.test(msg)) return "out_of_money";
    return null;
  }
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

  // Уже передали человеку — бот молчит, админам — короткая приписка.
  const handed = handedOffAt.get(m.chatId);
  if (handed && Date.now() - handed < HANDOFF_QUIET_MS) {
    await card(bot, `➕ <b>${escapeHtml(m.fromName)}</b> дописал${m.username ? ` (@${escapeHtml(m.username)})` : ""}:\n💬 «${escapeHtml(text.slice(0, 600))}»`);
    return true;
  }

  const user = await db.user.findUnique({ where: { tgId: String(m.fromId) }, select: { id: true, name: true } });
  const orders = user
    ? await db.wbOrder.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          wbCode: true, amount: true, status: true, createdAt: true, completedAt: true, heldAt: true,
          robloxUsername: true, gamepassUrl: true, isDirectOrder: true,
        },
      })
    : [];
  const wbNotes = orders.length
    ? (await db.riskEvent.findMany({
        where: { wbCode: { in: orders.map((o) => o.wbCode) }, kind: { in: ["BAD_REVIEW", "REVIEW_FIXED", "REVIEW_DELETED", "CLAIM_OPENED", "REFUND_OPEN", "REFUND_AFTER_DELIVERY"] } },
        orderBy: { occurredAt: "desc" }, take: 5,
        select: { kind: true, wbCode: true, stars: true, starsBefore: true, text: true, occurredAt: true },
      }).catch(() => [])).map((r) => {
        const what = r.kind === "BAD_REVIEW" ? `отзыв ★${r.stars}` : r.kind === "REVIEW_FIXED" ? `отзыв исправлен ★${r.starsBefore}→★${r.stars}`
          : r.kind === "REVIEW_DELETED" ? `плохой отзыв ★${r.stars} удалён` : r.kind === "CLAIM_OPENED" ? "заявка на возврат" : "WB вернул деньги";
        return `${what} по заказу ${r.wbCode} (${r.occurredAt.toISOString().slice(0, 10)})${r.text ? `: «${r.text.slice(0, 120)}»` : ""}`;
      })
    : [];
  const context = customerContext({ name: user?.name ?? m.fromName, known: Boolean(user), orders, wbNotes });
  const image = m.photoFileId ? await loadPhoto(bot, m.photoFileId) : undefined;
  const raw = await decide(m.chatId, context, image);
  if (raw === "out_of_money") {
    if (Date.now() - outOfMoneyNotified > 6 * 3600_000) {
      outOfMoneyNotified = Date.now();
      await card(bot, "⚠️ <b>ИИ-поддержка встала: закончились деньги на счёте Anthropic.</b>\nПополните баланс в console.anthropic.com — пока отвечает старый шаблон «где заказ».");
    }
    return false;
  }
  if (!raw) return false;
  const d = guardDecision(raw, text);
  const order = orders[0];
  const orderLine = order ? `📦 ${order.wbCode} · ${order.amount} R$ · ${order.status}${order.heldAt ? " · ❄️" : ""}` : "📦 заказов в базе нет";
  const who = `👤 <b>${escapeHtml(m.fromName)}</b>${m.username ? ` @${escapeHtml(m.username)}` : ""}`;
  const quote = `💬 «${escapeHtml(text.slice(0, 600))}»`;

  if (d.action === "ignore") return true;

  if (d.action === "reply") {
    if (mode === "dry") {
      await card(bot, `🧪 <b>Тест: бот ответил бы сам</b> · ${CATEGORY_RU[d.category]}\n${who}\n${orderLine}\n\n${quote}\n\n🤖 ${escapeHtml(d.reply)}`, undefined, "test");
      return true;
    }
    await api("sendMessage", { business_connection_id: m.connId, chat_id: m.chatId, text: d.reply });
    await api("readBusinessMessage", { business_connection_id: m.connId, chat_id: m.chatId, message_id: m.messageId }).catch(() => undefined);
    rememberTurn(m.chatId, "assistant", d.reply);
    return true;
  }

  // escalate
  const id = Math.random().toString(36).slice(2, 10);
  if (d.draft.trim()) drafts.set(id, { connId: m.connId, chatId: m.chatId, text: d.draft.trim(), at: Date.now() });
  if (drafts.size > 500) drafts.delete(drafts.keys().next().value as string);
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
  const buttons = mode === "on"
    ? [[
        ...(d.draft.trim() ? [{ text: "📤 Отправить черновик", callback_data: `paai:send:${id}` }] : []),
        { text: "✋ Сам отвечу", callback_data: `paai:own:${id}` },
      ]]
    : undefined;
  await card(bot, body, buttons, mode === "dry" ? "test" : "support");
  if (mode === "on") {
    handedOffAt.set(m.chatId, Date.now());
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
) {
  const s = await loadSettings();
  const targets = s.chatId ? [s.chatId] : ADMIN_IDS.map(Number);
  const thread = s.chatId ? s.topics[topic] : undefined;
  const extra = {
    parse_mode: "HTML" as const,
    link_preview_options: { is_disabled: true },
    ...(thread ? { message_thread_id: thread } : {}),
    ...(inline ? { reply_markup: { inline_keyboard: inline } } : {}),
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
    const arg = (ctx.message?.text ?? "").split(/\s+/)[1]?.toLowerCase();
    if (arg !== "on" && arg !== "dry" && arg !== "off") {
      const s = await loadSettings(true);
      await ctx.reply(`Режим ИИ-поддержки: ${s.mode}. Сегодня вызовов: ${calls.n}/${DAILY_CAP}.\nСменить: /support_mode on | dry | off`);
      return;
    }
    await saveSettings({ mode: arg });
    await ctx.reply(`✅ Режим ИИ-поддержки: ${arg}`);
  });

  bot.action(/^paai:(send|own):(\w+)$/, async (ctx) => {
    if (!isAdmin(ctx.from?.id)) return ctx.answerCbQuery("Только для админов").catch(() => undefined);
    const [, act, id] = ctx.match;
    const who = ctx.from?.username ? `@${ctx.from.username}` : ctx.from?.first_name ?? "админ";
    const draft = drafts.get(id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const original = ((ctx.callbackQuery?.message as any)?.text ?? "") as string;
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
      await ctx.answerCbQuery("Отправлено").catch(() => undefined);
      await ctx.editMessageText(`${escapeHtml(original).slice(0, 3500)}\n\n📤 Черновик отправил ${escapeHtml(who)}`, { parse_mode: "HTML" }).catch(() => undefined);
    } catch (error) {
      await ctx.answerCbQuery(`Не ушло: ${error instanceof Error ? error.message.slice(0, 120) : "ошибка"}`, { show_alert: true }).catch(() => undefined);
    }
  });
}
