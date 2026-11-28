"use client";

import { useCallback, useEffect, useState } from "react";
import { C } from "./theme";
import { haptic } from "./haptics";
import { toast } from "./Toast";
import { RBXRUBY_MODE_LABEL, fmtUsd, nextLine, stockSpark, type RbxrubyOverviewView, type RbxrubyOrderView } from "@/lib/rbxruby-view";

/* 🤖 RBXRUBY в TWA (28.11.2026): карточка на главной/«Выкупы» и блок в карточке заказа. */

const API = "/api/twa/rbxruby";
const num = (n: number) => n.toLocaleString("ru-RU");
const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1).replace(".0", "")}k` : String(n));

async function post(token: string, body: Record<string, unknown>) {
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, ...(data as { message?: string; error?: string }) };
}

const btn = (primary: boolean, danger = false): React.CSSProperties => ({
  font: "inherit", fontSize: 15, fontWeight: 600, minHeight: 46, borderRadius: 12, border: 0, flex: 1,
  background: primary ? C.blue : "rgba(255,255,255,0.10)", color: danger ? C.red : primary ? "#fff" : C.textPrimary,
  cursor: "pointer",
});

export function RbxrubyCard({ token }: { token: string }) {
  const [data, setData] = useState<RbxrubyOverviewView | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const load = useCallback(() => {
    fetch(API, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null)).then((d) => d && setData(d)).catch(() => {});
  }, [token]);
  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  const setMode = async (mode: "on" | "dry" | "off") => {
    if (mode === "on" && !window.confirm("Включить выкуп через RBXRUBY? Заказы начнут списывать деньги с баланса.")) return;
    haptic.select();
    setBusy(true);
    const r = await post(token, { action: "mode", mode });
    setBusy(false);
    toast(r.ok ? `RBXRUBY: ${RBXRUBY_MODE_LABEL[mode]}` : r.error ?? "не получилось");
    load();
  };

  if (!data || !data.configured) return null;
  const modeColor = data.mode === "on" ? C.green : data.mode === "dry" ? C.yellow : C.textSecondary;
  return (
    <section style={{ background: C.card, borderRadius: 16, padding: 16, display: "flex", flexDirection: "column", gap: 12, color: C.textPrimary }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 17, fontWeight: 700 }}>RBXRUBY</span>
        <span style={{ fontSize: 13, fontWeight: 600, padding: "3px 8px", borderRadius: 999, background: "rgba(255,255,255,0.08)", color: modeColor }}>
          {data.envOff ? "ВЫКЛ" : RBXRUBY_MODE_LABEL[data.mode]}
        </span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
        <div><div style={{ fontSize: 14, color: C.textSecondary }}>Баланс</div><div style={{ fontSize: 20, fontWeight: 700 }}>{fmtUsd(data.balance)}</div></div>
        <div><div style={{ fontSize: 14, color: C.textSecondary }}>Сток ≤{data.maxRate}</div><div style={{ fontSize: 20, fontWeight: 700 }}>{k(data.stockUsable)}</div></div>
        <div><div style={{ fontSize: 14, color: C.textSecondary }}>Сутки</div><div style={{ fontSize: 20, fontWeight: 700 }}>{data.day.completed} / {data.day.inFlight}</div></div>
      </div>
      <div style={{ fontSize: 14, color: C.textSecondary, lineHeight: 1.4 }}>
        выкуплено / в полёте · {fmtUsd(data.day.usd)} за сутки · неделя {data.week.completed} шт, {fmtUsd(data.week.usd)}
        {data.week.avgRate ? `, курс ${data.week.avgRate}` : ""}
        {data.next.length ? ` · следующий: ${nextLine(data.next[0])}` : ""}
      </div>
      {data.lastError && <div style={{ fontSize: 14, color: C.red }}>{data.lastError}</div>}
      {!data.envOff && (
        <div style={{ display: "flex", gap: 8 }}>
          {data.mode !== "on" && <button type="button" style={btn(true)} disabled={busy} onClick={() => setMode("on")}>Включить выкуп</button>}
          {data.mode !== "dry" && <button type="button" style={btn(false)} disabled={busy} onClick={() => setMode("dry")}>Тест</button>}
          {data.mode !== "off" && <button type="button" style={btn(false, data.mode === "on")} disabled={busy} onClick={() => setMode("off")}>Пауза</button>}
        </div>
      )}
      <button type="button" onClick={() => { haptic.select(); setOpen((v) => !v); }}
        style={{ font: "inherit", fontSize: 15, fontWeight: 600, minHeight: 44, borderRadius: 12, border: 0, background: "rgba(255,255,255,0.06)", color: C.accent, textAlign: "left", padding: "0 12px" }}>
        {open ? "Скрыть предложения" : `Предложения · один продавец до ${num(data.maxInstant)} R$`}
      </button>
      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "56px 1fr 1fr 1fr", gap: "6px 8px", fontSize: 14, fontVariantNumeric: "tabular-nums" }}>
            <span style={{ color: C.textTertiary }}>Курс</span><span style={{ color: C.textTertiary }}>Всего</span>
            <span style={{ color: C.textTertiary }}>Продавцов</span><span style={{ color: C.textTertiary }}>У одного</span>
            {data.offers.map((o) => {
              const color = o.usable && o.maxOne >= data.minUsefulPass ? C.green : o.usable ? C.textPrimary : C.textTertiary;
              return [
                <span key={`r${o.rate}`} style={{ color, fontWeight: 600 }}>{o.rate}</span>,
                <span key={`t${o.rate}`} style={{ color }}>{num(o.robux)}</span>,
                <span key={`s${o.rate}`} style={{ color }}>{o.sellers ?? "—"}</span>,
                <span key={`m${o.rate}`} style={{ color }}>{num(o.maxOne)}</span>,
              ];
            })}
          </div>
          <div style={{ fontSize: 14, color: C.textSecondary }}>Сток ≤ {data.maxRate} за сутки</div>
          {data.history.length > 1 ? (
            <svg viewBox="0 0 320 70" width="100%" height="70" role="img" aria-label="График стока RBXRUBY за сутки">
              <path d={stockSpark(data.history, 320, 66)} fill="none" stroke={C.accent} strokeWidth="2" transform="translate(0,2)" />
            </svg>
          ) : <div style={{ fontSize: 14, color: C.textTertiary }}>История копится — точка раз в 10 минут.</div>}
          <div style={{ fontSize: 14, color: C.textTertiary }}>
            крупнейший продавец за сутки {num(Math.max(0, ...data.history.map((p) => p.maxInstant)))} R$ · зелёным — берёт пасс от {data.minUsefulPass} R$
          </div>
        </div>
      )}
    </section>
  );
}

export function RbxrubyOrderSection({ token, orderId, onChanged }: { token: string; orderId: string; onChanged?: () => void }) {
  const [data, setData] = useState<RbxrubyOrderView | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    fetch(`${API}?orderId=${encodeURIComponent(orderId)}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null)).then((d) => d && setData(d)).catch(() => {});
  }, [orderId, token]);
  useEffect(load, [load]);

  const act = async (action: "send" | "cancel" | "exclude" | "include") => {
    if (action === "send" && !window.confirm("Отправить в RBXRUBY сейчас? Деньги зарезервируются.")) return;
    haptic.select();
    setBusy(true);
    const r = await post(token, { action, orderId });
    setBusy(false);
    toast(`RBXRUBY: ${r.message ?? r.error ?? (r.ok ? "готово" : "ошибка")}`);
    load();
    if (r.ok) onChanged?.();
  };

  if (!data) return null;
  const st = data.state?.state;
  return (
    <div style={{ background: "rgba(255,255,255,0.05)", borderRadius: 14, padding: 14, display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 15 }}>
        <b>RBXRUBY</b>
        {data.state && <span style={{ color: st === "done" ? C.green : st === "failed" ? C.red : C.textSecondary, textAlign: "right" }}>{data.state.label}{data.state.why ? `: ${data.state.why}` : ""}</span>}
      </div>
      {data.timeline.map((t, i) => (
        <div key={i} style={{ display: "flex", gap: 8, fontSize: 14 }}>
          <span style={{ color: C.textTertiary, flexShrink: 0 }}>{new Date(t.at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}</span>
          <span style={{ color: t.tone === "ok" ? C.green : t.tone === "bad" ? C.red : C.textPrimary }}>{t.text}</span>
        </div>
      ))}
      <div style={{ display: "flex", gap: 8 }}>
        {st !== "open" && st !== "done" && <button type="button" style={btn(true)} disabled={busy} onClick={() => act("send")}>В RBXRUBY</button>}
        {st === "open" && <button type="button" style={btn(false, true)} disabled={busy} onClick={() => act("cancel")}>Отменить у RBXRUBY</button>}
        {st !== "open" && st !== "done" && (st === "excluded"
          ? <button type="button" style={btn(false)} disabled={busy} onClick={() => act("include")}>Снова можно</button>
          : <button type="button" style={btn(false)} disabled={busy} onClick={() => act("exclude")}>Не отдавать</button>)}
      </div>
    </div>
  );
}
