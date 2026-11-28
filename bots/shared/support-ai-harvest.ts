/* ─────────────────────────────────────────────────────────────────────────────
   🌾 Сбор ответов операторов из переписки всех каналов (28.11.2026).

   Владелец: «используй все ответы (в том числе и вк и тг) для обучения
   воркера». Здесь — общее правило «что считать парой вопрос → ответ» и
   сборщики для чатов WB и выгрузки @RobloxBank_PA. ВК собирается в ВК-боте
   (`bots/vk/vk-ai-learn.ts`) — только у него есть токен сообщества.

   Пара: подряд идущие сообщения покупателя (не старше суток до ответа) →
   ответ ЖИВОГО оператора (несколько его сообщений подряд склеиваются).
   Реплика бота или ИИ между ними обрывает вопрос: на него ответила машина.
   ───────────────────────────────────────────────────────────────────────── */

import { isAutoSellerText } from "./wb-chat-ai";
import { recordOperatorExamples, type OperatorExample } from "./support-ai-learn";
import { pairsFromTranscript, type TranscriptMsg } from "./support-ai-pairs";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export { pairsFromTranscript, type TranscriptMsg } from "./support-ai-pairs";

/* ── Чаты WB ─────────────────────────────────────────────────────────────── */

const norm = (t: string) => t.replace(/\s+/g, " ").trim().slice(0, 60).toLowerCase();

interface WbEv { chatId: string; wbEventId: string; sender: string; textRedacted: string | null; sentAt: Date; attachmentsMeta: unknown }

/**
 * Реплики продавца — от живого человека? Ответ из TG (локальная запись
 * `via: tg-reply`) — да. Из кабинета — если это не ответ ИИ, не автотекст,
 * не эхо того, что бот сам записал локально, и не шаблон, разосланный
 * пятью и больше одинаковыми копиями (рассылки бота с суммой в тексте).
 */
export function wbTranscripts(events: WbEv[], aiAnswers: string[]): Map<string, TranscriptMsg[]> {
  const bot = new Set(aiAnswers.filter(Boolean).map(norm));
  const freq = new Map<string, number>();
  for (const e of events) {
    if (e.sender === "client" || !e.textRedacted) continue;
    const via = (e.attachmentsMeta as { via?: unknown } | null)?.via;
    if (e.wbEventId.startsWith("local:") && via !== "tg-reply") bot.add(norm(e.textRedacted));
    freq.set(norm(e.textRedacted), (freq.get(norm(e.textRedacted)) ?? 0) + 1);
  }
  const tgEcho = new Set<string>();
  const chats = new Map<string, TranscriptMsg[]>();
  for (const e of events) {
    const text = (e.textRedacted ?? "").trim();
    if (!text) continue;
    const list = chats.get(e.chatId) ?? [];
    chats.set(e.chatId, list);
    if (e.sender === "client") { list.push({ side: "C", text, at: new Date(e.sentAt) }); continue; }
    const local = e.wbEventId.startsWith("local:");
    const via = (e.attachmentsMeta as { via?: unknown } | null)?.via;
    const k = norm(text);
    let side: TranscriptMsg["side"];
    if (local) side = via === "tg-reply" ? "O" : "X";
    else side = isAutoSellerText(text) || bot.has(k) || (freq.get(k) ?? 0) >= 5 || /^Чат с покупателем по товару/.test(text) ? "X" : "O";
    // Ответ из TG приходит дважды: локальная запись и эхо из WB — берём один.
    const echoKey = `${e.chatId}:${k}`;
    if (side === "O") { if (tgEcho.has(echoKey)) continue; tgEcho.add(echoKey); }
    list.push({ side, text, at: new Date(e.sentAt) });
  }
  return chats;
}

