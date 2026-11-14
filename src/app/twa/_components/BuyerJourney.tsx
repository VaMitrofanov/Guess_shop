"use client";

/* ─────────────────────────────────────────────────────────────────────────────
   🧭 «Путь покупателя» в TWA (28.10.2026, макет «Карточка заказа v2», вариант Б).

   - `JourneyTrack` — полоса из пяти шагов на месте прежней полосы готовности.
     В ленте над ней строка «⏳ Ждём ключ · 2 ч», в шторке под отрезками имена.
   - `JourneyBlock` — раздел шторки: чего ждём, три последних касания,
     «Следующий шаг» и вход во «Всю историю».
   - `JourneyHistorySheet` — линия с точками (сутки / всё) + лента по шагам;
     точка и строка подсвечивают друг друга.

   Правило — общий `@/lib/buyer-journey`, здесь только краска.
   ───────────────────────────────────────────────────────────────────────── */

import { useEffect, useMemo, useState } from "react";
import BottomSheet from "./BottomSheet";
import { C, MONO } from "./theme";
import { haptic } from "./haptics";
import {
  buyerJourney,
  journeySinceText,
  type BuyerJourney,
  type JourneyEventRow,
  type JourneyItem,
  type JourneyLive,
  type JourneyNext,
  type JourneyOrder,
  type JourneyTone,
  type JourneyWho,
} from "@/lib/buyer-journey";

export const JOURNEY_TONE: Record<JourneyTone, string> = {
  wait: C.orange, us: C.blue, bad: C.red, done: C.green, muted: C.textTertiary,
};
const WHO_COLOR: Record<JourneyWho, string> = { buyer: C.green, us: C.blue, problem: C.orange };
const WHO_WORD: Record<JourneyWho, string> = { buyer: "он", us: "мы", problem: "бот" };

const fmtTime = (value: string) => {
  const d = new Date(value);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).replace(",", "");
};

/* ── Полоса ─────────────────────────────────────────────────────────────── */
export function JourneyTrack({ journey, labeled }: { journey: BuyerJourney; labeled?: boolean }) {
  const color = JOURNEY_TONE[journey.now.tone];
  const since = journeySinceText(journey);
  return (
    <span className={`twa-rd twa-jr${labeled ? " is-labeled" : ""}`}>
      {!labeled && (
        <span className="twa-jr-now" style={{ color }}>
          {journey.now.text}
          {since && journey.now.tone !== "done" && journey.now.tone !== "muted" && <small> · {since}</small>}
          {journey.now.detail && <small> · {journey.now.detail}</small>}
        </span>
      )}
      <span className="twa-rd-segs twa-jr-segs">
        {journey.steps.map(step => {
          const cls = step.state === "done" ? "is-done"
            : step.state === "bad" ? "is-bad"
              : step.state === "current" ? (journey.now.tone === "us" ? "is-now" : "is-wait")
                : "is-todo";
          const tint = step.state === "current" && journey.now.tone !== "us" ? color
            : step.state === "bad" ? C.red : undefined;
          return (
            <span key={step.key} className="twa-rd-step" style={labeled && tint ? { color: tint } : undefined}>
              <span className={`twa-rd-seg ${cls}`} style={tint ? { background: tint } : undefined} />
              {labeled && (
                <small className={cls}>{step.state === "done" ? "✓ " : ""}{step.label}</small>
              )}
            </span>
          );
        })}
      </span>
    </span>
  );
}

