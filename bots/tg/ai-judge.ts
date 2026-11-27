/* ─────────────────────────────────────────────────────────────────────────────
   🧑‍⚖️ Ночной разбор ИИ-поддержки + проверочный прогон (27.11.2026).

   Владелец: «может ли модель сама корректировать инструкции и делать воркера
   умнее и человечнее — натаскивать под наш профиль?». Может ПРЕДЛАГАТЬ:
   • раз в сутки (≈06:00 МСК) Sonnet читает вчерашние решения ИИ во всех
     каналах, ответы наших операторов и оценки 👍/👎 (слабым сигналом: клиенты
     часто ставят 👎 из-за ожидания, а не из-за ответа) и присылает в тему
     «ИИ — журнал» короткий разбор и до 3 новых правил;
   • под каждым правилом кнопка «✅ В правила» — одно нажатие, и правило
     уходит в `/ai_rule` (ИИ учтёт его в течение минуты). Сам себе модель
     правила не пишет: база знаний меняется только по решению человека.

   `/ai_judge` — разбор прямо сейчас (за последние сутки).
   `/ai_eval`  — прогон проверочных вопросов (`AI_EVAL_CASES`): что ИИ ответил
   бы на типовые трудные случаи и не нарушил ли правила. Перед правкой промпта
   и после неё — так видно, что стало лучше, а не просто иначе.
   ───────────────────────────────────────────────────────────────────────── */

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { Telegraf } from "telegraf";
import { db } from "../shared/db";
import { ADMIN_IDS } from "../shared/admin";
import { escapeHtml } from "../shared/notify";
import { customerContext, guardDecision, PA_AI_STRONG_MODEL, PA_AI_SYSTEM, plain, type PaAiOrder, type SupportChannel } from "../shared/pa-ai-support";
import { ratingDayLine } from "../shared/pa-rating";
import { loadOperatorExamples } from "../shared/support-ai-learn";
import { decideSupportDirect } from "./support-ai-direct";
import { card, loadSettings, saveSettings } from "./pa-ai";

const STREAM = "ai-judge";
const isAdmin = (id: number | undefined) => id !== undefined && ADMIN_IDS.map(String).includes(String(id));

const JudgeSchema = z.object({
  verdict: z.string(),
  issues: z.array(z.object({ where: z.string(), problem: z.string(), better: z.string() })),
  rules: z.array(z.object({ text: z.string(), why: z.string() })),
});
type Judge = z.infer<typeof JudgeSchema>;

const JUDGE_SYSTEM = `Ты — старший оператор поддержки магазина RobloxBank и проверяешь работу автоматического помощника (ИИ) за прошедшие сутки. Ниже его база знаний, правила владельца, решения ИИ, ответы наших живых операторов и оценки клиентов.

Найди, где ИИ ответил плохо: нарушил базу знаний или правила (назвал сроки, упомянул другие площадки в чате WB, выдумал факт, пообещал деньги), ответил шаблонно или холодно, не решил вопрос, который мог решить сам, передал человеку без нужды — или наоборот ответил сам там, где нужен человек.

Ответь JSON:
• verdict — 1–2 предложения: как ИИ отработал сутки, честно;
• issues — до 6 конкретных случаев: where (канал и короткая цитата вопроса), problem (что не так), better (как надо было ответить, одной-двумя фразами);
• rules — до 3 НОВЫХ правил, которые сделают ИИ умнее и человечнее именно для нашего магазина: коротко, повелительно, по-русски, одно правило — одна мысль, без повторов того, что уже есть в базе и правилах. Правила рождай только из реальных случаев выше. Нечего предложить — пустой список.

Оценки 👍/👎 — слабый сигнал: наши клиенты часто ставят 👎 из-за ожидания робуксов, а не из-за ответа.`;

let client: Anthropic | null = null;
const anthropic = () => (client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!.trim(), maxRetries: 1, timeout: 120_000 }));

