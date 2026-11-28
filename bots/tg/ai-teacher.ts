/* ─────────────────────────────────────────────────────────────────────────────
   Учитель воркера (28.11.2026). Владелец: «построй идеальный вариант
   самообучения». Отвечает быстрая модель (Haiku/Sonnet), учит — умная (Opus),
   раз в сутки, ночью, и только с ✅ владельца.

   1. Сверка. Решения воркера за сутки (`AiSupportLog`) сводим с ответами
      операторов на тот же вопрос (библиотека `ai-examples`, её пополняет сбор).
      Где ответил человек — видно, как надо было; где воркер ответил сам, а
      человек не вмешался — это тоже сигнал.
   2. Разбор (Opus). Каждому случаю — вердикт (верно / не тот факт / не тот тон /
      зря позвал человека / зря ответил сам / оператор сам ответил плохо) и до 5
      предложений к своду правил (`/ai_rules`): добавить, заменить, убрать.
   3. Экзамен. Накопленные случаи (до 200) прогоняем воркером дважды — со
      старыми правилами и с предложенными; Opus оценивает оба ответа против
      ответа оператора. Хуже — предложения уходят без кнопки «принять».
   4. Чистка шпаргалки. Каждую ночь Opus смотрит очередные 150 пар библиотеки:
      устаревшие/плохие — вон (и в чёрный список, сбор их не вернёт),
      образцовые — `gold`, они выше в подборе.
   5. Карточка в «Сводки» беседы PA: итог, доля совпадений за 7 дней, каждое
      предложение с ✅ / ❌. Без ✅ свод правил не меняется.
   ───────────────────────────────────────────────────────────────────────── */

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { Telegraf } from "telegraf";
import { z } from "zod";
import { db } from "../shared/db";
import { ADMIN_IDS } from "../shared/admin";
import { escapeHtml } from "../shared/notify";
import { curateExamples, keyOf, loadExampleLibrary, stems, type OperatorExample } from "../shared/support-ai-learn";
import type { SupportChannel } from "../shared/pa-ai-support";
import { card, loadSettings, saveSettings } from "./pa-ai";
import { decideSupportDirect } from "./support-ai-direct";

export const TEACHER_MODEL = "claude-opus-5-5";
const STREAM = "ai-teacher";
const MSK = 3 * 3_600_000;
const EXAM_KEEP = 200;
const EXAM_RUN = 12;
const CURATE_BATCH = 150;
export const RULES_CAP = 60;

export interface TeachCase {
  channel: string;
  question: string;
  /** reply | escalate — что сделал воркер. */
  aiAction: string;
  aiAnswer: string;
  operator: string;
  at: string;
}

interface Proposal { op: "add" | "replace" | "remove"; rule: number | null; text: string; why: string; status?: "ok" | "no" }
interface Run { id: string; day: string; proposals: Proposal[]; examPassed: boolean | null }
interface TeacherMeta {
  day?: string;
  exam: TeachCase[];
  runs: Run[];
  history: Array<{ day: string; cases: number; good: number }>;
  curateOffset: number;
}

async function readMeta(): Promise<TeacherMeta> {
  const row = await db.wbSyncCursor.findUnique({ where: { stream: STREAM } }).catch(() => null);
  const m = (row?.metadata ?? {}) as Partial<TeacherMeta>;
  return { day: m.day, exam: m.exam ?? [], runs: m.runs ?? [], history: m.history ?? [], curateOffset: m.curateOffset ?? 0 };
}

async function writeMeta(m: TeacherMeta): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const metadata = m as any;
  await db.wbSyncCursor.upsert({ where: { stream: STREAM }, create: { stream: STREAM, metadata }, update: { metadata } });
}

/* ── 1. Сверка ──────────────────────────────────────────────────────────── */

/** Насколько вопрос из журнала совпадает с вопросом пары оператора (0…1). */
export function questionOverlap(a: string, b: string): number {
  const na = keyOf(a);
  const nb = keyOf(b);
  if (na && nb && (nb.includes(na) || na.includes(nb))) return 1;
  const sa = stems(a);
  const sb = stems(b);
  if (!sa.size || !sb.size) return 0;
  let common = 0;
  for (const w of sa) if (sb.has(w)) common++;
  return common / Math.min(sa.size, sb.size);
}

