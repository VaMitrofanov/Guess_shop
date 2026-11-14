/* ─────────────────────────────────────────────────────────────────────────────
   🔑 Исходы ключа Roblox — счётчик по причинам (15.11.2026).

   Владелец: «нужен ключ, рабочий на 100 %: единственная причина отказа —
   отсутствие плейса». Проверить это было нечем: успешные ключи лежат в
   `RobloxApiKey`, а отказы не писались нигде, и логи контейнера живут до
   следующего деплоя. Теперь каждый исход создания пасса по ключу (бот TG, ВК,
   сайт, админ) копится по дням в `WbSyncCursor` stream `key-outcomes`:
   `{ days: { "2026-11-15": { ok: 3, bad_scope: 1 } }, recent: [...] }`.
   Админ смотрит командой `/key_stats` в боте.

   Сам ключ сюда не попадает никогда — только код исхода, канал и ник.
   ───────────────────────────────────────────────────────────────────────── */

export const KEY_OUTCOMES_STREAM = "key-outcomes";
const KEEP_DAYS = 60;
const KEEP_RECENT = 80;

export type KeyOutcomeVia = "tg-bot" | "vk-bot" | "site" | "admin";

export interface KeyOutcomesState {
  days: Record<string, Record<string, number>>;
  recent: { at: string; via: KeyOutcomeVia; result: string; nick: string | null }[];
}

type CursorClient = {
  wbSyncCursor: {
    findUnique(args: { where: { stream: string } }): Promise<{ metadata: unknown } | null>;
    upsert(args: { where: { stream: string }; create: { stream: string; metadata: never }; update: { metadata: never } }): Promise<unknown>;
  };
};

/** Московская дата `YYYY-MM-DD`. */
export function mskDay(now = new Date()): string {
  return new Date(now.getTime() + 3 * 3_600_000).toISOString().slice(0, 10);
}

export function applyKeyOutcome(state: KeyOutcomesState | null | undefined, entry: { via: KeyOutcomeVia; result: string; nick?: string | null }, now = new Date()): KeyOutcomesState {
  const days = { ...(state?.days ?? {}) };
  const day = mskDay(now);
  const bucket = { ...(days[day] ?? {}) };
  bucket[entry.result] = (bucket[entry.result] ?? 0) + 1;
  days[day] = bucket;
  const keep = Object.keys(days).sort().slice(-KEEP_DAYS);
  const trimmed: KeyOutcomesState["days"] = {};
  for (const key of keep) trimmed[key] = days[key];
  const recent = [{ at: now.toISOString(), via: entry.via, result: entry.result, nick: entry.nick ?? null }, ...(state?.recent ?? [])].slice(0, KEEP_RECENT);
  return { days: trimmed, recent };
}

/** Записать исход. Никогда не бросает: учёт не должен ломать выдачу пасса. */
export async function recordKeyOutcome(db: CursorClient, entry: { via: KeyOutcomeVia; result: string; nick?: string | null }): Promise<void> {
  try {
    const row = await db.wbSyncCursor.findUnique({ where: { stream: KEY_OUTCOMES_STREAM } });
    const next = applyKeyOutcome((row?.metadata ?? null) as KeyOutcomesState | null, entry);
    await db.wbSyncCursor.upsert({
      where: { stream: KEY_OUTCOMES_STREAM },
      create: { stream: KEY_OUTCOMES_STREAM, metadata: next as never },
      update: { metadata: next as never },
    });
  } catch (error) {
    console.warn("[key-outcomes] не записано:", error instanceof Error ? error.message : error);
  }
}

/** Сводка за N дней: всего, успехов, отказы по причинам (по убыванию). */
export function summarizeKeyOutcomes(state: KeyOutcomesState | null | undefined, days = 7, now = new Date()): { total: number; ok: number; failures: [string, number][] } {
  const from = mskDay(new Date(now.getTime() - (days - 1) * 86_400_000));
  const sums: Record<string, number> = {};
  for (const [day, bucket] of Object.entries(state?.days ?? {})) {
    if (day < from) continue;
    for (const [result, n] of Object.entries(bucket)) sums[result] = (sums[result] ?? 0) + n;
  }
  const total = Object.values(sums).reduce((a, b) => a + b, 0);
  const ok = sums.ok ?? 0;
  const failures = Object.entries(sums).filter(([result]) => result !== "ok").sort((a, b) => b[1] - a[1]);
  return { total, ok, failures };
}

/* Синк для движка в ботах: `gamepass-autocreate.ts` общий с сайтом и не знает
   про базу ботов — бот подключает запись при старте (`setKeyOutcomeSink`). */
type Sink = (entry: { result: string; nick: string | null }) => void;
let sink: Sink | null = null;
export function setKeyOutcomeSink(next: Sink | null): void {
  sink = next;
}
export function emitKeyOutcome(entry: { result: string; nick: string | null }): void {
  try { sink?.(entry); } catch { /* учёт не ломает выдачу */ }
}