/* ── Раздел шторки ─────────────────────────────────────────────────────── */
export function JourneyBlock({ journey, onHistory, onNext, onOther }: {
  journey: BuyerJourney;
  onHistory: () => void;
  onNext: (next: JourneyNext) => void;
  /** «Другое ›» — полное меню «📨 Инструкция». */
  onOther?: () => void;
}) {
  const color = JOURNEY_TONE[journey.now.tone];
  const since = journeySinceText(journey);
  const bigTone = journey.now.tone !== "done" && journey.now.tone !== "muted";
  return (
    <div data-form="journey" style={{
      background: C.card, border: `1px solid ${C.hairline}`, borderRadius: 14, padding: 12,
      display: "flex", flexDirection: "column", gap: 10,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <b style={{ fontSize: 15 }}>🧭 Путь покупателя</b>
        <button type="button" className="twa-press-sm" onClick={() => { haptic.select(); onHistory(); }}
          style={{ border: "none", background: "transparent", color: C.accent, fontSize: 14, fontWeight: 600, padding: 4, fontFamily: "inherit" }}>
          Вся история ›
        </button>
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", padding: 10, borderRadius: 12, background: `${color}17` }}>
        {bigTone && since && (
          <div style={{ minWidth: 52, textAlign: "center", lineHeight: 1.05 }}>
            <div style={{ fontSize: 20, fontWeight: 800, color }}>{since}</div>
          </div>
        )}
        <div style={{ fontSize: 14.5, lineHeight: 1.35, minWidth: 0 }}>
          <b style={{ color }}>{journey.now.text}</b>
          {journey.now.detail && <span style={{ color: C.textSecondary }}> · {journey.now.detail}</span>}
        </div>
      </div>

      {journey.touches.length > 0 && (
        <div>
          {journey.touches.map((t, i) => <TouchRow key={`${t.at}-${i}`} item={t} first={i === 0} />)}
        </div>
      )}

      {journey.next && (
        <div style={{
          display: "flex", flexDirection: "column", gap: 4, borderRadius: 12, padding: 11,
          background: `${C.accent}17`, border: `1px solid ${C.accent}59`,
        }}>
          <span style={{ fontSize: 13, letterSpacing: ".06em", textTransform: "uppercase", color: C.textTertiary, fontWeight: 700 }}>Следующий шаг</span>
          <b style={{ fontSize: 15 }}>{journey.next.title}</b>
          <span style={{ fontSize: 14, color: C.textSecondary, lineHeight: 1.35 }}>{journey.next.reason}</span>
          <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
            <button type="button" className="twa-press-sm" onClick={() => { haptic.impact("light"); onNext(journey.next!); }}
              style={{ flex: 1, border: "none", borderRadius: 10, padding: "11px 8px", background: C.accent, color: "#120f1c", fontSize: 15, fontWeight: 700, fontFamily: "inherit" }}>
              {journey.next.kind === "nick-passes" ? "Проверить" : journey.next.kind === "contact" ? "Написать" : "Открыть"}
            </button>
            {onOther && (
              <button type="button" className="twa-press-sm" onClick={() => { haptic.select(); onOther(); }}
                style={{ border: "none", borderRadius: 10, padding: "11px 12px", background: C.elevated, color: C.textSecondary, fontSize: 14, fontWeight: 600, fontFamily: "inherit" }}>
                Другое ›
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function TouchRow({ item, first }: { item: JourneyItem; first: boolean }) {
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "30px 1fr auto", gap: 8, alignItems: "center",
      fontSize: 14, padding: "7px 0", borderTop: first ? "none" : `1px solid ${C.hairline}`,
    }}>
      <span style={{
        fontSize: 12, fontWeight: 700, textAlign: "center", borderRadius: 6, padding: "2px 0",
        background: `${WHO_COLOR[item.who]}26`, color: WHO_COLOR[item.who],
      }}>{WHO_WORD[item.who]}</span>
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {item.text}{item.sub ? <span style={{ color: C.textTertiary }}> · {item.sub}</span> : null}
      </span>
      <span style={{ fontFamily: MONO, fontSize: 13, color: C.textTertiary }}>{fmtTime(item.at)}</span>
    </div>
  );
}

/* ── «Вся история»: линия с точками + лента ───────────────────────────── */
export function JourneyHistorySheet({ open, onClose, order, live, token, initialEvents, title }: {
  open: boolean;
  onClose: () => void;
  order: JourneyOrder & { id: string };
  live?: JourneyLive | null;
  token: string;
  initialEvents: JourneyEventRow[];
  title: string;
}) {
  const [events, setEvents] = useState<JourneyEventRow[]>(initialEvents);
  const [zoom, setZoom] = useState<"day" | "all">("all");
  const [cur, setCur] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/twa/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ action: "buyer-journey", orderId: order.id }),
        });
        const d = await r.json();
        if (alive && r.ok && Array.isArray(d.events)) setEvents(d.events);
      } catch { /* останется то, что пришло с лентой */ }
    })();
    return () => { alive = false; };
  }, [open, order.id, token]);

  const journey = useMemo(() => buyerJourney(order, events, live), [order, events, live]);
  const history = journey.history;

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel="Вся история пути покупателя" className="twa-form-sheet">
      <div style={{ padding: "4px 16px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <b style={{ fontSize: 18 }}>🧭 {title}</b>
          <div role="group" aria-label="Масштаб" style={{ display: "flex", gap: 3, background: C.elevated, borderRadius: 9, padding: 3 }}>
            {(["day", "all"] as const).map(z => (
              <button key={z} type="button" aria-pressed={zoom === z} onClick={() => { haptic.select(); setZoom(z); }}
                style={{
                  border: "none", borderRadius: 7, padding: "5px 10px", fontSize: 13, fontWeight: 600, fontFamily: "inherit",
                  background: zoom === z ? "#2b2639" : "transparent", color: zoom === z ? C.textPrimary : C.textSecondary,
                }}>{z === "day" ? "Сутки" : "Всё"}</button>
            ))}
          </div>
        </div>
        <JourneyAxis items={history} zoom={zoom} cur={cur} onPick={setCur} />
        <JourneyList items={history} cur={cur} onPick={setCur} nowText={journey.now.text} nowTone={journey.now.tone} />
      </div>
    </BottomSheet>
  );
}