/** Решения воркера + ответы операторов → случаи для разбора. */
export function matchCases(
  logs: Array<{ channel: string; action: string; question: string; answer: string | null; summary: string | null; createdAt: Date }>,
  ops: OperatorExample[],
): TeachCase[] {
  const out: TeachCase[] = [];
  const used = new Set<OperatorExample>();
  for (const log of logs) {
    if (log.action === "ignore") continue;
    const t = log.createdAt.getTime();
    let best: { op: OperatorExample; score: number } | null = null;
    for (const op of ops) {
      if (used.has(op) || op.channel !== log.channel) continue;
      const at = Date.parse(op.at);
      if (at < t - 3_600_000 || at > t + 24 * 3_600_000) continue;
      const score = questionOverlap(log.question, op.question);
      if (score >= 0.6 && (!best || score > best.score)) best = { op, score };
    }
    if (!best) continue;
    used.add(best.op);
    out.push({
      channel: log.channel,
      question: best.op.question.slice(0, 600),
      aiAction: log.action,
      aiAnswer: (log.answer ?? log.summary ?? "").slice(0, 800),
      operator: best.op.answer.slice(0, 800),
      at: best.op.at,
    });
  }
  return out;
}

/* ── 2–4. Модель-учитель ────────────────────────────────────────────────── */

let client: Anthropic | null = null;
const anthropic = () => (client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!.trim(), maxRetries: 1, timeout: 300_000 }));

const VERDICTS = ["good", "close", "wrong_fact", "wrong_tone", "should_reply", "should_escalate", "operator_bad"] as const;

const ReviewSchema = z.object({
  cases: z.array(z.object({ i: z.number().int(), verdict: z.enum(VERDICTS), note: z.string() })),
  proposals: z.array(z.object({
    op: z.enum(["add", "replace", "remove"]),
    rule: z.number().int().nullable(),
    text: z.string(),
    why: z.string(),
  })),
  drop: z.array(z.number().int()),
  gold: z.array(z.number().int()),
});

const TEACHER_SYSTEM = `Ты — старший оператор поддержки магазина робуксов RobloxBank и учишь ИИ-воркера.
Воркер отвечает покупателям в Telegram, ВК и чате Wildberries по базе знаний, своду ПРАВИЛ ВЛАДЕЛЬЦА и примерам ответов операторов.

Тебе дают:
• СВОД ПРАВИЛ (нумерованный) — то, что воркер уже обязан соблюдать;
• СЛУЧАИ — вопрос покупателя, что сделал воркер (ответил / позвал человека) и что ответил живой оператор;
• БИБЛИОТЕКУ — часть пар «вопрос → ответ оператора», из которых воркер берёт примеры.

Задачи:
1. Каждому случаю — вердикт: good (по сути как оператор), close (мелочь), wrong_fact (ошибся в фактах/процессе), wrong_tone (не тот тон), should_reply (зря позвал человека — мог ответить сам), should_escalate (зря ответил сам), operator_bad (сам оператор ответил плохо — учиться на этом нельзя). note — одна короткая фраза.
2. До 5 предложений к своду: add (новое правило), replace (rule = номер, text = новая формулировка), remove (rule = номер, text пустой). Только то, что подтверждается НЕСКОЛЬКИМИ случаями или явной грубой ошибкой; не дублируй базу знаний и существующие правила. Правило — одно-два предложения, как инструкция воркеру. why — какие случаи и почему.
3. Библиотека: drop — номера устаревших или плохих пар (грубость, давление отзывом, обещание сроков, упоминание Авито, мусор, ответ не по вопросу, секреты); gold — номера образцовых ответов (коротко, по делу, решают вопрос). Не трогай то, в чём не уверен.

Жёсткие ограничения магазина (никогда не предлагай обратное): клиенту не называть сроки зачисления робуксов; не называть номера заказов (только код WB и ник Roblox); в чате WB не упоминать другие площадки; возврат за WB — только через WB; не давить отзывом; Авито больше нет.
Пиши по-русски.`;

function rulesBlock(rules: string[]): string {
  return rules.length ? rules.map((r, i) => `${i + 1}. ${r}`).join("\n") : "(пусто)";
}

async function review(rules: string[], cases: TeachCase[], lib: OperatorExample[]) {
  const caseText = cases.map((c, i) =>
    `#${i} [${c.channel}] Покупатель: «${c.question}»\n  Воркер (${c.aiAction === "reply" ? "ответил сам" : "позвал человека"}): «${c.aiAnswer}»\n  Оператор: «${c.operator}»`,
  ).join("\n\n");
  const libText = lib.map((x, i) => `${i}. [${x.channel}] В: «${x.question.replace(/\s+/g, " ").slice(0, 300)}» → О: «${x.answer.replace(/\s+/g, " ").slice(0, 400)}»`).join("\n");
  const res = await anthropic().messages.parse({
    model: TEACHER_MODEL,
    max_tokens: 16000,
    system: TEACHER_SYSTEM,
    messages: [{ role: "user", content: `СВОД ПРАВИЛ:\n${rulesBlock(rules)}\n\nСЛУЧАИ (${cases.length}):\n${caseText || "(нет)"}\n\nБИБЛИОТЕКА (${lib.length}):\n${libText || "(нет)"}` }],
    output_config: { format: zodOutputFormat(ReviewSchema) },
  });
  return res.parsed_output;
}

