/* ─────────────────────────────────────────────────────────────────────────────
   Вызов модели ИИ-поддержки (SDK Anthropic + zod). Грузится ТОЛЬКО там, где
   есть ANTHROPIC_API_KEY (TG-бот): в образе ВК-бота этих пакетов нет, поэтому
   `support-ai.ts` и мост подключают этот файл динамическим импортом.
   ───────────────────────────────────────────────────────────────────────── */

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { BUYER_TONES, CHANNEL_NOTES, PA_AI_CATEGORIES, PA_AI_MODEL, PA_AI_STRONG_MODEL, PA_AI_SYSTEM, type SupportChannel } from "../shared/pa-ai-support";
import { SUPPORT_SETTINGS_STREAM, type SupportAiRequest, type SupportAiResult } from "../shared/support-ai";
import { db } from "../shared/db";
import { examplesBlock, loadExampleLibrary, pickExamples } from "../shared/support-ai-learn";
import { SUPPORT_TOOLS, runSupportTool } from "./support-ai-tools";
import { recordUsage } from "./ai-usage";

/** Похожие ответы операторов под этот вопрос (28.11.2026: вся библиотека, не «последние 8»). */
async function examplesFor(req: SupportAiRequest): Promise<string> {
  const users = req.turns.filter((t) => t.role === "user").slice(-3).map((t) => t.text).join("\n");
  const lib = await loadExampleLibrary(db).catch(() => []);
  return examplesBlock(pickExamples(lib, users, req.channel === "wb_review" ? "wb_chat" : req.channel));
}

/** Правила владельца (`/ai_rule`) из строки настроек; кэш минута. */
let rulesCache = { at: 0, text: "" };
async function ownerRules(): Promise<string> {
  if (Date.now() - rulesCache.at < 60_000) return rulesCache.text;
  const row = await db.wbSyncCursor.findUnique({ where: { stream: SUPPORT_SETTINGS_STREAM } }).catch(() => null);
  const rules = ((row?.metadata ?? {}) as { rules?: unknown }).rules;
  const list = Array.isArray(rules) ? rules.filter((r): r is string => typeof r === "string" && r.trim().length > 0) : [];
  rulesCache = { at: Date.now(), text: rulesText(list) };
  return rulesCache.text;
}

function rulesText(list: string[]): string {
  return list.length ? `ПРАВИЛА ВЛАДЕЛЬЦА МАГАЗИНА (важнее базы знаний выше; соблюдай всегда):\n${list.map((r, i) => `${i + 1}. ${r}`).join("\n")}` : "";
}

const PaAiDecisionSchema = z.object({
  action: z.enum(["reply", "escalate", "ignore"]),
  category: z.enum(PA_AI_CATEGORIES),
  reply: z.string(),
  summary: z.string(),
  draft: z.string(),
  tone: z.enum(BUYER_TONES),
});

/** Потолок вызовов модели в сутки на канал — страховка счёта. */
const DAILY_CAP = 300;
const calls = new Map<SupportChannel, { day: string; n: number }>();

export function supportAiCallsToday(channel: SupportChannel): number {
  const c = calls.get(channel);
  return c && c.day === new Date().toISOString().slice(0, 10) ? c.n : 0;
}

let client: Anthropic | null = null;
const anthropic = () => (client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!.trim(), maxRetries: 1, timeout: 45_000 }));

/** Сообщения для модели: контекст первым, реплики поддержки помечены. */
export function buildSupportMessages(req: SupportAiRequest): Anthropic.MessageParam[] | null {
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: req.context },
    ...req.turns.map((t) => ({
      role: t.role,
      content: t.role === "assistant" ? `[поддержка] ${t.text}` : t.text,
    }) as Anthropic.MessageParam),
  ];
  if (messages.length < 2 || messages[messages.length - 1].role !== "user") return null;
  if (req.image) {
    const last = messages[messages.length - 1];
    last.content = [
      { type: "image", source: { type: "base64", media_type: req.image.mediaType, data: req.image.data } },
      { type: "text", text: typeof last.content === "string" ? last.content : "[скриншот]" },
    ];
  }
  return messages;
}

