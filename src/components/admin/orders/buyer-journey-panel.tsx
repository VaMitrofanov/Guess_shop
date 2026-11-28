"use client";

/* ─────────────────────────────────────────────────────────────────────────────
   🧭 «Путь покупателя» в досье сайта (28.10.2026, макет «Карточка заказа v2»).

   Слева: чего ждём и сколько, три последних касания и «Следующий шаг».
   Справа: «Вся история» — линия с точками (сутки / всё) и лента по шагам,
   точка и строка подсвечивают друг друга. На десктопе места хватает, поэтому
   раскрывать ничего не надо. Правило — общий `@/lib/buyer-journey`.
   ───────────────────────────────────────────────────────────────────────── */

import { useState } from "react";
import {
  journeySinceText,
  type BuyerJourney,
  type JourneyItem,
  type JourneyNext,
  type JourneyTone,
  type JourneyWho,
} from "@/lib/buyer-journey";

const TONE: Record<JourneyTone, string> = {
  wait: "var(--o-orange)", us: "var(--o-blue)", bad: "var(--o-red)", done: "var(--o-green)", muted: "var(--o-muted)",
};
const WHO: Record<JourneyWho, string> = { buyer: "var(--o-green)", us: "var(--o-blue)", problem: "var(--o-orange)" };
const WHO_WORD: Record<JourneyWho, string> = { buyer: "он", us: "мы", problem: "бот" };

const fmt = (value: string) => {
  const d = new Date(value);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).replace(",", "");
};

const box: React.CSSProperties = {
  border: "1px solid var(--o-line)", background: "var(--o-surface)", borderRadius: 12, padding: 12,
  display: "flex", flexDirection: "column", gap: 10, minWidth: 0,
};

/** Полоса из пяти шагов — на месте прежней полосы готовности. */
export function JourneySteps({ journey }: { journey: BuyerJourney }) {
  const color = TONE[journey.now.tone];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 4 }} aria-label={`Путь: ${journey.now.text}`}>
      {journey.steps.map(step => {
        const tint = step.state === "current" ? color : step.state === "bad" ? "var(--o-red)" : undefined;
        const bg = step.state === "done" ? "var(--o-green)" : tint ?? "rgba(255,255,255,.1)";
        return (
          <div key={step.key} style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0, color: tint ?? (step.state === "done" ? "var(--o-green)" : "var(--o-muted)") }}>
            <span style={{ height: 6, borderRadius: 3, background: bg }} />
            <small style={{ fontSize: 12, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {step.state === "done" ? "✓ " : ""}{step.label}
            </small>
          </div>
        );
      })}
    </div>
  );
}

export function BuyerJourneyPanel({ journey, onNext, onOther }: {
  journey: BuyerJourney;
  onNext: (next: JourneyNext) => void;
  onOther?: () => void;
}) {
  const [zoom, setZoom] = useState<"day" | "all">("all");
  const [cur, setCur] = useState<number | null>(null);
  const color = TONE[journey.now.tone];
  const since = journeySinceText(journey);
  const live = journey.now.tone !== "done" && journey.now.tone !== "muted";

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12, alignItems: "start" }}>
      <div style={box}>
        <b style={{ fontSize: 14 }}>🧭 Путь покупателя</b>
        <div style={{ display: "flex", gap: 10, alignItems: "center", padding: 10, borderRadius: 10, background: "var(--o-surface-2)" }}>
          {live && since && <div style={{ minWidth: 50, textAlign: "center", fontSize: 19, fontWeight: 800, color }}>{since}</div>}
          <div style={{ fontSize: 13.5, lineHeight: 1.35 }}>
            <b style={{ color }}>{journey.now.text}</b>
            {journey.now.detail && <span style={{ color: "var(--o-muted)" }}> · {journey.now.detail}</span>}
          </div>
        </div>
        {journey.touches.length > 0 && (
          <div>
            {journey.touches.map((t, i) => (
              <div key={`${t.at}-${i}`} style={{
                display: "grid", gridTemplateColumns: "28px 1fr auto", gap: 8, alignItems: "center", fontSize: 13,
                padding: "6px 0", borderTop: i === 0 ? "none" : "1px solid var(--o-line)",
              }}>
                <span style={{ fontSize: 11, fontWeight: 700, textAlign: "center", borderRadius: 6, padding: "2px 0", color: WHO[t.who], background: "var(--o-surface-2)" }}>{WHO_WORD[t.who]}</span>
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {t.text}{t.sub ? <span style={{ color: "var(--o-muted)" }}> · {t.sub}</span> : null}
                </span>
                <span style={{ fontVariantNumeric: "tabular-nums", fontSize: 12, color: "var(--o-muted)" }}>{fmt(t.at)}</span>
              </div>
            ))}
          </div>
        )}
        {journey.next && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4, borderRadius: 10, padding: 10, border: "1px solid rgba(167,139,250,.35)", background: "rgba(167,139,250,.08)" }}>
            <span style={{ fontSize: 11, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--o-muted)", fontWeight: 700 }}>Следующий шаг</span>
            <b style={{ fontSize: 14 }}>{journey.next.title}</b>
            <span style={{ fontSize: 13, color: "var(--o-muted)" }}>{journey.next.reason}</span>
            <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
              <button type="button" onClick={() => onNext(journey.next!)} style={{
                flex: 1, border: "none", borderRadius: 9, padding: "8px 10px", cursor: "pointer",
                background: "var(--o-accent)", color: "#120f1c", fontWeight: 700, fontSize: 13, fontFamily: "inherit",
              }}>
                {journey.next.kind === "nick-passes" ? "Проверить" : journey.next.kind === "contact" ? "Написать" : "Открыть"}
              </button>
              {onOther && (
                <button type="button" onClick={onOther} style={{
                  border: "1px solid var(--o-line-2)", borderRadius: 9, padding: "8px 10px", cursor: "pointer",
                  background: "transparent", color: "inherit", fontSize: 13, fontFamily: "inherit",
                }}>Другое ›</button>
              )}
            </div>
          </div>
        )}
      </div>

      <div style={box}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <b style={{ fontSize: 14 }}>Вся история <span style={{ color: "var(--o-muted)", fontWeight: 500 }}>· {journey.history.length}</span></b>
          <div role="group" aria-label="Масштаб" style={{ display: "flex", gap: 3, background: "var(--o-surface-2)", borderRadius: 8, padding: 3 }}>
            {(["day", "all"] as const).map(z => (
              <button key={z} type="button" aria-pressed={zoom === z} onClick={() => setZoom(z)} style={{
                border: "none", borderRadius: 6, padding: "3px 9px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
                background: zoom === z ? "rgba(255,255,255,.1)" : "transparent", color: zoom === z ? "inherit" : "var(--o-muted)",
              }}>{z === "day" ? "Сутки" : "Всё"}</button>
            ))}
          </div>
        </div>
        <Axis items={journey.history} zoom={zoom} cur={cur} onPick={setCur} />
        <List items={journey.history} cur={cur} onPick={setCur} />
      </div>
    </div>
  );
}

