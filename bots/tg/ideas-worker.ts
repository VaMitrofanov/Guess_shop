/* ─────────────────────────────────────────────────────────────────────────────
   💡 «Фичи и баги» — воркер (27.11.2026).

   С 14.11 тема только складывала сообщения в базу (stream `admin-ideas`) и
   ставила 👀 — дальше их не читал никто: к 27.11 все 4 записи висели `new`.

   Теперь:
   1. Новое сообщение в теме → запись #N (`saveIdea`).
   2. Воркер (раз в минуту) разбирает запись моделью: баг / фича / данные /
      идея, заголовок, суть, что неясно — и отвечает в теме на исходное
      сообщение карточкой «🗂 #N». Скриншот идёт модели.
   3. Ответ в теме на исходное сообщение или на карточку = уточнение к той же
      записи (а не новая запись) — уходит в `notes`.
   4. Разработка берёт очередь скриптом `scripts/ideas.mjs` (list / show /
      start / done / reject). Смена статуса → бот отвечает в теме «🛠 взяли» /
      «✅ сделано: …» на исходное сообщение.
   ───────────────────────────────────────────────────────────────────────── */

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { Telegraf } from "telegraf";
import { db } from "../shared/db";
import { escapeHtml } from "../shared/notify";
import { PA_AI_STRONG_MODEL } from "../shared/pa-ai-support";
import { loadSettings } from "./pa-ai";

export const IDEAS_STREAM = "admin-ideas";
const IDEAS_MAX = 500;

export type IdeaStatus = "new" | "queued" | "in_progress" | "done" | "rejected";
export interface IdeaNote { at: string; from: string; text: string; photo?: string | null }
export interface Idea {
  n?: number;
  at: string;
  from: string;
  text: string;
  photo: string | null;
  messageId: number;
  status: IdeaStatus;
  kind?: string;
  title?: string;
  summary?: string;
  question?: string | null;
  triagedAt?: string;
  triageMessageId?: number;
  notes?: IdeaNote[];
  /** Что сделано / почему нет — пишет разработка. */
  result?: string | null;
  /** Какой статус уже объявлен в теме. */
  announced?: IdeaStatus;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tg = any;

async function loadItems(): Promise<Idea[]> {
  const row = await db.wbSyncCursor.findUnique({ where: { stream: IDEAS_STREAM } }).catch(() => null);
  const items = ((row?.metadata ?? {}) as { items?: Idea[] }).items;
  return Array.isArray(items) ? items : [];
}

/** Читаем-правим-пишем одним заходом; нумерация #N — сквозная. */
async function updateItems(fn: (items: Idea[]) => void): Promise<Idea[]> {
  const items = await loadItems();
  let max = Math.max(0, ...items.map((i) => i.n ?? 0));
  for (const i of items) if (!i.n) i.n = ++max;
  fn(items);
  for (const i of items) if (!i.n) i.n = ++max;
  const kept = items.slice(-IDEAS_MAX);
  await db.wbSyncCursor.upsert({
    where: { stream: IDEAS_STREAM },
    create: { stream: IDEAS_STREAM, metadata: { items: kept } as never },
    update: { metadata: { items: kept } as never },
  });
  return kept;
}

/** Запись, к которой относится ответ в теме: по исходному сообщению или карточке. */
export function ideaForReply(items: Idea[], replyToId: number | undefined, text: string): Idea | null {
  if (replyToId) {
    const hit = items.find((i) => i.messageId === replyToId || i.triageMessageId === replyToId);
    if (hit) return hit;
  }
  const m = /^#(\d{1,4})\b/.exec(text.trim());
  return m ? items.find((i) => i.n === Number(m[1])) ?? null : null;
}

const fromOf = (ctx: Tg) => (ctx.from?.username ? `@${ctx.from.username}` : ctx.from?.first_name ?? String(ctx.from?.id ?? "?"));

/** Сообщение в теме «Фичи и баги»: новая запись или уточнение к старой. */
export async function saveIdea(ctx: Tg, msg: Tg): Promise<void> {
  const text = String(msg.text ?? msg.caption ?? "").trim();
  const photo = Array.isArray(msg.photo) && msg.photo.length ? msg.photo[msg.photo.length - 1].file_id : null;
  if (!text && !photo) return;
  const from = fromOf(ctx);
  const replyTo: number | undefined = msg.reply_to_message && !msg.reply_to_message.forum_topic_created ? msg.reply_to_message.message_id : undefined;
  let noteFor: number | undefined;
  await updateItems((items) => {
    const parent = ideaForReply(items, replyTo, text);
    if (parent) {
      parent.notes = [...(parent.notes ?? []), { at: new Date().toISOString(), from, text: text.slice(0, 4000), photo }].slice(-30);
      noteFor = parent.n;
      return;
    }
    items.push({ at: new Date().toISOString(), from, text: text.slice(0, 4000), photo, messageId: msg.message_id, status: "new" });
  });
  await ctx.telegram.callApi("setMessageReaction", {
    chat_id: ctx.chat.id, message_id: msg.message_id, reaction: [{ type: "emoji", emoji: noteFor ? "✍" : "👀" }],
  }).catch(() => undefined);
}

/* ── Разбор моделью ─────────────────────────────────────────────────────── */

const TriageSchema = z.object({
  kind: z.enum(["bug", "feature", "data", "idea", "question"]),
  title: z.string(),
  summary: z.string(),
  question: z.string().nullable(),
});

const TRIAGE_SYSTEM = `Ты — тимлид разработки магазина RobloxBank (робуксы через геймпассы и коды пополнения; продажи на Wildberries, сайт robloxbank.ru, Telegram- и VK-боты, админка TWA и /admin, ИИ-воркер поддержки в чатах WB/TG/VK). Владелец и админы пишут в тему «Фичи и баги» коротко, разговорно, иногда грубо, часто со скриншотом.

Разбери одно сообщение для очереди разработки. JSON:
• kind: bug (что-то работает не так), feature (новая возможность), data (поменять данные/цены/тексты), idea (мысль без чёткой задачи), question (вопрос, не задача);
• title — заголовок задачи, 3–8 слов, по-русски, без кавычек;
• summary — 1–3 предложения: что именно сделать или починить и где, так, чтобы разработчик понял без переписки. Ничего не выдумывай сверх сообщения и скриншота;
• question — один уточняющий вопрос автору, только если без ответа задачу нельзя сделать правильно; иначе null.`;

let client: Anthropic | null = null;
const anthropic = () => (client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!.trim(), maxRetries: 1, timeout: 90_000 }));

