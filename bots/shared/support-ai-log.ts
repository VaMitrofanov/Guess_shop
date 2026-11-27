/* ─────────────────────────────────────────────────────────────────────────────
   Журнал ИИ-поддержки (26.11.2026).

   Владелец: «хочется, чтобы он отвечал сам, но следить, где и о чём он
   общается». В режиме on ИИ отвечал молча — админы видели только то, что он
   передал человеку. Теперь каждый самостоятельный ответ (бот TG, ВК, чат WB,
   @RobloxBank_PA) уходит карточкой без звука в тему «🤖 ИИ — журнал»
   (бывшая «🧪 Тест ИИ», ключ темы `test`). Передачи человеку идут прежним
   путём, со звуком.

   Модуль без тяжёлых зависимостей: его тянет и ВК-бот.
   ───────────────────────────────────────────────────────────────────────── */

import { ADMIN_IDS } from "./admin";
import { tgSend } from "./notify";
import { supportCardTarget, supportChannelMode } from "./support-ai";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

/** Карточка в тему журнала ИИ. `silent` — без звука (ответил сам). Сбой — не беда. */
export async function aiLogCard(db: Db, html: string, opts: { silent?: boolean; keyboard?: Array<Array<{ text: string; callback_data: string }>> } = {}): Promise<void> {
  const target = await supportCardTarget(db).catch(() => ({ chatId: null, topics: {} as Record<string, number> }));
  const thread = target.chatId ? target.topics.test : undefined;
  const ids = target.chatId ? [target.chatId] : ADMIN_IDS;
  await Promise.allSettled(ids.map((id) => tgSend(id, html.slice(0, 4000), {
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...(thread ? { message_thread_id: thread } : {}),
    ...(opts.silent ? { disable_notification: true } : {}),
    ...(opts.keyboard ? { reply_markup: { inline_keyboard: opts.keyboard } } : {}),
  })));
}

export interface AiLogEntry {
  channel: "tg_pa" | "tg_bot" | "vk_bot" | "wb_chat";
  action: "reply" | "escalate" | "ignore";
  mode: "on" | "dry";
  category: string;
  /** tg:<id> / vk:<id> / wb:<код> */
  peerKey: string;
  orderCode?: string | null;
  question: string;
  answer?: string | null;
  summary?: string | null;
}

/**
 * 🧠 Память разговора после деплоя (27.11.2026). Память ботов TG/ВК/PA живёт в
 * процессе и умирала на каждом рестарте (три деплоя за ночь — три «новых»
 * разговора). Журнал решений уже хранит вопрос и ответ: из него и поднимаем.
 * Ответ берём только реально отправленный (`reply` в режиме on).
 */
export async function recallTurns(db: Db, channel: AiLogEntry["channel"], peerKey: string, maxAgeMs = 6 * 3600_000, limit = 6): Promise<Array<{ role: "user" | "assistant"; text: string; at: number }>> {
  try {
    const rows: Array<{ question: string; answer: string | null; action: string; mode: string; createdAt: Date }> = await db.aiSupportLog.findMany({
      where: { channel, peerKey, createdAt: { gte: new Date(Date.now() - maxAgeMs) } },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { question: true, answer: true, action: true, mode: true, createdAt: true },
    });
    const out: Array<{ role: "user" | "assistant"; text: string; at: number }> = [];
    for (const r of rows.reverse()) {
      const at = new Date(r.createdAt).getTime();
      out.push({ role: "user", text: r.question.slice(0, 1500), at });
      if (r.action === "reply" && r.mode === "on" && r.answer) out.push({ role: "assistant", text: r.answer.slice(0, 1500), at });
    }
    return out;
  } catch {
    return [];
  }
}

/** Запись решения ИИ в базу — для еженедельного разбора. Сбой — не беда. */
export async function aiLogRecord(db: Db, e: AiLogEntry): Promise<void> {
  try {
    await db.aiSupportLog.create({
      data: {
        channel: e.channel, action: e.action, mode: e.mode, category: e.category.slice(0, 60),
        peerKey: e.peerKey.slice(0, 80), orderCode: e.orderCode?.slice(0, 40) ?? null,
        question: e.question.slice(0, 2000), answer: e.answer?.slice(0, 2000) ?? null,
        summary: e.summary?.slice(0, 1000) ?? null,
      },
    });
  } catch (err) {
    console.warn("[ai-log] запись не прошла:", err instanceof Error ? err.message : err);
  }
}