const JudgeSchema = z.object({ scores: z.array(z.object({ i: z.number().int(), a: z.number().int(), b: z.number().int() })) });

/** Экзамен: ответ воркера со старыми (a) и новыми (b) правилами против оператора, 0–2 балла. */
async function exam(cases: TeachCase[], oldRules: string[], newRules: string[]): Promise<{ before: number; after: number; max: number } | null> {
  const run = async (c: TeachCase, rules: string[]) => {
    const d = await decideSupportDirect({
      channel: (c.channel as SupportChannel),
      context: "Экзамен: данных заказа нет — отвечай по вопросу; где без данных нельзя, так и решай (позвать человека).",
      turns: [{ role: "user", text: c.question }],
    }, { rules, exam: true });
    if (!d || d === "out_of_money") return "(нет ответа)";
    return d.action === "reply" ? `ответил: «${d.reply}»` : d.action === "escalate" ? `позвал человека: ${d.summary}` : "промолчал";
  };
  const rows: string[] = [];
  for (const [i, c] of cases.entries()) {
    const [a, b] = await Promise.all([run(c, oldRules), run(c, newRules)]);
    rows.push(`#${i} Покупатель: «${c.question}»\n  Оператор: «${c.operator}»\n  A: ${a}\n  B: ${b}`);
  }
  const res = await anthropic().messages.parse({
    model: TEACHER_MODEL,
    max_tokens: 4000,
    system: "Оцени ответы A и B ИИ-поддержки против ответа живого оператора: 2 — по сути так же (или лучше), 1 — частично, 0 — неверно/вредно. Звать человека там, где оператор просто ответил, — 1; отвечать самому там, где нужны данные заказа, — 0. Верни баллы для каждого #.",
    messages: [{ role: "user", content: rows.join("\n\n") }],
    output_config: { format: zodOutputFormat(JudgeSchema) },
  });
  const s = res.parsed_output?.scores ?? [];
  if (!s.length) return null;
  return { before: s.reduce((n, x) => n + x.a, 0), after: s.reduce((n, x) => n + x.b, 0), max: s.length * 2 };
}

export function applyProposal(rules: string[], p: Proposal): string[] {
  const idx = p.rule ? p.rule - 1 : -1;
  if (p.op === "add") return [...rules, p.text.trim().slice(0, 600)].slice(-RULES_CAP);
  if (idx < 0 || idx >= rules.length) return rules;
  if (p.op === "remove") return rules.filter((_, i) => i !== idx);
  return rules.map((r, i) => (i === idx ? p.text.trim().slice(0, 600) : r));
}

/** Все предложения разом, с конца по номерам — чтобы remove не сдвигал replace. */
export function applyAll(rules: string[], ps: Proposal[]): string[] {
  const numbered = ps.filter((p) => p.op !== "add").sort((a, b) => (b.rule ?? 0) - (a.rule ?? 0));
  let out = rules;
  for (const p of numbered) out = applyProposal(out, p);
  for (const p of ps.filter((p) => p.op === "add")) out = applyProposal(out, p);
  return out;
}

/* ── Ночной прогон ──────────────────────────────────────────────────────── */

const mskDay = (t = Date.now()) => new Date(t + MSK).toISOString().slice(0, 10);