async function photoBlock(telegram: Tg, fileId: string | null | undefined) {
  if (!fileId) return null;
  try {
    const link = await telegram.getFileLink(fileId);
    const res = await fetch(String(link), { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    const data = Buffer.from(await res.arrayBuffer()).toString("base64");
    return { type: "image" as const, source: { type: "base64" as const, media_type: "image/jpeg" as const, data } };
  } catch {
    return null;
  }
}

async function triage(telegram: Tg, item: Idea) {
  const image = await photoBlock(telegram, item.photo);
  const res = await anthropic().messages.parse({
    model: PA_AI_STRONG_MODEL,
    max_tokens: 1000,
    system: TRIAGE_SYSTEM,
    messages: [{
      role: "user",
      content: [
        ...(image ? [image] : []),
        { type: "text" as const, text: `От ${item.from}, ${item.at.slice(0, 10)}:\n${item.text || "(только скриншот)"}` },
      ],
    }],
    output_config: { format: zodOutputFormat(TriageSchema) },
  });
  return res.parsed_output ?? null;
}

const KIND_RU: Record<string, string> = { bug: "🐞 баг", feature: "✨ фича", data: "🗃 данные", idea: "💭 идея", question: "❓ вопрос" };

async function replyInTopic(telegram: Tg, chatId: number, thread: number, replyTo: number, html: string): Promise<number | null> {
  const sent = await telegram.sendMessage(chatId, html, {
    parse_mode: "HTML", message_thread_id: thread, disable_notification: true,
    reply_parameters: { message_id: replyTo, allow_sending_without_reply: true },
    link_preview_options: { is_disabled: true },
  }).catch((e: unknown) => { console.warn("[ideas] ответ в тему:", e instanceof Error ? e.message : e); return null; });
  return sent?.message_id ?? null;
}

export async function runIdeasTick(telegram: Tg): Promise<void> {
  const s = await loadSettings();
  const thread = s.topics.ideas;
  if (!s.chatId || !thread) return;
  const items = await loadItems();

  // 1) Разбор новых — по три за проход.
  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    for (const item of items.filter((i) => !i.triagedAt).slice(0, 3)) {
      const t = await triage(telegram, item).catch((e) => { console.warn("[ideas] разбор:", e instanceof Error ? e.message : e); return null; });
      if (!t) continue;
      const n = item.n ?? 0;
      const html = [
        `🗂 <b>#${n} · ${KIND_RU[t.kind] ?? t.kind}</b> · ${escapeHtml(t.title)}`,
        escapeHtml(t.summary),
        t.question ? `\n❓ ${escapeHtml(t.question)}\n<i>Ответьте на это сообщение — допишу к задаче.</i>` : "",
        `\nСтатус: в очереди разработки`,
      ].filter(Boolean).join("\n");
      const triageMessageId = await replyInTopic(telegram, s.chatId, thread, item.messageId, html);
      await updateItems((all) => {
        const x = all.find((i) => i.n === item.n);
        if (!x) return;
        Object.assign(x, { kind: t.kind, title: t.title, summary: t.summary, question: t.question, triagedAt: new Date().toISOString(), status: x.status === "new" ? "queued" : x.status, announced: x.status === "new" ? "queued" : x.announced, ...(triageMessageId ? { triageMessageId } : {}) });
      });
    }
  }

  // 2) Статусы, которые поставила разработка, — объявить в теме.
  for (const item of items.filter((i) => i.triagedAt && (i.status === "in_progress" || i.status === "done" || i.status === "rejected") && i.announced !== i.status)) {
    const head = item.status === "in_progress" ? "🛠 Взяли в работу" : item.status === "done" ? "✅ Сделано" : "🚫 Не делаем";
    const html = `${head} · <b>#${item.n}</b> ${escapeHtml(item.title ?? "")}${item.result ? `\n${escapeHtml(item.result)}` : ""}`;
    const ok = await replyInTopic(telegram, s.chatId, thread, item.messageId, html);
    if (ok) await updateItems((all) => { const x = all.find((i) => i.n === item.n); if (x) x.announced = item.status; });
  }
}

export function startIdeasWorker(bot: Telegraf): void {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try { await runIdeasTick(bot.telegram); } catch (e) { console.warn("[ideas] проход:", e instanceof Error ? e.message : e); } finally { busy = false; }
  };
  setTimeout(() => void tick(), 60_000);
  setInterval(() => void tick(), 60_000);
}