const CHANNEL_RU: Record<string, string> = {
  tg_pa: "@RobloxBank_PA", tg_bot: "бот TG", vk_bot: "ВК", wb_chat: "чаты WB",
};

/* ── Статистика по площадкам (26.11.2026) ─────────────────────────────────
   Владелец: «стату по ответам отдельно для ВК, ВБ и ТГ — сколько чатов и где
   воркер взял на себя». Считаем ЧАТЫ (`peerKey`), а не реплики: чат «закрыт
   сам», если за период ИИ ни разу не передал его человеку. Режим dry —
   отдельной строкой «тест»: покупателю тогда ничего не уходило. */

export type AiChannel = AiLogEntry["channel"];
export type AiMode = "on" | "dry" | "off";

export interface AiChannelStat {
  /** Чатов, где ИИ работал в боевом режиме. */
  chats: number;
  /** Из них ни разу не передал человеку. */
  selfChats: number;
  /** Из них передал человеку хотя бы раз. */
  handedChats: number;
  replies: number;
  handoffs: number;
  ignores: number;
  /** Чатов в режиме dry (покупателю не уходило). */
  dryChats: number;
}

type LogRow = { channel: string; action: string; mode: string; peerKey: string };

/** Чистый подсчёт по строкам журнала — с тестами. */
export function aggregateAiLog(rows: LogRow[]): Record<AiChannel, AiChannelStat> {
  const empty = (): AiChannelStat => ({ chats: 0, selfChats: 0, handedChats: 0, replies: 0, handoffs: 0, ignores: 0, dryChats: 0 });
  const out: Record<AiChannel, AiChannelStat> = { tg_pa: empty(), tg_bot: empty(), vk_bot: empty(), wb_chat: empty() };
  const live = new Map<string, boolean>(); // channel|peer → передавал ли
  const dry = new Set<string>();
  for (const r of rows) {
    const st = out[r.channel as AiChannel];
    if (!st) continue;
    const key = `${r.channel}|${r.peerKey}`;
    if (r.mode === "dry") { dry.add(key); continue; }
    if (r.action === "reply") st.replies++;
    else if (r.action === "escalate") st.handoffs++;
    else if (r.action === "ignore") st.ignores++;
    live.set(key, (live.get(key) ?? false) || r.action === "escalate");
  }
  for (const [key, handed] of live) {
    const st = out[key.split("|")[0] as AiChannel];
    st.chats++;
    if (handed) st.handedChats++; else st.selfChats++;
  }
  for (const key of dry) out[key.split("|")[0] as AiChannel].dryChats++;
  return out;
}

const MODE_RU: Record<AiMode, string> = { on: "отвечает", dry: "тест", off: "выключен" };