export async function runTeacher(bot: Telegraf, opts: { force?: boolean } = {}): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) return null;
  const meta = await readMeta();
  const today = mskDay();
  if (!opts.force && meta.day === today) return null;
  meta.day = today;
  await writeMeta(meta);

  const since = new Date(Date.now() - 24 * 3_600_000);
  const logs = await db.aiSupportLog.findMany({
    where: { createdAt: { gte: new Date(since.getTime() - 24 * 3_600_000) }, action: { in: ["reply", "escalate"] } },
    select: { channel: true, action: true, question: true, answer: true, summary: true, createdAt: true },
    orderBy: { createdAt: "asc" },
    take: 1500,
  });
  const lib = await loadExampleLibrary(db);
  const ops = lib.filter((x) => Date.parse(x.at) >= since.getTime() - 24 * 3_600_000);
  const cases = matchCases(logs, ops).slice(-80);

  const start = meta.curateOffset % Math.max(1, lib.length);
  const sample = lib.slice(start, start + CURATE_BATCH);
  meta.curateOffset = start + CURATE_BATCH >= lib.length ? 0 : start + CURATE_BATCH;

  const settings = await loadSettings(true);
  const rules = settings.rules;
  const r = await review(rules, cases, sample);
  if (!r) return "учитель не ответил";

  // Чистка шпаргалки — сразу: это не правила, а отбор примеров.
  const cur = await curateExamples(db, {
    drop: r.drop.map((i) => sample[i]?.question).filter((q): q is string => !!q),
    gold: r.gold.map((i) => sample[i]?.question).filter((q): q is string => !!q),
  });

  const verdict = new Map(r.cases.map((c) => [c.i, c.verdict]));
  const good = cases.filter((_, i) => ["good", "close"].includes(verdict.get(i) ?? "")).length;
  const graded = cases.filter((_, i) => verdict.has(i) && verdict.get(i) !== "operator_bad").length;
  meta.history = [...meta.history.filter((h) => h.day !== today), { day: today, cases: graded, good }].slice(-60);

  // Копилка экзамена: случаи, где оператор ответил хорошо.
  const fresh = cases.filter((_, i) => verdict.has(i) && verdict.get(i) !== "operator_bad");
  const seen = new Set(meta.exam.map((c) => keyOf(c.question)));
  meta.exam = [...meta.exam, ...fresh.filter((c) => !seen.has(keyOf(c.question)))].slice(-EXAM_KEEP);

  const proposals: Proposal[] = r.proposals.slice(0, 5).filter((p) => p.op === "remove" || p.text.trim().length >= 10);
  let examLine = "";
  let examPassed: boolean | null = null;
  if (proposals.length && meta.exam.length >= 4) {
    // Сначала те, где воркер ошибся, потом остальные — до EXAM_RUN.
    const wrong = new Set(cases.filter((_, i) => !["good", "close", "operator_bad"].includes(verdict.get(i) ?? "good")).map((c) => keyOf(c.question)));
    const pool = [...meta.exam].reverse();
    const pick = [...pool.filter((c) => wrong.has(keyOf(c.question))), ...pool.filter((c) => !wrong.has(keyOf(c.question)))].slice(0, EXAM_RUN);
    const e = await exam(pick, rules, applyAll(rules, proposals)).catch((err) => { console.warn("[ai-teacher] экзамен:", err instanceof Error ? err.message : err); return null; });
    if (e) {
      examPassed = e.after >= e.before;
      examLine = `🎓 Экзамен на ${pick.length} диалогах: со старыми правилами ${e.before}/${e.max}, с новыми ${e.after}/${e.max}${examPassed ? "" : " — хуже, принять нельзя"}`;
    }
  }

  const run: Run = { id: Date.now().toString(36), day: today, proposals, examPassed };
  meta.runs = [...meta.runs, run].slice(-14);
  await writeMeta(meta);

  const week = meta.history.slice(-7).reduce((a, h) => ({ c: a.c + h.cases, g: a.g + h.good }), { c: 0, g: 0 });
  const pct = (g: number, c: number) => (c ? `${Math.round((g / c) * 100)}%` : "—");
  const counts = r.cases.reduce((m, c) => m.set(c.verdict, (m.get(c.verdict) ?? 0) + 1), new Map<string, number>());
  const VRU: Record<string, string> = { wrong_fact: "ошибся в фактах", wrong_tone: "не тот тон", should_reply: "зря звал человека", should_escalate: "зря ответил сам", operator_bad: "оператор ответил плохо" };
  const misses = [...counts].filter(([v]) => VRU[v]).map(([v, n]) => `${VRU[v]} — ${n}`).join(", ");

  const head = [
    `🧑‍🏫 <b>Учитель воркера · ${today.slice(8, 10)}.${today.slice(5, 7)}</b>`,
    "",
    `Сверил ${cases.length} ответов воркера с ответами операторов: совпало ${good} из ${graded} (${pct(good, graded)}). За 7 дней — ${pct(week.g, week.c)}.`,
    misses ? `Промахи: ${escapeHtml(misses)}.` : "",
    `Шпаргалка: убрал ${cur.dropped} устаревших/плохих, отметил ${cur.gold} образцовых (всего ${lib.length - cur.dropped}).`,
    examLine ? escapeHtml(examLine) : "",
    proposals.length ? "\nПредложения к правилам ниже — без ✅ ничего не меняется." : "\nНовых правил не предлагаю.",
  ].filter(Boolean).join("\n");
  await card(bot, head, undefined, "digest", true);

  for (const [i, p] of proposals.entries()) {
    const what = p.op === "add" ? "➕ Новое правило"
      : p.op === "replace" ? `✏️ Заменить правило №${p.rule} («${escapeHtml((rules[(p.rule ?? 0) - 1] ?? "").slice(0, 160))}»)`
      : `🗑 Убрать правило №${p.rule} («${escapeHtml((rules[(p.rule ?? 0) - 1] ?? "").slice(0, 160))}»)`;
    const body = `${what}\n\n${p.text ? `<b>${escapeHtml(p.text)}</b>\n\n` : ""}<i>${escapeHtml(p.why)}</i>`;
    const buttons = [[
      ...(examPassed === false ? [] : [{ text: "✅ Принять", callback_data: `aiteach:ok:${run.id}:${i}` }]),
      { text: "❌ Нет", callback_data: `aiteach:no:${run.id}:${i}` },
    ]];
    await card(bot, body, buttons, "digest", true);
  }
  return `случаев ${cases.length}, совпало ${good}/${graded}, предложений ${proposals.length}, шпаргалка −${cur.dropped} / gold +${cur.gold}`;
}