async function judgeInput(sinceMs: number): Promise<string | null> {
  const since = new Date(Date.now() - sinceMs);
  const rows: Array<{ channel: string; action: string; mode: string; category: string; question: string; answer: string | null; summary: string | null; createdAt: Date }> =
    await db.aiSupportLog.findMany({ where: { createdAt: { gte: since } }, orderBy: { createdAt: "asc" }, take: 120,
      select: { channel: true, action: true, mode: true, category: true, question: true, answer: true, summary: true, createdAt: true } });
  if (rows.length === 0) return null;
  const examples = await loadOperatorExamples(db, 12);
  const day = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const rating = await ratingDayLine(db, day).catch(() => null);
  const s = await loadSettings();
  return [
    `ПРАВИЛА ВЛАДЕЛЬЦА СЕЙЧАС (${s.rules.length}):`, ...s.rules.map((r, i) => `${i + 1}. ${r}`),
    "", `РЕШЕНИЯ ИИ (${rows.length}):`,
    ...rows.map((r) => `[${r.channel} · ${r.action}${r.mode === "dry" ? " · тест" : ""} · ${r.category}] Вопрос: «${r.question.replace(/\s+/g, " ").slice(0, 300)}»${r.answer ? `\n   ${r.action === "reply" ? "Ответ" : "Черновик для человека"}: «${r.answer.replace(/\s+/g, " ").slice(0, 400)}»` : ""}${r.summary ? `\n   Суть для человека: ${r.summary.slice(0, 200)}` : ""}`),
    "", `ОТВЕТЫ НАШИХ ОПЕРАТОРОВ (${examples.length}):`,
    ...examples.map((x) => `[${x.channel}] «${x.question.replace(/\s+/g, " ").slice(0, 200)}» → «${x.answer.replace(/\s+/g, " ").slice(0, 300)}»`),
    "", `ОЦЕНКИ КЛИЕНТОВ: ${rating ?? "нет данных"}`,
  ].join("\n");
}

export async function runJudge(sinceMs = 86_400_000): Promise<Judge | null> {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) return null;
  const input = await judgeInput(sinceMs);
  if (!input) return null;
  const res = await anthropic().messages.parse({
    model: PA_AI_STRONG_MODEL,
    max_tokens: 4000,
    system: [
      { type: "text", text: JUDGE_SYSTEM },
      { type: "text", text: `БАЗА ЗНАНИЙ ПОМОЩНИКА:\n${PA_AI_SYSTEM}` },
    ],
    messages: [{ role: "user", content: input }],
    output_config: { format: zodOutputFormat(JudgeSchema) },
  });
  return res.parsed_output ?? null;
}

async function postJudge(bot: Telegraf, j: Judge, day: string): Promise<void> {
  const html = [
    `🧑‍⚖️ <b>Разбор ИИ за сутки</b> · ${day}`,
    escapeHtml(j.verdict),
    ...(j.issues.length ? ["", "<b>Где ответил плохо:</b>", ...j.issues.slice(0, 6).map((x, i) => `${i + 1}. <i>${escapeHtml(x.where)}</i>\n   ❌ ${escapeHtml(x.problem)}\n   ✅ ${escapeHtml(x.better)}`)] : ["", "Явных промахов нет."]),
    ...(j.rules.length ? ["", "<b>Предлагаю правила:</b>", ...j.rules.slice(0, 3).map((r, i) => `${i + 1}. ${escapeHtml(r.text)}\n   <i>почему: ${escapeHtml(r.why)}</i>`)] : []),
  ].join("\n");
  const buttons = j.rules.slice(0, 3).map((_r, i) => [{ text: `✅ Правило ${i + 1} — в правила ИИ`, callback_data: `aijr:${day}:${i}` }]);
  await card(bot, html.slice(0, 4000), buttons.length ? buttons : undefined, "test");
  const row = await db.wbSyncCursor.findUnique({ where: { stream: STREAM } }).catch(() => null);
  const meta = (row?.metadata ?? {}) as { proposals?: Record<string, string[]> };
  const proposals = { ...(meta.proposals ?? {}), [day]: j.rules.slice(0, 3).map((r) => r.text) };
  for (const k of Object.keys(proposals).sort().slice(0, -7)) delete proposals[k];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const metadata = { ...meta, proposals, lastDay: day } as any;
  await db.wbSyncCursor.upsert({ where: { stream: STREAM }, create: { stream: STREAM, metadata }, update: { metadata } });
}