function channelLine(label: string, st: AiChannelStat, mode: AiMode, total?: number | null): string {
  const head = `${label} (${MODE_RU[mode]})`;
  if (!st.chats && !st.dryChats) return `• ${head}: ИИ не работал${total ? ` · чатов с покупателями ${total}` : ""}`;
  const parts: string[] = [];
  if (st.chats) {
    const pct = Math.round((st.selfChats / st.chats) * 100);
    parts.push(`${st.chats} ${plural(st.chats, "чат", "чата", "чатов")}${total ? ` из ${total}` : ""} — сам ${st.selfChats} (${pct}%), вам ${st.handedChats}`);
    parts.push(`ответов ${st.replies}, передач ${st.handoffs}${st.ignores ? `, промолчал ${st.ignores}` : ""}`);
  }
  if (st.dryChats) parts.push(`тест: ${st.dryChats} ${plural(st.dryChats, "чат", "чата", "чатов")}`);
  return `• ${head}: ${parts.join(" · ")}`;
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

/** Блок «ИИ-поддержка» по площадкам: Telegram (аккаунт + бот), ВК, WB. HTML. */
export function formatAiStats(
  stats: Record<AiChannel, AiChannelStat>,
  modes: Record<AiChannel, AiMode>,
  opts: { title: string; wbTotalChats?: number | null },
): string {
  const tgChats = stats.tg_pa.chats + stats.tg_bot.chats;
  const tgSelf = stats.tg_pa.selfChats + stats.tg_bot.selfChats;
  return [
    `🧠 <b>${opts.title}</b>`,
    "",
    `📱 <b>Telegram</b>${tgChats ? ` — ${tgChats} ${plural(tgChats, "чат", "чата", "чатов")}, сам ${tgSelf}` : ""}`,
    channelLine("@RobloxBank_PA", stats.tg_pa, modes.tg_pa),
    channelLine("бот @RobloxBankBot", stats.tg_bot, modes.tg_bot),
    "",
    "💬 <b>ВКонтакте</b>",
    channelLine("сообщество", stats.vk_bot, modes.vk_bot),
    "",
    "🛒 <b>Wildberries</b>",
    channelLine("чаты заказов", stats.wb_chat, modes.wb_chat, opts.wbTotalChats),
    "",
    "«Сам» — чат, который ИИ ни разу не передал человеку.",
  ].join("\n");
}

/** Статистика за [since, until): журнал ИИ + сколько всего чатов WB, где писали покупатели. */
export async function loadAiStats(db: Db, since: Date, until: Date = new Date()): Promise<{ stats: Record<AiChannel, AiChannelStat>; wbTotalChats: number | null }> {
  const rows: LogRow[] = await db.aiSupportLog.findMany({
    where: { createdAt: { gte: since, lt: until } },
    select: { channel: true, action: true, mode: true, peerKey: true },
  }).catch(() => []);
  const wb: Array<{ chatId: string }> | null = await db.wbBuyerChatEvent.findMany({
    where: { sentAt: { gte: since, lt: until }, sender: "client" },
    distinct: ["chatId"],
    select: { chatId: true },
  }).catch(() => null);
  return { stats: aggregateAiLog(rows), wbTotalChats: wb ? wb.length : null };
}

/**
 * Итог недели ИИ — в «📊 Сводки» после еженедельной выгрузки диалогов PA:
 * та же раскладка по площадкам, что в утренней сводке и /ai_stats, плюс
 * напоминание, что выгрузка готова к разбору (разбирает Claude по просьбе владельца).
 */
export async function aiWeeklyReport(
  db: Db,
  exp: { since: Date; chats: number; messages: number },
  modes?: Record<AiChannel, AiMode>,
): Promise<void> {
  const { stats, wbTotalChats } = await loadAiStats(db, exp.since);
  const html = [
    formatAiStats(stats, modes ?? await loadAiModes(db), { title: `ИИ-поддержка: итог с ${exp.since.toISOString().slice(0, 10)}`, wbTotalChats }),
    "",
    `📥 Выгрузка диалогов @RobloxBank_PA готова: чатов ${exp.chats}, новых сообщений ${exp.messages}.`,
    "Чтобы ИИ отвечал лучше — попросите Claude «разбор ИИ за неделю»: он прочитает журнал и диалоги и допишет базу знаний.",
  ].join("\n");
  const target = await supportCardTarget(db).catch(() => ({ chatId: null, topics: {} as Record<string, number> }));
  const thread = target.chatId ? target.topics.digest : undefined;
  const ids = target.chatId ? [target.chatId] : ADMIN_IDS;
  await Promise.allSettled(ids.map((id) => tgSend(id, html, {
    parse_mode: "HTML",
    ...(thread ? { message_thread_id: thread } : {}),
  })));
}

/** Режимы каналов: @RobloxBank_PA — из настроек беседы поддержки, боты и WB — `/support_mode`. */
export async function loadAiModes(db: Db): Promise<Record<AiChannel, AiMode>> {
  const pa = await db.wbSyncCursor.findUnique({ where: { stream: "pa-support" } }).catch(() => null);
  const paMode = ((pa?.metadata ?? {}) as { mode?: string }).mode;
  const asMode = (m: unknown): AiMode => (m === "on" || m === "dry" ? m : "off");
  const [tgBot, vk, wb] = await Promise.all((["tg_bot", "vk_bot", "wb_chat"] as const).map((k) => supportChannelMode(db, k).catch(() => "off" as const)));
  return { tg_pa: asMode(paMode), tg_bot: asMode(tgBot), vk_bot: asMode(vk), wb_chat: asMode(wb) };
}
