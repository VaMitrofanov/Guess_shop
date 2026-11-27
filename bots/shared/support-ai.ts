/* ─────────────────────────────────────────────────────────────────────────────
   Ядро ИИ-поддержки для всех каналов (13.11.2026): @RobloxBank_PA, диалог
   сообщества ВК, чат заказа WB.

   Anthropic отвечает 403 из РФ и из HK, поэтому ключ живёт только на хосте,
   откуда API доступен (TG-бот). Процесс без ключа (ВК-бот в РФ) спрашивает
   решение у моста `POST /support-ai` — так же, как Roblox и Telegram.

   Модуль без зависимостей (его тянет ВК-бот: в его образе нет zod и SDK
   Anthropic). Сам вызов модели — `support-ai-direct.ts`, динамическим импортом.

   Режим каналов ВК и WB — в строке настроек @RobloxBank_PA (`WbSyncCursor`
   stream `pa-support`, `metadata.channels`): off (по умолчанию) · dry
   (только карточка «бот ответил бы») · on. Меняется командой
   `/support_mode vk|wb on|dry|off` в беседе админов, без деплоя.
   ───────────────────────────────────────────────────────────────────────── */

import { asPaAiDecision, type PaAiDecision, type SupportChannel } from "./pa-ai-support";

export type SupportAiMode = "on" | "dry" | "off";
export type SupportTurn = { role: "user" | "assistant"; text: string };
export type SupportImage = { data: string; mediaType: "image/jpeg" | "image/png" | "image/webp" };
export interface SupportAiRequest {
  channel: SupportChannel;
  /** Данные покупателя (`customerContext`). */
  context: string;
  /** Последние реплики чата, последняя — покупателя. */
  turns: SupportTurn[];
  image?: SupportImage;
}
export type SupportAiResult = PaAiDecision | "out_of_money" | null;

const DIRECT_MODULE = "../tg/support-ai-direct";

export function hasDirectSupportAi(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.ANTHROPIC_API_KEY?.trim());
}