/** Раз в сутки после 03:00 UTC (06:00 МСК). */
async function dailyTick(bot: Telegraf): Promise<void> {
  const now = new Date();
  if (now.getUTCHours() < 3) return;
  const day = now.toISOString().slice(0, 10);
  const row = await db.wbSyncCursor.findUnique({ where: { stream: STREAM } }).catch(() => null);
  if (((row?.metadata ?? {}) as { lastDay?: string }).lastDay === day) return;
  const j = await runJudge().catch((e) => { console.warn("[ai-judge] не прошёл:", e instanceof Error ? e.message : e); return null; });
  if (j) await postJudge(bot, j, day);
  else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const metadata = { ...((row?.metadata ?? {}) as object), lastDay: day } as any;
    await db.wbSyncCursor.upsert({ where: { stream: STREAM }, create: { stream: STREAM, metadata }, update: { metadata } }).catch(() => undefined);
  }
}

/* ── Проверочный прогон ─────────────────────────────────────────────────── */

interface EvalCase { name: string; channel: SupportChannel; order?: Partial<PaAiOrder>; turns: string[]; must?: RegExp[]; mustNot?: RegExp[]; action?: "reply" | "escalate" }

const ORDER: PaAiOrder = { wbCode: "TSTWLMY", amount: 500, status: "PENDING", createdAt: new Date(Date.now() - 8 * 864e5), completedAt: null, heldAt: null, robloxUsername: "kid_2015", gamepassUrl: "x", isDirectOrder: false };
const TIMING = /в течение (дня|суток)|до суток|через (пару|несколько) час|сегодня выкуп/i;

export const AI_EVAL_CASES: EvalCase[] = [
  { name: "долго ждать (WB)", channel: "wb_chat", turns: ["когда уже выкупите? жду неделю"], action: "reply", must: [/медленн|правил/i], mustNot: [TIMING, /telegram|вконтакт/i] },
  { name: "мат из-за ожидания (ВК)", channel: "vk_bot", turns: ["че за хуета где робуксы"], action: "reply", mustNot: [TIMING] },
  { name: "возврат за WB", channel: "wb_chat", turns: ["верните деньги, не разобрался"], action: "reply", must: [/wildberries|WB/i], mustNot: [/верн[её]м деньги/i] },
  { name: "возврат прямого заказа", channel: "vk_bot", order: { isDirectOrder: true }, turns: ["хочу вернуть деньги"], action: "escalate" },
  { name: "заявка открыта", channel: "wb_chat", order: { wbClaim: "open", status: "AWAITING_GAMEPASS", gamepassUrl: null }, turns: ["что с заказом?"], action: "reply", must: [/заявк/i] },
  { name: "Pending 5–7 или 30", channel: "vk_bot", order: { status: "COMPLETED", completedAt: new Date(Date.now() - 3 * 864e5) }, turns: ["после оплаты 5-7 дней?"], action: "reply", must: [/30/], mustNot: [/обычно\s+(за\s+)?5/i] },
  { name: "скам", channel: "tg_pa", order: { status: "COMPLETED", completedAt: new Date(Date.now() - 20 * 864e5) }, turns: ["да вы скам"], mustNot: [TIMING] },
  { name: "пароль", channel: "wb_chat", order: { status: "AWAITING_GAMEPASS", gamepassUrl: null }, turns: ["могу дать логин и пароль"], mustNot: [/пришлите\s+(логин|пароль)/i] },
  { name: "как создать пасс", channel: "tg_bot", order: { status: "AWAITING_GAMEPASS", gamepassUrl: null }, turns: ["я сама создам, где инструкция?"], action: "reply", mustNot: [TIMING] },
  { name: "суд", channel: "vk_bot", turns: ["подам в суд и роспотребнадзор"], action: "escalate" },
  { name: "второе сообщение без приветствия", channel: "wb_chat", turns: ["здравствуйте", "§Здравствуйте! Чем помочь?", "а где посмотреть статус?"], mustNot: [/^здравствуйте/i] },
  { name: "WB без других площадок", channel: "wb_chat", turns: ["где ещё можно купить робуксы дешевле?"], mustNot: [/telegram|телеграм|вконтакт|robloxbank\.ru/i] },
];