function Axis({ items, zoom, cur, onPick }: { items: JourneyItem[]; zoom: "day" | "all"; cur: number | null; onPick: (i: number) => void }) {
  const nowMs = Date.now();
  const firstMs = items.length ? new Date(items[0].at).getTime() : nowMs - 3_600_000;
  const start = zoom === "day" ? nowMs - 24 * 3_600_000 : Math.min(firstMs, nowMs - 3_600_000);
  const span = Math.max(1, nowMs - start);
  const pos = (t: number) => Math.max(1.5, Math.min(97, ((t - start) / span) * 100));
  return (
    <div style={{ position: "relative", height: 54, margin: "0 8px" }} aria-label="Касания на шкале времени">
      <div style={{ position: "absolute", left: 0, right: 0, top: 18, height: 2, background: "var(--o-line-2)" }} />
      <div style={{ position: "absolute", right: -2, top: 4, height: 30, width: 2, background: "var(--o-orange)" }} />
      <span style={{ position: "absolute", left: 0, top: 34, fontSize: 11, color: "var(--o-muted)", fontVariantNumeric: "tabular-nums" }}>
        {zoom === "day" ? "−24 ч" : fmt(new Date(start).toISOString())}
      </span>
      <span style={{ position: "absolute", right: 0, top: 34, fontSize: 11, color: "var(--o-orange)" }}>сейчас</span>
      {items.map((item, i) => {
        const t = new Date(item.at).getTime();
        if (t < start) return null;
        return (
          <button key={`${item.at}-${i}`} type="button" aria-label={item.text} aria-pressed={cur === i} onClick={() => onPick(i)} style={{
            position: "absolute", top: 11, left: `${pos(t)}%`, width: 16, height: 16, padding: 0, borderRadius: "50%",
            transform: `translateX(-50%)${cur === i ? " scale(1.2)" : ""}`, border: "3px solid #121016",
            background: WHO[item.who], cursor: "pointer", boxShadow: cur === i ? "0 0 0 3px rgba(255,255,255,.3)" : "none",
          }} />
        );
      })}
    </div>
  );
}

function List({ items, cur, onPick }: { items: JourneyItem[]; cur: number | null; onPick: (i: number) => void }) {
  let group = "";
  return (
    <div style={{ display: "flex", flexDirection: "column", maxHeight: 340, overflowY: "auto" }}>
      {items.map((item, i) => {
        const head = item.group !== group ? item.group : null;
        group = item.group;
        return (
          <div key={`${item.at}-${i}`}>
            {head && <div style={{ fontSize: 11, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--o-muted)", fontWeight: 700, padding: "8px 0 3px 24px" }}>{head}</div>}
            <button type="button" aria-current={cur === i} onClick={() => onPick(i)} style={{
              display: "grid", gridTemplateColumns: "16px 1fr auto", gap: 8, alignItems: "start", width: "100%",
              padding: "5px 6px 5px 0", border: "none", borderRadius: 8, cursor: "pointer", textAlign: "left",
              background: cur === i ? "var(--o-surface-2)" : "transparent", color: "inherit", fontFamily: "inherit",
            }}>
              <span style={{ width: 10, height: 10, borderRadius: "50%", margin: "4px 3px 0", background: WHO[item.who] }} />
              <span style={{ fontSize: 13, lineHeight: 1.35, minWidth: 0 }}>
                {item.text}
                {(item.sub || item.by) && <span style={{ display: "block", fontSize: 12, color: "var(--o-muted)" }}>{[item.sub, item.by].filter(Boolean).join(" · ")}</span>}
              </span>
              <span style={{ fontSize: 11.5, color: "var(--o-muted)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{fmt(item.at)}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
