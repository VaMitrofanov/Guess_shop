/* Расход токенов ИИ по дням и моделям (28.11.2026). Раньше токены писались
   только в лог контейнера и пропадали с каждым деплоем — расход было не посчитать.
   Копим в памяти, раз в минуту сливаем в `WbSyncCursor(ai-usage)`. */

import { db } from "../shared/db";

const STREAM = "ai-usage";
const MSK = 3 * 3_600_000;

/** $ за 1M токенов: вход / выход (ноябрь 2026). Кэш: чтение 0.1×, запись на час 2× входа. */
export const PRICES: Record<string, { in: number; out: number }> = {
  "claude-haiku-5-5": { in: 0.1, out: 0.5 },
  "claude-sonnet-5-5": { in: 2, out: 10 },
  "claude-opus-5-5": { in: 4, out: 20 },
};

type Bucket = { calls: number; in: number; out: number; cr: number; cw: number };
type Days = Record<string, Record<string, Bucket>>;

let pending: Days = {};
let timer: NodeJS.Timeout | null = null;

const mskDay = (t = Date.now()) => new Date(t + MSK).toISOString().slice(0, 10);

export function recordUsage(model: string, input: number, output: number, cacheRead: number, cacheWrite: number): void {
  const day = mskDay();
  const b = ((pending[day] ??= {})[model] ??= { calls: 0, in: 0, out: 0, cr: 0, cw: 0 });
  b.calls++; b.in += input; b.out += output; b.cr += cacheRead; b.cw += cacheWrite;
  timer ??= setTimeout(() => { timer = null; void flush(); }, 60_000);
}

async function flush(): Promise<void> {
  const add = pending;
  pending = {};
  try {
    const row = await db.wbSyncCursor.findUnique({ where: { stream: STREAM } });
    const days = ((row?.metadata ?? {}) as { days?: Days }).days ?? {};
    for (const [day, models] of Object.entries(add)) {
      for (const [m, b] of Object.entries(models)) {
        const cur = ((days[day] ??= {})[m] ??= { calls: 0, in: 0, out: 0, cr: 0, cw: 0 });
        cur.calls += b.calls; cur.in += b.in; cur.out += b.out; cur.cr += b.cr; cur.cw += b.cw;
      }
    }
    const keep = Object.keys(days).sort().slice(-90);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const metadata = { days: Object.fromEntries(keep.map((d) => [d, days[d]])) } as any;
    await db.wbSyncCursor.upsert({ where: { stream: STREAM }, create: { stream: STREAM, metadata }, update: { metadata } });
  } catch (e) {
    console.warn("[ai-usage] не записал:", e instanceof Error ? e.message : e);
  }
}

export function bucketCost(model: string, b: Bucket): number {
  const p = PRICES[model] ?? { in: 4, out: 20 };
  return (b.in * p.in + b.out * p.out + b.cr * p.in * 0.1 + b.cw * p.in * 2) / 1_000_000;
}

/** «ИИ вчера: $0.42 (Haiku 31 · $0.05, Sonnet 6 · $0.12, Opus 1 · $0.25)». */
export async function usageLine(day: string): Promise<string> {
  const row = await db.wbSyncCursor.findUnique({ where: { stream: STREAM } }).catch(() => null);
  const models = (((row?.metadata ?? {}) as { days?: Days }).days ?? {})[day];
  if (!models) return "";
  const parts = Object.entries(models).map(([m, b]) => ({ name: m.replace("claude-", "").replace(/-\d.*$/, ""), calls: b.calls, cost: bucketCost(m, b) }));
  const total = parts.reduce((s, p) => s + p.cost, 0);
  return `💵 ИИ за сутки: $${total.toFixed(2)} (${parts.map((p) => `${p.name} ${p.calls} · $${p.cost.toFixed(2)}`).join(", ")})`;
}