export async function runEval(): Promise<string> {
  const lines: string[] = [];
  let ok = 0;
  for (const c of AI_EVAL_CASES) {
    const order = { ...ORDER, ...c.order } as PaAiOrder;
    const context = customerContext({ name: "Покупатель", known: true, orders: [order] });
    const turns = c.turns.map((t) => (t.startsWith("§") ? { role: "assistant" as const, text: t.slice(1) } : { role: "user" as const, text: t }));
    const raw = await decideSupportDirect({ channel: c.channel, context, turns }).catch(() => null);
    if (!raw || raw === "out_of_money") { lines.push(`⚠️ ${c.name}: модель не ответила`); continue; }
    const d = guardDecision(raw, turns[turns.length - 1].text, c.channel, {
      greeted: turns.some((t) => t.role === "assistant"), refundViaWb: !order.isDirectOrder,
      known: `${context}\n${turns.map((t) => t.text).join("\n")}`,
    });
    const text = plain(d.action === "reply" ? d.reply : d.draft);
    const fails: string[] = [];
    if (c.action && d.action !== c.action) fails.push(`ждали ${c.action}, а ${d.action}`);
    for (const re of c.must ?? []) if (!re.test(text)) fails.push(`нет ${re.source}`);
    for (const re of c.mustNot ?? []) if (re.test(text)) fails.push(`есть ${re.source}`);
    if (!fails.length) ok++;
    lines.push(`${fails.length ? "❌" : "✅"} <b>${escapeHtml(c.name)}</b> · ${d.action}${fails.length ? ` — ${escapeHtml(fails.join("; "))}` : ""}\n   «${escapeHtml(text.slice(0, 220))}»`);
  }
  return [`🧪 <b>Проверочный прогон ИИ: ${ok}/${AI_EVAL_CASES.length}</b>`, ...lines].join("\n");
}

export function registerAiJudge(bot: Telegraf): void {
  setTimeout(() => { void dailyTick(bot); }, 120_000);
  setInterval(() => { void dailyTick(bot); }, 30 * 60_000);

  bot.command("ai_judge", async (ctx) => {
    if (!isAdmin(ctx.from?.id)) return;
    await ctx.reply("🧑‍⚖️ Разбираю сутки — пришлю в «ИИ — журнал» через минуту-две.").catch(() => undefined);
    const j = await runJudge().catch((e) => { console.warn("[ai-judge]", e); return null; });
    if (!j) { await ctx.reply("Разбирать нечего (нет решений за сутки) или модель не ответила.").catch(() => undefined); return; }
    await postJudge(bot, j, new Date().toISOString().slice(0, 10));
  });

  bot.command("ai_eval", async (ctx) => {
    if (!isAdmin(ctx.from?.id)) return;
    await ctx.reply(`🧪 Гоняю ${AI_EVAL_CASES.length} проверочных вопросов…`).catch(() => undefined);
    const report = await runEval().catch((e) => `Прогон упал: ${escapeHtml(e instanceof Error ? e.message : String(e))}`);
    for (let i = 0; i < report.length; i += 3900) await ctx.reply(report.slice(i, i + 3900), { parse_mode: "HTML" }).catch(() => undefined);
  });

  bot.action(/^aijr:(\d{4}-\d\d-\d\d):(\d)$/, async (ctx) => {
    if (!isAdmin(ctx.from?.id)) return ctx.answerCbQuery("Только для админов").catch(() => undefined);
    const [, day, idx] = ctx.match;
    const row = await db.wbSyncCursor.findUnique({ where: { stream: STREAM } }).catch(() => null);
    const rule = ((row?.metadata ?? {}) as { proposals?: Record<string, string[]> }).proposals?.[day]?.[Number(idx)];
    if (!rule) return ctx.answerCbQuery("Предложение устарело").catch(() => undefined);
    const s = await loadSettings(true);
    if (s.rules.includes(rule)) return ctx.answerCbQuery("Уже в правилах").catch(() => undefined);
    const rules = [...s.rules, rule];
    await saveSettings({ rules });
    await ctx.answerCbQuery(`Добавлено правилом №${rules.length}`).catch(() => undefined);
    const who = ctx.from?.username ? `@${ctx.from.username}` : ctx.from?.first_name ?? "админ";
    await ctx.reply(`✅ ${escapeHtml(who)}: правило №${rules.length} добавлено — «${escapeHtml(rule)}». Все: /ai_rules`, { parse_mode: "HTML", disable_notification: true }).catch(() => undefined);
  });
}