/* ── Кнопки и запуск ────────────────────────────────────────────────────── */

const isAdmin = (id: number | undefined) => id !== undefined && ADMIN_IDS.map(String).includes(String(id));

export function registerAiTeacher(bot: Telegraf): void {
  bot.action(/^aiteach:(ok|no):(\w+):(\d+)$/, async (ctx) => {
    if (!isAdmin(ctx.from?.id)) return ctx.answerCbQuery("Только для админов").catch(() => undefined);
    const [, act, runId, idxRaw] = ctx.match;
    const meta = await readMeta();
    const run = meta.runs.find((r) => r.id === runId);
    const p = run?.proposals[Number(idxRaw)];
    if (!run || !p) return ctx.answerCbQuery("Устарело").catch(() => undefined);
    if (p.status) return ctx.answerCbQuery(p.status === "ok" ? "Уже принято" : "Уже отклонено").catch(() => undefined);
    const who = ctx.from?.username ? `@${ctx.from.username}` : ctx.from?.first_name ?? "админ";
    if (act === "ok") {
      if (run.examPassed === false) return ctx.answerCbQuery("Экзамен не пройден").catch(() => undefined);
      const s = await loadSettings(true);
      // Номер правила мог уехать, если до этого приняли remove из той же партии.
      const shift = run.proposals.filter((q, j) => j !== Number(idxRaw) && q.status === "ok" && q.op === "remove" && (q.rule ?? 0) < (p.rule ?? 0)).length;
      await saveSettings({ rules: applyProposal(s.rules, { ...p, rule: p.rule ? p.rule - shift : null }) });
    }
    p.status = act === "ok" ? "ok" : "no";
    await writeMeta(meta);
    await ctx.answerCbQuery(act === "ok" ? "Принято — воркер учтёт в течение минуты" : "Отклонено").catch(() => undefined);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const msg = ctx.callbackQuery?.message as any;
    const old = (msg?.text ?? "") as string;
    await ctx.editMessageText(`${escapeHtml(old)}\n\n${act === "ok" ? "✅ Принято" : "❌ Отклонено"} · ${escapeHtml(who)}`, { parse_mode: "HTML" }).catch(() => undefined);
  });

  bot.command("ai_teach", async (ctx) => {
    if (!isAdmin(ctx.from?.id)) return;
    await ctx.reply("🧑‍🏫 Запускаю разбор — карточки придут в «Сводки» через несколько минут.");
    void runTeacher(bot, { force: true })
      .then((r) => console.log(`[ai-teacher] ${r ?? "пропуск"}`))
      .catch((e) => console.error("[ai-teacher]", e instanceof Error ? e.message : e));
  });

  // Ночью: после 05:00 МСК, раз в сутки (до утренней сводки в 09:00).
  const tick = () => {
    if (new Date(Date.now() + MSK).getUTCHours() < 5) return;
    void runTeacher(bot)
      .then((r) => { if (r) console.log(`[ai-teacher] ${r}`); })
      .catch((e) => console.error("[ai-teacher]", e instanceof Error ? e.message : e));
  };
  setTimeout(tick, 15 * 60_000);
  setInterval(tick, 30 * 60_000);
}