/** Решение: сам, если есть ключ, иначе через мост. Любой сбой — `null`. */
export async function decideSupport(req: SupportAiRequest): Promise<SupportAiResult> {
  if (hasDirectSupportAi()) {
    // Путь — в переменной: иначе tsc и сборщик сайта (этот модуль доходит до
    // Web через wb-delivery-sync → wb-chat-ai) потянули бы SDK Anthropic,
    // а он есть только в образе TG-бота. Ключ тоже только там.
    const direct = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ DIRECT_MODULE)) as {
      decideSupportDirect: (r: SupportAiRequest) => Promise<SupportAiResult>;
    };
    return direct.decideSupportDirect(req);
  }
  const bridgeUrl = process.env.VALIDATOR_SOURCE_URL?.trim();
  if (!bridgeUrl) return null;
  const key = process.env.VALIDATOR_KEY?.trim();
  try {
    const res = await fetch(`${bridgeUrl}/support-ai`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(key ? { "x-validator-key": key } : {}) },
      body: JSON.stringify(req),
      signal: AbortSignal.timeout(60_000),
    });
    const body = await res.json().catch(() => null) as { ok?: boolean; result?: unknown } | null;
    if (!res.ok || !body?.ok) return null;
    if (body.result === "out_of_money") return "out_of_money";
    return asPaAiDecision(body.result);
  } catch (err) {
    console.warn(`[support-ai:${req.channel}] мост не ответил:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/** Разбор тела запроса моста: всё, что пришло извне, — проверить. */
export function parseSupportAiRequest(raw: unknown): SupportAiRequest | null {
  const r = raw as Partial<SupportAiRequest> | null;
  if (!r || typeof r.context !== "string" || !Array.isArray(r.turns)) return null;
  if (r.channel !== "tg_pa" && r.channel !== "tg_bot" && r.channel !== "vk_bot" && r.channel !== "wb_chat") return null;
  const turns = r.turns
    .filter((t): t is SupportTurn => !!t && (t.role === "user" || t.role === "assistant") && typeof t.text === "string")
    .slice(-12)
    .map((t) => ({ role: t.role, text: t.text.slice(0, 1500) }));
  const image = r.image && typeof r.image.data === "string" && r.image.data.length < 6_500_000
    && ["image/jpeg", "image/png", "image/webp"].includes(r.image.mediaType)
    ? { data: r.image.data, mediaType: r.image.mediaType } : undefined;
  return { channel: r.channel, context: r.context.slice(0, 6000), turns, image };
}

// ── Режимы каналов ──────────────────────────────────────────────────────────

export const SUPPORT_SETTINGS_STREAM = "pa-support";
export type SupportChannelKey = Exclude<SupportChannel, "tg_pa" | "wb_review">;
let cache: { at: number; channels: Partial<Record<SupportChannelKey, SupportAiMode>> } = { at: 0, channels: {} };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

/** Режим канала бота TG/ВК/WB. Нет ни ключа, ни моста — всегда off. */
export async function supportChannelMode(db: Db, channel: SupportChannelKey): Promise<SupportAiMode> {
  if (!hasDirectSupportAi() && !process.env.VALIDATOR_SOURCE_URL?.trim()) return "off";
  if (Date.now() - cache.at > 60_000) {
    const row = await db.wbSyncCursor.findUnique({ where: { stream: SUPPORT_SETTINGS_STREAM } }).catch(() => null);
    const meta = (row?.metadata ?? {}) as { channels?: Partial<Record<SupportChannelKey, SupportAiMode>> };
    cache = { at: Date.now(), channels: meta.channels ?? {} };
  }
  const m = cache.channels[channel];
  return m === "on" || m === "dry" ? m : "off";
}

export function resetSupportModeCache(): void {
  cache = { at: 0, channels: {} };
}

/** Куда слать карточки ИИ: беседа админов и её темы (настраивает TG-бот). */
export async function supportCardTarget(db: Db): Promise<{ chatId: number | null; topics: Record<string, number> }> {
  const row = await db.wbSyncCursor.findUnique({ where: { stream: SUPPORT_SETTINGS_STREAM } }).catch(() => null);
  const meta = (row?.metadata ?? {}) as { topics?: Record<string, number> };
  return { chatId: row?.cursor ? Number(row.cursor) : null, topics: meta.topics ?? {} };
}

/**
 * Текст «разговорный» — его стоит отдать модели, а не автомату ботов: вопрос
 * или фраза из нескольких слов. Ник, ссылка, код, сумма, email сюда не попадают.
 */
export function isConversationalText(text: string): boolean {
  const t = text.trim();
  if (t.length < 6 || t.length > 1500) return false;
  if (/https?:\/\/|roblox\.com|\S+@\S+\.\S+/i.test(t)) return false;
  const words = t.split(/\s+/).filter((w) => /\p{L}/u.test(w));
  return words.length >= 3 || (/\?\s*$/.test(t) && /\p{L}{3}/u.test(t));
}

/**
 * ⏳ Склейка подряд идущих сообщений (27.11.2026): покупатель пишет
 * «здравствуйте» / «у меня проблема» / «робуксы не пришли» тремя сообщениями —
 * отвечаем один раз, на всё сразу. Запускается последний вызов за `ms`.
 * Не ждёт внутри обработчика бота: иначе стоял бы весь поток апдейтов.
 */
export const AI_DEBOUNCE_MS = 15_000;
export class Debouncer {
  private seq = new Map<string, number>();
  schedule(key: string, ms: number, fn: () => Promise<void>): void {
    const v = (this.seq.get(key) ?? 0) + 1;
    this.seq.set(key, v);
    setTimeout(() => {
      if (this.seq.get(key) !== v) return;
      this.seq.delete(key);
      void fn().catch((e) => console.warn("[support-ai] отложенный ответ упал:", e instanceof Error ? e.message : e));
    }, ms);
  }
}

/** Все сообщения покупателя после последнего ответа поддержки — одним текстом. */
export function trailingUserText(turns: SupportTurn[]): string {
  const out: string[] = [];
  for (let i = turns.length - 1; i >= 0 && turns[i].role === "user"; i--) out.unshift(turns[i].text);
  return out.join("\n");
}

/** Реплики чата в памяти процесса (ВК): последние 12 на собеседника. */
export class TurnMemory {
  private map = new Map<string, Array<SupportTurn & { at: number }>>();
  constructor(private readonly size = 12, private readonly ttlMs = 6 * 3600_000) {}
  push(key: string, role: SupportTurn["role"], text: string): void {
    if (!text.trim()) return;
    const now = Date.now();
    const list = (this.map.get(key) ?? []).filter((t) => now - t.at < this.ttlMs);
    list.push({ role, text: text.slice(0, 1500), at: now });
    while (list.length > this.size) list.shift();
    this.map.set(key, list);
    if (this.map.size > 3000) this.map.delete(this.map.keys().next().value as string);
  }
  /** Пусто после рестарта — поднять из журнала (`recallTurns`). */
  seed(key: string, turns: Array<SupportTurn & { at: number }>): void {
    if (this.map.has(key) || turns.length === 0) return;
    this.map.set(key, turns.slice(-this.size));
  }
  has(key: string): boolean {
    return this.map.has(key);
  }
  get(key: string): SupportTurn[] {
    const now = Date.now();
    return (this.map.get(key) ?? []).filter((t) => now - t.at < this.ttlMs).map(({ role, text }) => ({ role, text }));
  }
}

/** 📷 Картинка по ссылке → для модели (ВК/TG-файл). Больше 3,5 МБ или не картинка — `undefined`. */
export async function fetchSupportImage(url: string): Promise<SupportImage | undefined> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return undefined;
    const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const mediaType = (["image/jpeg", "image/png", "image/webp"].includes(type) ? type : /\.png(\?|$)/i.test(url) ? "image/png" : "image/jpeg") as SupportImage["mediaType"];
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > 3_500_000) return undefined;
    return { data: buf.toString("base64"), mediaType };
  } catch {
    return undefined;
  }
}

/** Подпись к фото, у которой свой путь (бонус за отзыв, оплата) — ИИ не трогает. */
export const SCREENSHOT_OWN_FLOW_RE = /отзыв|оплат|оплачен|чек|перевод|квитанц/i;
