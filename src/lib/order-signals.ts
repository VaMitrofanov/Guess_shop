/**
 * Сигналы заказа (11.11.2026) — заморозка, пометки и «разморожен вручную»
 * одним списком.
 *
 * Раньше каждое состояние рисовалось своей плашкой в своём месте карточки, и
 * они читались как посторонние вставки, а не как часть заказа. Здесь одно
 * правило: что показать, каким тоном, с какой подписью и какой кнопкой. TWA и
 * сайт рисуют его по-своему, но СОСТАВ и ПОРЯДОК одни (как `order-presentation`).
 */

import { FLAG_META, flagLabel, flagsOf, type OrderFlagKind } from "../../bots/shared/order-flags";
import type { Tone } from "./order-presentation";

export type SignalState = "block" | "attention" | "info" | "resolved";

export interface OrderSignal {
  id: string;
  state: SignalState;
  tone: Tone;
  icon: string;
  /** Короткая подпись — чип в ленте. */
  chip: string;
  /** Заголовок строки в карточке. */
  title: string;
  /** Что сказал покупатель / почему. */
  detail?: string | null;
  /** «кто · когда». */
  meta?: string | null;
  action?: { kind: "unhold" } | { kind: "ack"; flag: OrderFlagKind };
  actionLabel?: string;
}

export interface SignalOrder {
  heldAt?: string | Date | null;
  heldReason?: string | null;
  heldBy?: string | null;
  manualReleaseAt?: string | Date | null;
  manualReleaseBy?: string | null;
  flags?: unknown;
  createdAt?: string | Date | null;
}

function ago(at: string | Date | null | undefined, now: number): string {
  if (!at) return "";
  const min = Math.max(0, Math.round((now - new Date(at).getTime()) / 60_000));
  if (min < 60) return `${min} мин назад`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} ч назад`;
  const d = Math.floor(h / 24);
  return h % 24 === 0 || d >= 3 ? `${d} д назад` : `${d} д ${h % 24} ч назад`;
}

const meta = (who: string | null | undefined, at: string | Date | null | undefined, now: number) =>
  [who, ago(at, now)].filter(Boolean).join(" · ") || null;

/**
 * Порядок — по срочности: блок → требует решения → справка → решённое.
 * Решённые пометки остаются: «договорились · Demid» — часть истории заказа.
 */
export function orderSignals(order: SignalOrder, now = Date.now()): OrderSignal[] {
  const out: OrderSignal[] = [];
  if (order.heldAt) {
    out.push({
      id: "hold", state: "block", tone: "ice", icon: "❄️",
      chip: "❄️ заморожен",
      title: "Заморожен — не выкупать",
      detail: order.heldReason ?? "причина не указана",
      meta: meta(order.heldBy, order.heldAt, now),
      action: { kind: "unhold" }, actionLabel: "Разморозить",
    });
  }
  const flags = flagsOf(order);
  for (const f of flags.filter((x) => !x.ackAt)) {
    const m = FLAG_META[f.kind];
    out.push({
      id: `flag:${f.kind}`, state: "attention", tone: m.tone, icon: m.icon,
      chip: flagLabel(f, order, now),
      title: flagLabel(f, order, now).replace(/^\S+\s/, ""),
      detail: f.detail ?? (f.kind === "STALE" ? "уточнить у покупателя, актуален ли заказ" : null),
      meta: ago(f.at, now) || null,
      action: { kind: "ack", flag: f.kind }, actionLabel: "✓ Договорились",
    });
  }
  if (!order.heldAt && order.manualReleaseAt) {
    out.push({
      id: "manual", state: "info", tone: "green", icon: "🛡",
      chip: "🛡 вручную",
      title: "Разморожен вручную",
      detail: "автоматика не морозит, кроме нового плохого отзыва и возврата денег",
      meta: meta(order.manualReleaseBy, order.manualReleaseAt, now),
    });
  }
  for (const f of flags.filter((x) => x.ackAt)) {
    const m = FLAG_META[f.kind];
    out.push({
      id: `done:${f.kind}`, state: "resolved", tone: "muted", icon: m.icon,
      chip: `${m.icon} ✓`,
      title: `${m.label} — договорились`,
      detail: f.detail ?? null,
      meta: meta(f.ackBy, f.ackAt, now),
    });
  }
  return out;
}

/** Только то, что стоит показать в ленте: блок и нерешённое. */
export function signalChips(order: SignalOrder, now = Date.now()): OrderSignal[] {
  return orderSignals(order, now).filter((s) => s.state === "block" || s.state === "attention");
}

export { flagsConfirmText, openFlags } from "../../bots/shared/order-flags";
