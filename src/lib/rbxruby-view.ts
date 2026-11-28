import type { Tone } from "@/lib/order-presentation";
import type { FirstInLineOrder } from "@/types/first-in-line";

/** Метка RBXRUBY в строке заказа — одна для сайта и TWA (28.11.2026). */
export function rbxrubyBadge(r: FirstInLineOrder["rbxruby"]): { text: string; tone: Tone; title: string } | null {
  if (!r) return null;
  const tone: Tone = r.state === "done" ? "green"
    : r.state === "open" ? "blue"
    : r.state === "next" ? "accent"
    : r.state === "failed" ? "red"
    : r.state === "skipped" ? "orange"
    : "muted";
  const text = r.state === "skipped" ? `RBXRUBY · руками: ${r.why ?? ""}`.trim() : `RBXRUBY · ${r.label}`;
  return { text, tone, title: r.why ? `${r.label}: ${r.why}` : r.label };
}

export function fmtUsd(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? "—" : `$${v.toFixed(2)}`;
}

export const RBXRUBY_MODE_LABEL = { on: "ВКЛ · выкупает", dry: "ТЕСТ · не выкупает", off: "ПАУЗА" } as const;

/** Ответ GET /api/{admin,twa}/rbxruby — повторяет `RbxrubyOverview` без server-only импорта. */
export type RbxrubyOverviewView = {
  configured: boolean;
  mode: "on" | "dry" | "off";
  modeBy: string | null;
  envOff: boolean;
  maxRate: number;
  snapshotAt: string | null;
  balance: number | null;
  stockUsable: number;
  stockLines: Array<{ rate: number; robux: number }>;
  maxInstant: number;
  day: { completed: number; inFlight: number; failed: number; usd: number; robux: number };
  week: { completed: number; usd: number; robux: number; avgRate: number | null };
  next: string[];
  lastError: string | null;
  offers: Array<{ rate: number; robux: number; sellers: number | null; maxOne: number; usable: boolean }>;
  history: Array<{ at: string; usable: number; maxInstant: number }>;
  minUsefulPass: number;
};

/** Точки графика стока: x 0..1 по времени суток, y 0..1 от максимума. */
export function stockSpark(history: RbxrubyOverviewView["history"], w: number, h: number): string {
  if (history.length < 2) return "";
  const t0 = new Date(history[0].at).getTime();
  const t1 = new Date(history[history.length - 1].at).getTime() || t0 + 1;
  const max = Math.max(1, ...history.map((p) => p.usable));
  return history
    .map((p, i) => `${i ? "L" : "M"}${(((new Date(p.at).getTime() - t0) / Math.max(1, t1 - t0)) * w).toFixed(1)},${(h - (p.usable / max) * h).toFixed(1)}`)
    .join(" ");
}

export type RbxrubyOrderView = {
  state: { state: string; label: string; why?: string } | null;
  timeline: Array<{ at: string; text: string; tone: "ok" | "bad" | "muted" }>;
};

/** «[rush] 2LNBMZS 715R$ ~$2.717 @nick/123» → «2LNBMZS · 715 R$». */
export function nextLine(line: string): string {
  const m = line.match(/^\[[^\]]*\]\s*(\S+)\s+(\d+)R\$/);
  return m ? `${m[1]} · ${m[2]} R$` : line;
}