/** Собрать пары из чатов WB за период. */
export async function harvestWbChats(db: Db, since: Date): Promise<{ pairs: number; added: number }> {
  const events: WbEv[] = await db.wbBuyerChatEvent.findMany({
    where: { sentAt: { gte: since } },
    select: { chatId: true, wbEventId: true, sender: true, textRedacted: true, sentAt: true, attachmentsMeta: true },
    orderBy: { sentAt: "asc" },
  });
  // Частота шаблонов — по всему месяцу, иначе в коротком окне рассылка бота выглядит «человеком».
  const tplSince = new Date(Math.min(since.getTime(), Date.now() - 30 * 86_400_000));
  const tpl: WbEv[] = since.getTime() > tplSince.getTime()
    ? await db.wbBuyerChatEvent.findMany({
        where: { sentAt: { gte: tplSince, lt: since }, sender: { not: "client" } },
        select: { chatId: true, wbEventId: true, sender: true, textRedacted: true, sentAt: true, attachmentsMeta: true },
      })
    : [];
  const ai: Array<{ answer: string | null; summary: string | null }> = await db.aiSupportLog.findMany({
    where: { channel: { in: ["wb_chat", "wb_review"] } }, select: { answer: true, summary: true },
  });
  const chats = wbTranscripts([...tpl.map((e) => ({ ...e, chatId: `tpl:${e.chatId}` })), ...events], ai.map((r) => r.answer ?? ""));
  const pairs = [...chats.entries()].filter(([id]) => !id.startsWith("tpl:"))
    .flatMap(([, msgs]) => pairsFromTranscript(msgs, "wb_chat", "оператор WB"));
  return { pairs: pairs.length, added: await recordOperatorExamples(db, pairs) };
}

/* ── Выгрузка @RobloxBank_PA (`pa-export-file`: s = C покупатель, O оператор, B бот) ── */

export function paExportPairs(jsonl: string): Array<Omit<OperatorExample, "at"> & { at: string }> {
  const out: Array<Omit<OperatorExample, "at"> & { at: string }> = [];
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    try {
      const chat = JSON.parse(line) as { msgs?: Array<{ t: string; s: string; x?: string }> };
      const msgs: TranscriptMsg[] = (chat.msgs ?? []).map((m) => ({
        side: m.s === "C" ? "C" : m.s === "O" ? "O" : "X",
        text: m.x ?? "",
        at: new Date(`${m.t}:00Z`),
      }));
      out.push(...pairsFromTranscript(msgs, "tg_pa", "оператор PA"));
    } catch { /* битая строка — пропускаем */ }
  }
  return out;
}

export async function harvestPaExport(db: Db): Promise<{ pairs: number; added: number }> {
  const row = await db.wbSyncCursor.findUnique({ where: { stream: "pa-export-file" } }).catch(() => null);
  const gz = ((row?.metadata ?? {}) as { gzBase64?: string }).gzBase64;
  if (!gz) return { pairs: 0, added: 0 };
  const { gunzipSync } = await import("node:zlib");
  const pairs = paExportPairs(gunzipSync(Buffer.from(gz, "base64")).toString("utf8"));
  return { pairs: pairs.length, added: await recordOperatorExamples(db, pairs) };
}

/* ── Проход по расписанию (TG-бот) ──────────────────────────────────────── */

const CURSOR = "ai-examples-harvest";

/**
 * Первый запуск — вся история WB (с мая) и выгрузка PA; дальше раз в 30 мин
 * WB за последние 2 суток (ответ мог прийти позже вопроса) и PA после новой выгрузки.
 */
export async function runSupportHarvest(db: Db): Promise<string | null> {
  const row = await db.wbSyncCursor.findUnique({ where: { stream: CURSOR } }).catch(() => null);
  const meta = (row?.metadata ?? {}) as { backfilled?: boolean; paCopy?: string };
  const wbSince = meta.backfilled ? new Date(Date.now() - 2 * 86_400_000) : new Date("2026-01-01T00:00:00Z");
  const wb = await harvestWbChats(db, wbSince);
  const paRow = await db.wbSyncCursor.findUnique({ where: { stream: "pa-export-file" }, select: { cursor: true } }).catch(() => null);
  const pa = paRow?.cursor && paRow.cursor !== meta.paCopy ? await harvestPaExport(db) : { pairs: 0, added: 0 };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const next = { backfilled: true, paCopy: paRow?.cursor ?? meta.paCopy ?? null } as any;
  await db.wbSyncCursor.upsert({
    where: { stream: CURSOR },
    create: { stream: CURSOR, metadata: next, lastSuccessAt: new Date() },
    update: { metadata: next, lastSuccessAt: new Date() },
  });
  if (!wb.added && !pa.added && meta.backfilled) return null;
  return `WB пар ${wb.pairs} (+${wb.added}), PA пар ${pa.pairs} (+${pa.added})${meta.backfilled ? "" : " — первичная загрузка истории"}`;
}