export async function decideSupportDirect(req: SupportAiRequest, opts: { rules?: string[]; exam?: boolean } = {}): Promise<SupportAiResult> {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) return null;
  // Экзамен учителя (`ai-teacher`) не расходует суточный потолок каналов.
  if (!opts.exam) {
  const day = new Date().toISOString().slice(0, 10);
  const c = calls.get(req.channel);
  const counter = c && c.day === day ? c : { day, n: 0 };
  if (counter.n >= DAILY_CAP) return null;
  counter.n++;
  calls.set(req.channel, counter);
  }
  const messages = buildSupportMessages(req);
  if (!messages) return null;
  const rules = opts.rules ? rulesText(opts.rules) : await ownerRules();
  const examples = await examplesFor(req);
  const system: Anthropic.TextBlockParam[] = [
    // Кэш на час (27.11.2026): вызовы идут раз в 10–30 мин, 5-минутный кэш
    // почти всегда истекал и база писалась заново по 1,25× цены.
    { type: "text", text: PA_AI_SYSTEM + TOOLS_NOTE, cache_control: { type: "ephemeral", ttl: "1h" } },
    { type: "text", text: CHANNEL_NOTES[req.channel] },
    ...(rules ? [{ type: "text" as const, text: rules }] : []),
    ...(examples ? [{ type: "text" as const, text: examples }] : []),
  ];
  // Ответ на отзыв видят все будущие покупатели — Sonnet (27.11.2026); чаты — Haiku.
  const model = req.channel === "wb_review" ? PA_AI_STRONG_MODEL : PA_AI_MODEL;
  try {
    let d = await runWithTools(model, system, messages, req, opts);
    // Второе мнение (28.11.2026): Haiku хочет звать человека — Sonnet смотрит
    // ту же переписку с теми же инструментами; ответит сам — берём его ответ.
    // Человек стоит дороже вызова Sonnet (~$0.01–0.03).
    if (d && d !== "out_of_money" && d.action === "escalate" && model === PA_AI_MODEL && !opts.exam) {
      const second = await runWithTools(PA_AI_STRONG_MODEL, system, messages, req, opts).catch(() => null);
      if (second && second !== "out_of_money" && second.action === "reply" && second.reply.trim()) {
        console.log(`[support-ai:${req.channel}] второе мнение Sonnet: ответил сам вместо передачи`);
        d = { ...second, summary: second.summary || d.summary };
      }
    }
    return d;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`[support-ai:${req.channel}] вызов не прошёл: ${msg.slice(0, 200)}`);
    if (/credit balance|billing|insufficient/i.test(msg)) return "out_of_money";
    return null;
  }
}

const TOOLS_NOTE = `

ИНСТРУМЕНТЫ (28.11.2026). Ты не только отвечаешь — ты ведёшь заказ до выкупа:
• покупатель назвал код WB или CODE-…, а в данных этого заказа нет — find_order, а не «позову человека»;
• прислал ссылку/ID пасса и заказ ждёт пасс — attach_gamepass (система сама проверит цену и ник и отправит в выкуп); пасс есть, но заказ не ясен — find_order / find_by_gamepass;
• «не получается пасс», «какой пасс прислать» — check_gamepass или search_passes_by_nick и скажи точно, что поправить;
• просит сменить ник — propose_nick_change (меняет админ по кнопке).
Результаты инструментов — факты: опирайся на них, не выдумывай. Звать человека — только когда инструменты не помогли или нужно решение (деньги, возврат, спор, заморозка).`;

/** Один ответ модели с циклом инструментов (до 4 кругов). */
async function runWithTools(
  model: string,
  system: Anthropic.TextBlockParam[],
  base: Anthropic.MessageParam[],
  req: SupportAiRequest,
  opts: { exam?: boolean },
): Promise<SupportAiResult> {
  const messages: Anthropic.MessageParam[] = [...base];
  const tools = req.channel === "wb_review" ? [] : SUPPORT_TOOLS;
  for (let round = 0; round < 5; round++) {
    const res = await anthropic().messages.parse({
      model,
      max_tokens: 2000,
      system,
      ...(tools.length ? { tools } : {}),
      messages,
      output_config: { effort: "low", format: zodOutputFormat(PaAiDecisionSchema) },
    });
    const u = res.usage;
    recordUsage(model, u.input_tokens, u.output_tokens, u.cache_read_input_tokens ?? 0, u.cache_creation_input_tokens ?? 0);
    console.log(`[support-ai:${req.channel}] ${model.includes("sonnet") ? "sonnet " : ""}токены: вход ${u.input_tokens} (+кэш ${u.cache_read_input_tokens ?? 0}/${u.cache_creation_input_tokens ?? 0}), выход ${u.output_tokens}`);
    if (res.stop_reason === "refusal") {
      return { action: "escalate", category: "other", reply: "", summary: "Модель отказалась отвечать — посмотрите сами.", draft: "" };
    }
    if (res.stop_reason !== "tool_use" || round === 4) return res.parsed_output ?? null;
    const calls = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    messages.push({ role: "assistant", content: res.content as Anthropic.ContentBlockParam[] });
    const results = await Promise.all(calls.map(async (c) => {
      const out = await runSupportTool(c.name, (c.input ?? {}) as Record<string, unknown>, { channel: req.channel, exam: opts.exam });
      console.log(`[support-ai:${req.channel}] 🔧 ${c.name}(${JSON.stringify(c.input).slice(0, 80)}) → ${out.slice(0, 100).replace(/\n/g, " ")}`);
      return { type: "tool_result" as const, tool_use_id: c.id, content: out };
    }));
    messages.push({ role: "user", content: results });
  }
  return null;
}
