"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { C } from "./theme";
import { haptic } from "./haptics";
import { toast } from "./Toast";
import BottomSheet from "./BottomSheet";
import {
  LANES, LANE_LABEL, NOMINALS, RATE_PRESETS, RBXRUBY_MODE_LABEL,
  availableAt, fmtUsd, hhmm, nextLine, secondsTo, stockSpark,
  type RbxrubyOverviewView, type RbxrubyOrderView, type RbxrubySettingsView,
} from "@/lib/rbxruby-view";

/* 🤖 RBXRUBY в TWA (28.11.2026): живая карточка, лента, настройки шторкой, блок в карточке заказа.
   Подтверждение — вторым нажатием: window.confirm в Telegram WebView молча отвечает «нет». */

const API = "/api/twa/rbxruby";
const num = (n: number) => n.toLocaleString("ru-RU");
const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1).replace(".0", "")}k` : String(n));

const CSS = `
@keyframes rbxPulse{0%{box-shadow:0 0 0 0 rgba(48,209,88,.55)}70%{box-shadow:0 0 0 9px rgba(48,209,88,0)}100%{box-shadow:0 0 0 0 rgba(48,209,88,0)}}
@keyframes rbxDrop{0%{opacity:0;transform:translateY(-12px);background:rgba(48,209,88,.28)}60%{opacity:1;transform:none}100%{background:transparent}}
@keyframes rbxPop{0%{transform:scale(.5);opacity:0}60%{transform:scale(1.15);opacity:1}100%{transform:scale(1)}}
@keyframes rbxSpin{to{transform:rotate(360deg)}}
@keyframes rbxArm{0%,100%{filter:brightness(1)}50%{filter:brightness(1.3)}}
.rbx-live{width:9px;height:9px;border-radius:50%;background:${C.green};animation:rbxPulse 1.6s infinite}
.rbx-drop{animation:rbxDrop 1.8s cubic-bezier(.2,.8,.2,1) both}
.rbx-pop{animation:rbxPop .45s cubic-bezier(.2,.8,.2,1) both}
.rbx-spin{width:16px;height:16px;border-radius:50%;border:2px solid rgba(10,132,255,.3);border-top-color:${C.blue};animation:rbxSpin .9s linear infinite;flex:none}
.rbx-arm{animation:rbxArm .8s infinite}
`;

async function post(token: string, body: Record<string, unknown>) {
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, ...(data as { message?: string; error?: string; overview?: RbxrubyOverviewView }) };
}

const btn = (primary: boolean, danger = false): React.CSSProperties => ({
  font: "inherit", fontSize: 15, fontWeight: 600, minHeight: 46, borderRadius: 12, border: 0, flex: 1,
  background: primary ? C.blue : "rgba(255,255,255,0.10)", color: danger ? C.red : primary ? "#fff" : C.textPrimary,
  cursor: "pointer",
});
const chip = (on: boolean): React.CSSProperties => ({
  font: "inherit", fontSize: 15, minHeight: 40, padding: "0 12px", borderRadius: 999,
  border: `1px solid ${on ? C.blue : "rgba(255,255,255,0.16)"}`, background: on ? C.blue : "transparent", color: on ? "#fff" : C.textPrimary,
});

function useTween(value: number, ms = 700): number {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      setShown(a + (value - a) * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(step);
      else from.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return shown;
}

export function RbxrubyCard({ token }: { token: string }) {
  const [data, setData] = useState<RbxrubyOverviewView | null>(null);
  const [busy, setBusy] = useState(false);
  const [arm, setArm] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [offersOpen, setOffersOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const seen = useRef<Set<string> | null>(null);

  const apply = useCallback((d: RbxrubyOverviewView) => {
    const keys = d.feed.map((f) => `${f.orderId}:${f.at}`);
    if (seen.current) {
      const added = keys.filter((x) => !seen.current!.has(x));
      if (added.length) {
        setFresh(new Set(added));
        const ok = d.feed.find((f) => f.ok && added.includes(`${f.orderId}:${f.at}`));
        if (ok) {
          haptic.notify("success");
          toast(`✓ Выкуплен ${ok.code} · ${num(ok.amount)} R$ · ${fmtUsd(ok.usd)}`, "success");
        }
        setTimeout(() => setFresh(new Set()), 2500);
      }
    }
    seen.current = new Set(keys);
    setData(d);
  }, []);

  const load = useCallback(() => {
    fetch(API, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null)).then((d) => d && apply(d)).catch(() => {});
  }, [token, apply]);
  useEffect(() => {
    load();
    const t = setInterval(load, 10_000);
    const c = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(t); clearInterval(c); };
  }, [load]);
  useEffect(() => {
    if (!arm) return;
    const t = setTimeout(() => setArm(false), 4000);
    return () => clearTimeout(t);
  }, [arm]);

  const todayRobux = useTween(data?.today.robux ?? 0);
  const todayUsd = useTween(data?.today.usd ?? 0);
  const saved = useTween(data?.today.saved ?? 0);

  const setMode = async (mode: "on" | "dry" | "off") => {
    if (mode === "on" && !arm) { haptic.impact("medium"); setArm(true); return; }
    setArm(false);
    haptic.select();
    setBusy(true);
    const r = await post(token, { action: "mode", mode });
    setBusy(false);
    if (r.ok) haptic.notify(mode === "on" ? "success" : "warning");
    toast(r.ok ? `RBXRUBY: ${RBXRUBY_MODE_LABEL[mode]}` : r.error ?? "не получилось");
    if (r.overview) apply(r.overview);
  };

  const saveSettings = async (patch: Partial<RbxrubySettingsView>) => {
    if (!data) return;
    haptic.select();
    const next = { ...data.settings, ...patch };
    setData({ ...data, settings: next });
    const r = await post(token, { action: "settings", settings: next });
    if (!r.ok) toast(r.error ?? "настройки не сохранились");
    if (r.overview) apply(r.overview);
  };

  if (!data || !data.configured) return null;
  const s = data.settings;
  const live = data.mode === "on" && !data.envOff;
  const modeColor = live ? C.green : data.mode === "dry" ? C.yellow : C.textSecondary;
  const left = secondsTo(data.nextTickAt, now);
  const at = availableAt(data.offers, s.maxRate);
  const tag = (t: string) => <span style={{ fontSize: 13, padding: "5px 10px", borderRadius: 999, background: "rgba(255,255,255,0.08)" }}>{t}</span>;

  return (
    <section style={{ background: C.card, borderRadius: 16, padding: 16, display: "flex", flexDirection: "column", gap: 12, color: C.textPrimary }}>
      <style>{CSS}</style>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 17, fontWeight: 700 }}>RBXRUBY</span>
        {live && <span className="rbx-live" aria-hidden="true" />}
        <span style={{ fontSize: 13, fontWeight: 600, padding: "3px 8px", borderRadius: 999, background: "rgba(255,255,255,0.08)", color: modeColor }}>
          {data.envOff ? "ВЫКЛ" : RBXRUBY_MODE_LABEL[data.mode]}
        </span>
        <button type="button" onClick={() => { haptic.select(); setSheet(true); }}
          style={{ marginLeft: "auto", font: "inherit", fontSize: 15, fontWeight: 600, minHeight: 40, padding: "0 14px", borderRadius: 10, border: 0, background: "rgba(255,255,255,0.10)", color: C.textPrimary }}>
          Настройки
        </button>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {tag(`до ${s.maxRate.toFixed(1)}`)}
        {tag(s.lanes.length === LANES.length ? "все группы" : `${s.lanes.length} групп`)}
        {tag(s.nominals.length ? `${s.nominals.join("/")} R$` : "все номиналы")}
        {tag(`${s.perTick} за проход`)}
      </div>
      {live && <div style={{ fontSize: 14, color: C.textSecondary }}>следующий проход через {left ?? "—"} с</div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
        <div><div style={{ fontSize: 14, color: C.textSecondary }}>Сегодня</div><div style={{ fontSize: 20, fontWeight: 800 }}>{num(Math.round(todayRobux))} R$</div></div>
        <div><div style={{ fontSize: 14, color: C.textSecondary }}>Потрачено</div><div style={{ fontSize: 20, fontWeight: 800 }}>${todayUsd.toFixed(2)}</div></div>
        <div><div style={{ fontSize: 14, color: C.green }}>Экономия</div><div style={{ fontSize: 20, fontWeight: 800, color: C.green }}>${saved.toFixed(2)}</div></div>
      </div>
      <div style={{ fontSize: 14, color: C.textSecondary }}>
        Баланс {fmtUsd(data.balance)} · сток ≤{s.maxRate.toFixed(1)}: {k(at.robux)}
        {data.fit ? ` · подходят ${data.fit.fit} из ${data.fit.total}` : ""}
      </div>

      {data.active.map((a) => (
        <div key={a.orderId} style={{ display: "flex", alignItems: "center", gap: 10, padding: 12, borderRadius: 12, border: `1px solid ${C.blue}` }}>
          <span className="rbx-spin" aria-hidden="true" />
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <b>{a.code} · {num(a.amount)} R$</b>
            <span style={{ fontSize: 14, color: C.textSecondary }}>ищет продавца с {hhmm(a.at)}</span>
          </div>
        </div>
      ))}
      {data.active.length === 0 && data.next.length > 0 && (
        <div style={{ fontSize: 14, color: C.textSecondary }}>Следующий: {nextLine(data.next[0])}</div>
      )}

      {data.feed.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", borderRadius: 12, background: "rgba(255,255,255,0.04)" }}>
          {data.feed.slice(0, 5).map((f, i) => (
            <div key={`${f.orderId}:${f.at}`} className={fresh.has(`${f.orderId}:${f.at}`) ? "rbx-drop" : undefined}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 12px", borderTop: i ? "1px solid rgba(255,255,255,0.06)" : 0 }}>
              <span className={fresh.has(`${f.orderId}:${f.at}`) ? "rbx-pop" : undefined}
                style={{ width: 28, height: 28, borderRadius: "50%", flex: "none", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800,
                  background: f.ok ? "rgba(48,209,88,0.18)" : "rgba(255,69,58,0.18)", color: f.ok ? C.green : C.red }}>{f.ok ? "✓" : "!"}</span>
              <div style={{ display: "flex", flexDirection: "column", gap: 2, flexGrow: 1, minWidth: 0 }}>
                <span style={{ fontWeight: 600 }}>{f.code} · {num(f.amount)} R$</span>
                <span style={{ fontSize: 14, color: C.textSecondary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {f.ok ? `${fmtUsd(f.usd)}${f.rate ? ` · ${f.rate}` : ""}${f.seller ? ` · ${f.seller}` : ""}` : f.why}
                </span>
              </div>
              <span style={{ fontSize: 13, color: C.textTertiary }}>{hhmm(f.at)}</span>
            </div>
          ))}
        </div>
      )}

      {data.lastError && <div style={{ fontSize: 14, color: C.red }}>{data.lastError}</div>}
      {!data.envOff && (
        <div style={{ display: "flex", gap: 8 }}>
          {data.mode !== "on" && (
            <button type="button" className={arm ? "rbx-arm" : undefined} style={{ ...btn(true), ...(arm ? { background: C.orange, color: "#111" } : {}) }} disabled={busy} onClick={() => setMode("on")}>
              {arm ? "Ещё раз — включить" : "Включить выкуп"}
            </button>
          )}
          {data.mode !== "dry" && <button type="button" style={btn(false)} disabled={busy} onClick={() => setMode("dry")}>Тест</button>}
          {data.mode !== "off" && <button type="button" style={btn(false, live)} disabled={busy} onClick={() => setMode("off")}>Пауза</button>}
        </div>
      )}

      <BottomSheet open={sheet} onClose={() => setSheet(false)} ariaLabel="Что выкупать через RBXRUBY">
        <div style={{ display: "flex", flexDirection: "column", gap: 18, padding: "4px 16px 24px", color: C.textPrimary }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Что выкупать</div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={{ fontSize: 14, color: C.textSecondary }}>Макс. курс, $ за 1000 R$</span>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button type="button" aria-label="Курс меньше" onClick={() => saveSettings({ maxRate: Math.round((s.maxRate - 0.1) * 10) / 10 })}
                style={{ font: "inherit", fontSize: 22, width: 48, height: 48, borderRadius: 12, border: 0, background: "rgba(255,255,255,0.10)", color: C.textPrimary }}>−</button>
              <span style={{ flexGrow: 1, textAlign: "center", fontSize: 30, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{s.maxRate.toFixed(1)}</span>
              <button type="button" aria-label="Курс больше" onClick={() => saveSettings({ maxRate: Math.round((s.maxRate + 0.1) * 10) / 10 })}
                style={{ font: "inherit", fontSize: 22, width: 48, height: 48, borderRadius: 12, border: 0, background: "rgba(255,255,255,0.10)", color: C.textPrimary }}>+</button>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {RATE_PRESETS.map((v) => (
                <button key={v} type="button" onClick={() => saveSettings({ maxRate: v })}
                  style={{ ...chip(Math.abs(v - s.maxRate) < 0.01), flex: 1, borderRadius: 10 }}>{v}</button>
              ))}
            </div>
            <span style={{ fontSize: 14, color: C.textSecondary }}>
              {at.robux ? `Сейчас ${num(at.robux)} R$, один продавец до ${num(at.maxOne)} · пасс 715 ≤ ${fmtUsd((715 / 1000) * s.maxRate)}` : "По этому курсу продавцов сейчас нет — заказы будут ждать"}
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={{ fontSize: 14, color: C.textSecondary }}>Группы</span>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {LANES.map((l) => (
                <button key={l} type="button" style={chip(s.lanes.includes(l))}
                  onClick={() => saveSettings({ lanes: s.lanes.includes(l) ? s.lanes.filter((x) => x !== l) : [...s.lanes, l] })}>{LANE_LABEL[l]}</button>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={{ fontSize: 14, color: C.textSecondary }}>Номиналы (ничего не выбрано — все)</span>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {NOMINALS.map((n) => (
                <button key={n} type="button" style={chip(s.nominals.includes(n))}
                  onClick={() => saveSettings({ nominals: s.nominals.includes(n) ? s.nominals.filter((x) => x !== n) : [...s.nominals, n] })}>{num(n)} R$</button>
              ))}
            </div>
          </div>

          {([
            ["За проход", "perTick", 1, 1, 10],
            ["Тратить в сутки до, $", "dailyUsd", 5, 5, 1000],
            ["Заказы старше, ч (0 — любые)", "minAgeHours", 6, 0, 168],
          ] as const).map(([label, key, step, lo, hi]) => (
            <div key={key} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 15, flexGrow: 1 }}>{label}</span>
              <button type="button" aria-label={`${label}: меньше`} onClick={() => saveSettings({ [key]: Math.max(lo, s[key] - step) })}
                style={{ font: "inherit", width: 40, height: 40, borderRadius: 10, border: 0, background: "rgba(255,255,255,0.10)", color: C.textPrimary }}>−</button>
              <b style={{ minWidth: 44, textAlign: "center", fontSize: 18 }}>{s[key]}</b>
              <button type="button" aria-label={`${label}: больше`} onClick={() => saveSettings({ [key]: Math.min(hi, s[key] + step) })}
                style={{ font: "inherit", width: 40, height: 40, borderRadius: 10, border: 0, background: "rgba(255,255,255,0.10)", color: C.textPrimary }}>+</button>
            </div>
          ))}

          <button type="button" onClick={() => { haptic.select(); setOffersOpen((v) => !v); }}
            style={{ font: "inherit", fontSize: 15, fontWeight: 600, minHeight: 44, borderRadius: 12, border: 0, background: "rgba(255,255,255,0.06)", color: C.accent, textAlign: "left", padding: "0 12px" }}>
            {offersOpen ? "Скрыть предложения" : `Предложения · один продавец до ${num(data.maxInstant)} R$`}
          </button>
          {offersOpen && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "grid", gridTemplateColumns: "56px 1fr 1fr 1fr", gap: "6px 8px", fontSize: 14, fontVariantNumeric: "tabular-nums" }}>
                <span style={{ color: C.textTertiary }}>Курс</span><span style={{ color: C.textTertiary }}>Всего</span>
                <span style={{ color: C.textTertiary }}>Продавцов</span><span style={{ color: C.textTertiary }}>У одного</span>
                {data.offers.map((o) => {
                  const usable = o.rate <= s.maxRate + 1e-9;
                  const color = usable && o.maxOne >= data.minUsefulPass ? C.green : usable ? C.textPrimary : C.textTertiary;
                  return [
                    <span key={`r${o.rate}`} style={{ color, fontWeight: 600 }}>{o.rate}</span>,
                    <span key={`t${o.rate}`} style={{ color }}>{num(o.robux)}</span>,
                    <span key={`s${o.rate}`} style={{ color }}>{o.sellers ?? "—"}</span>,
                    <span key={`m${o.rate}`} style={{ color }}>{num(o.maxOne)}</span>,
                  ];
                })}
              </div>
              {data.history.length > 1 && (
                <svg viewBox="0 0 320 70" width="100%" height="70" role="img" aria-label="График стока RBXRUBY за сутки">
                  <path d={stockSpark(data.history, 320, 66)} fill="none" stroke={C.accent} strokeWidth="2" transform="translate(0,2)" />
                </svg>
              )}
            </div>
          )}
          <div style={{ fontSize: 14, color: C.textTertiary }}>
            Сохраняется сразу, действует со следующего прохода.{s.by ? ` Последним менял ${s.by}.` : ""}
          </div>
        </div>
      </BottomSheet>
    </section>
  );
}

export function RbxrubyOrderSection({ token, orderId, onChanged }: { token: string; orderId: string; onChanged?: () => void }) {
  const [data, setData] = useState<RbxrubyOrderView | null>(null);
  const [busy, setBusy] = useState(false);
  const [arm, setArm] = useState(false);
  const load = useCallback(() => {
    fetch(`${API}?orderId=${encodeURIComponent(orderId)}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null)).then((d) => d && setData(d)).catch(() => {});
  }, [orderId, token]);
  useEffect(load, [load]);
  useEffect(() => {
    if (data?.state?.state !== "open") return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [data?.state?.state, load]);

  const act = async (action: "send" | "cancel" | "exclude" | "include") => {
    if (action === "send" && !arm) { haptic.impact("medium"); setArm(true); setTimeout(() => setArm(false), 4000); return; }
    setArm(false);
    haptic.select();
    setBusy(true);
    const r = await post(token, { action, orderId });
    setBusy(false);
    if (r.ok) haptic.notify("success");
    toast(`RBXRUBY: ${r.message ?? r.error ?? (r.ok ? "готово" : "ошибка")}`);
    load();
    if (r.ok) onChanged?.();
  };

  if (!data) return null;
  const st = data.state?.state;
  return (
    <div style={{ background: "rgba(255,255,255,0.05)", borderRadius: 14, padding: 14, display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
      <style>{CSS}</style>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 15 }}>
        <b style={{ display: "flex", alignItems: "center", gap: 8 }}>RBXRUBY {st === "open" && <span className="rbx-spin" aria-hidden="true" />}</b>
        {data.state && <span style={{ color: st === "done" ? C.green : st === "failed" ? C.red : C.textSecondary, textAlign: "right" }}>{data.state.label}{data.state.why ? `: ${data.state.why}` : ""}</span>}
      </div>
      {data.timeline.map((t, i) => (
        <div key={i} style={{ display: "flex", gap: 8, fontSize: 14 }}>
          <span style={{ color: C.textTertiary, flexShrink: 0 }}>{hhmm(t.at)}</span>
          <span style={{ color: t.tone === "ok" ? C.green : t.tone === "bad" ? C.red : C.textPrimary }}>{t.text}</span>
        </div>
      ))}
      <div style={{ display: "flex", gap: 8 }}>
        {st !== "open" && st !== "done" && (
          <button type="button" className={arm ? "rbx-arm" : undefined} style={{ ...btn(true), ...(arm ? { background: C.orange, color: "#111" } : {}) }} disabled={busy} onClick={() => act("send")}>
            {arm ? "Ещё раз — отправить" : "В RBXRUBY"}
          </button>
        )}
        {st === "open" && <button type="button" style={btn(false, true)} disabled={busy} onClick={() => act("cancel")}>Отменить у RBXRUBY</button>}
        {st !== "open" && st !== "done" && (st === "excluded"
          ? <button type="button" style={btn(false)} disabled={busy} onClick={() => act("include")}>Снова можно</button>
          : <button type="button" style={btn(false)} disabled={busy} onClick={() => act("exclude")}>Не отдавать</button>)}
      </div>
    </div>
  );
}
