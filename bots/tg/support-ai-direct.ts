/* ─────────────────────────────────────────────────────────────────────────────
   Вызов модели ИИ-поддержки (SDK Anthropic + zod). Грузится ТОЛЬКО там, где
   есть ANTHROPIC_API_KEY (TG-бот): в образе ВК-бота этих пакетов нет, поэтому
   `support-ai.ts` и мост подключают этот файл динамическим импортом.
   ───────────────────────────────────────────────────────────────────────── */

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { CHANNEL_NOTES, PA_AI_CATEGORIES, PA_AI_MODEL, PA_AI_STRONG_MODEL, PA_AI_SYSTEM, type SupportChannel } from "../shared/pa-ai-support";
import { SUPPORT_SETTINGS_STREAM, type SupportAiRequest, type SupportAiResult } from "../shared/support-ai";
import { db } from "../shared/db";
import { examplesBlock, loadExampleLibrary, pickExamples } from "../shared/support-ai-learn";

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
  rulesCache = {
    at: Date.now(),
    text: [
      list.length ? `ПРАВИЛА ВЛАДЕЛЬЦА МАГАЗИНА (важнее базы знаний выше; соблюдай всегда):\n${list.map((r, i) => `${i + 1}. ${r}`).join("\n")}` : "",
    ].filter(Boolean).join("\n\n"),
  };
  return rulesCache.text;
}

const PaAiDecisionSchema = z.object({
  action: z.enum(["reply", "escalate", "ignore"]),
  category: z.enum(PA_AI_CATEGORIES),
  reply: z.string(),
  summary: z.string(),
  draft: z.string(),
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

export async function decideSupportDirect(req: SupportAiRequest): Promise<SupportAiResult> {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) return null;
  const day = new Date().toISOString().slice(0, 10);
  const c = calls.get(req.channel);
  const counter = c && c.day === day ? c : { day, n: 0 };
  if (counter.n >= DAILY_CAP) return null;
  counter.n++;
  calls.set(req.channel, counter);
  const messages = buildSupportMessages(req);
  if (!messages) return null;
  const rules = await ownerRules();
  const examples = await examplesFor(req);
  try {
    const res = await anthropic().messages.parse({
      // Ответ на отзыв видят все будущие покупатели — Sonnet (27.11.2026); чаты — Haiku.
      model: req.channel === "wb_review" ? PA_AI_STRONG_MODEL : PA_AI_MODEL,
      max_tokens: 2000,
      // Общая база кэшируется одна на все каналы; поправка канала — вторым блоком.
      system: [
        // Кэш на час (27.11.2026): вызовы идут раз в 10–30 мин, 5-минутный кэш
        // почти всегда истекал и база писалась заново по 1,25× цены.
        { type: "text", text: PA_AI_SYSTEM, cache_control: { type: "ephemeral", ttl: "1h" } },
        { type: "text", text: CHANNEL_NOTES[req.channel] },
        ...(rules ? [{ type: "text" as const, text: rules }] : []),
        ...(examples ? [{ type: "text" as const, text: examples }] : []),
      ],
      messages,
      output_config: { effort: "low", format: zodOutputFormat(PaAiDecisionSchema) },
    });
    const u = res.usage;
    console.log(`[support-ai:${req.channel}] токены: вход ${u.input_tokens} (+кэш ${u.cache_read_input_tokens ?? 0}/${u.cache_creation_input_tokens ?? 0}), выход ${u.output_tokens}`);
    if (res.stop_reason === "refusal") {
      return { action: "escalate", category: "other", reply: "", summary: "Модель отказалась отвечать — посмотрите сами.", draft: "" };
    }
    return res.parsed_output ?? null;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`[support-ai:${req.channel}] вызов не прошёл: ${msg.slice(0, 200)}`);
    if (/credit balance|billing|insufficient/i.test(msg)) return "out_of_money";
    return null;
  }
}