export function JourneyAxis({ items, zoom, cur, onPick }: {
  items: JourneyItem[];
  zoom: "day" | "all";
  cur: number | null;
  onPick: (index: number) => void;
}) {
  const nowMs = Date.now();
  const firstMs = items.length ? new Date(items[0].at).getTime() : nowMs - 3_600_000;
  const start = zoom === "day" ? nowMs - 24 * 3_600_000 : Math.min(firstMs, nowMs - 3_600_000);
  const span = Math.max(1, nowMs - start);
  const pos = (t: number) => Math.max(1.5, Math.min(97, ((t - start) / span) * 100));
  const ticks = zoom === "day"
    ? [[nowMs - 24 * 3_600_000, "−24 ч"], [nowMs - 12 * 3_600_000, "−12 ч"]] as const
    : [[start, fmtTime(new Date(start).toISOString())]] as const;
  return (
    <div style={{ position: "relative", height: 62, margin: "2px 10px 0" }} aria-label="Касания на шкале времени">
      <div style={{ position: "absolute", left: 0, right: 0, top: 22, height: 2, background: C.hairline }} />
      <div style={{ position: "absolute", right: -2, top: 6, height: 34, width: 2, background: C.orange }} />
      <span style={{ position: "absolute", right: 6, top: 0, fontSize: 11, fontWeight: 600, color: C.orange }}>сейчас</span>
      {items.map((item, i) => {
        const t = new Date(item.at).getTime();
        if (t < start) return null;
        return (
          <button key={`${item.at}-${i}`} type="button" aria-label={item.text} aria-pressed={cur === i}
            onClick={() => { haptic.select(); onPick(i); }}
            style={{
              position: "absolute", top: 14, left: `${pos(t)}%`, width: 18, height: 18, padding: 0,
              transform: `translateX(-50%)${cur === i ? " scale(1.2)" : ""}`, borderRadius: "50%",
              border: `3px solid ${C.bg}`, background: WHO_COLOR[item.who], cursor: "pointer",
              boxShadow: cur === i ? "0 0 0 3px rgba(255,255,255,.35)" : "none",
            }} />
        );
      })}
      {ticks.map(([t, label]) => (
        <span key={label} style={{ position: "absolute", top: 42, left: `${pos(t)}%`, transform: "translateX(-10%)", fontFamily: MONO, fontSize: 11.5, color: C.textTertiary, whiteSpace: "nowrap" }}>{label}</span>
      ))}
    </div>
  );
}

export function JourneyList({ items, cur, onPick, nowText, nowTone }: {
  items: JourneyItem[];
  cur: number | null;
  onPick: (index: number) => void;
  nowText: string;
  nowTone: JourneyTone;
}) {
  let group = "";
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {items.map((item, i) => {
        const head = item.group !== group ? item.group : null;
        group = item.group;
        return (
          <div key={`${item.at}-${i}`}>
            {head && <div style={{ fontSize: 12.5, letterSpacing: ".06em", textTransform: "uppercase", color: C.textTertiary, fontWeight: 700, padding: "8px 0 3px 28px" }}>{head}</div>}
            <button type="button" aria-current={cur === i} onClick={() => { haptic.select(); onPick(i); }}
              style={{
                display: "grid", gridTemplateColumns: "20px 1fr auto", gap: 8, alignItems: "start", width: "100%",
                padding: "7px 6px 7px 0", borderRadius: 9, border: "none", textAlign: "left", fontFamily: "inherit",
                background: cur === i ? "rgba(255,255,255,.07)" : "transparent", color: C.textPrimary, cursor: "pointer",
              }}>
              <span style={{ width: 12, height: 12, borderRadius: "50%", margin: "4px 4px 0", background: WHO_COLOR[item.who] }} />
              <span style={{ fontSize: 14.5, lineHeight: 1.35, minWidth: 0 }}>
                {item.text}
                {(item.sub || item.by) && (
                  <span style={{ display: "block", fontSize: 13.5, color: C.textTertiary }}>
                    {[item.sub, item.by].filter(Boolean).join(" · ")}
                  </span>
                )}
              </span>
              <span style={{ fontFamily: MONO, fontSize: 13, color: C.textTertiary, whiteSpace: "nowrap" }}>{fmtTime(item.at)}</span>
            </button>
          </div>
        );
      })}
      <div style={{ fontSize: 13, letterSpacing: ".04em", textTransform: "uppercase", fontWeight: 700, padding: "10px 0 0 28px", color: JOURNEY_TONE[nowTone] }}>
        Сейчас · {nowText.replace(/^[^\p{L}\d]+\s/u, "")}
      </div>
    </div>
  );
}
