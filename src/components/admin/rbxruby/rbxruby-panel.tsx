"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  LANES, LANE_LABEL, NOMINALS, RATE_PRESETS, RBXRUBY_MODE_LABEL,
  availableAt, fmtUsd, hhmm, nextLine, secondsTo, stockSpark,
  type RbxrubyOverviewView, type RbxrubyOrderView, type RbxrubySettingsView,
} from "@/lib/rbxruby-view";
import styles from "./rbxruby.module.css";

const num = (n: number) => n.toLocaleString("ru-RU");
const API = "/api/admin/rbxruby";

async function post(body: Record<string, unknown>): Promise<{ ok: boolean; message?: string; error?: string; overview?: RbxrubyOverviewView }> {
  const res = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, ...data };
}

/** Число, которое плавно докручивается до нового значения. */
function useTween(value: number, ms = 700): number {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / ms);
      const v = a + (value - a) * (1 - Math.pow(1 - k, 3));
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(step);
      else from.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return shown;
}

/** Плашка RBXRUBY: живой режим, счётчики, «в работе», лента, настройки, предложения. */
export default function RbxrubyPanel({ onToast, onChanged }: { onToast: (text: string, error?: boolean) => void; onChanged?: () => void }) {
  const [data, setData] = useState<RbxrubyOverviewView | null>(null);
  const [busy, setBusy] = useState(false);
  const [arm, setArm] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<RbxrubyOverviewView["feed"][number] | null>(null);
  const seen = useRef<Set<string> | null>(null);

  const apply = useCallback((d: RbxrubyOverviewView) => {
    const keys = d.feed.map((f) => `${f.orderId}:${f.at}`);
    if (seen.current) {
      const added = keys.filter((k) => !seen.current!.has(k));
      if (added.length) {
        setFresh(new Set(added));
        const firstOk = d.feed.find((f) => f.ok && added.includes(`${f.orderId}:${f.at}`));
        if (firstOk) { setToast(firstOk); onChanged?.(); }
        setTimeout(() => setFresh(new Set()), 2500);
      }
    }
    seen.current = new Set(keys);
    setData(d);
  }, [onChanged]);

  const load = useCallback(() => {
    fetch(API, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => d && apply(d)).catch(() => {});
  }, [apply]);
  useEffect(() => {
    load();
    const t = setInterval(load, 10_000);
    const c = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(t); clearInterval(c); };
  }, [load]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    if (!arm) return;
    const t = setTimeout(() => setArm(false), 4000);
    return () => clearTimeout(t);
  }, [arm]);

  const todayRobux = useTween(data?.today.robux ?? 0);
  const todayUsd = useTween(data?.today.usd ?? 0);
  const saved = useTween(data?.today.saved ?? 0);
  const balance = useTween(data?.balance ?? 0);

  const setMode = async (mode: "on" | "dry" | "off") => {
    // Подтверждение вторым нажатием: window.confirm в Telegram/части браузеров молча отвечает «нет».
    if (mode === "on" && !arm) { setArm(true); return; }
    setArm(false);
    setBusy(true);
    const r = await post({ action: "mode", mode });
    setBusy(false);
    if (!r.ok) return onToast(r.error ?? "не получилось", true);
    onToast(`RBXRUBY: ${RBXRUBY_MODE_LABEL[mode]}`);
    if (r.overview) apply(r.overview);
    onChanged?.();
  };

  const saveSettings = async (patch: Partial<RbxrubySettingsView>) => {
    if (!data) return;
    const next = { ...data.settings, ...patch };
    setData({ ...data, settings: next });
    const r = await post({ action: "settings", settings: next });
    if (!r.ok) return onToast(r.error ?? "настройки не сохранились", true);
    if (r.overview) apply(r.overview);
  };

  if (!data || !data.configured) return null;
  const s = data.settings;
  const live = data.mode === "on" && !data.envOff;
  const modeCls = live ? styles.modeOn : data.mode === "dry" ? styles.modeDry : styles.modeOff;
  const left = secondsTo(data.nextTickAt, now);
  const at = availableAt(data.offers, s.maxRate);
  const startBalance = (data.balance ?? 0) + data.today.usd;

  return (
    <section className={styles.panel} aria-label="Автовыкуп RBXRUBY">
      <div className={styles.head}>
        <div className={styles.title}>
          RBXRUBY
          {live && <span className={styles.liveDot} aria-hidden="true" />}
          <span className={cn(styles.mode, modeCls)}>{data.envOff ? "ВЫКЛ рубильником" : RBXRUBY_MODE_LABEL[data.mode]}</span>
        </div>
        <div className={styles.sub}>
          {live ? `следующий проход через ${left ?? "—"} с` : data.mode === "dry" ? "показывает, что купил бы — без денег" : "новые заказы не уходят"}
          {data.modeBy ? ` · ${data.modeBy}` : ""}
        </div>
        {!data.envOff && (
          <div className={styles.btns}>
            {data.mode !== "on" && (
              <button type="button" className={cn(styles.btn, styles.primary, arm && styles.armed)} disabled={busy} onClick={() => setMode("on")}>
                {arm ? "Нажмите ещё раз — включить" : "Включить выкуп"}
              </button>
            )}
            {data.mode !== "dry" && <button type="button" className={styles.btn} disabled={busy} onClick={() => setMode("dry")}>Тест</button>}
            {data.mode !== "off" && <button type="button" className={cn(styles.btn, live && styles.danger)} disabled={busy} onClick={() => setMode("off")}>Пауза</button>}
          </div>
        )}
      </div>

      <div className={styles.stat}>
        <span className={styles.label}>Сегодня выкуплено</span>
        <span className={styles.value}>{num(Math.round(todayRobux))} R$</span>
        <span className={styles.hint}>{data.day.completed} заказов · {data.day.inFlight} в работе{data.day.failed ? ` · ${data.day.failed} вернулось` : ""}</span>
      </div>
      <div className={styles.stat}>
        <span className={styles.label}>Потрачено</span>
        <span className={styles.value}>${todayUsd.toFixed(2)}</span>
        <span className={styles.hint}>лимит ${s.dailyUsd} в сутки{data.week.avgRate ? ` · неделя ${fmtUsd(data.week.usd)}, курс ${data.week.avgRate}` : ""}</span>
      </div>
      <div className={cn(styles.stat, styles.statGood)}>
        <span className={styles.label}>Сэкономили против {data.today.savingsBase}</span>
        <span className={cn(styles.value, styles.ok)}>${saved.toFixed(2)}</span>
        <span className={styles.hint}>за сегодня</span>
      </div>
      <div className={styles.stat}>
        <span className={styles.label}>Баланс</span>
        <span className={styles.value}>${balance.toFixed(2)}</span>
        <div className={styles.meter}><div style={{ width: `${startBalance > 0 ? Math.round(((data.balance ?? 0) / startBalance) * 100) : 0}%` }} /></div>
      </div>

      {toast && (
        <div className={styles.toast} role="status">
          <span className={styles.check} aria-hidden="true">✓</span>
          <div>
            <b>Выкуплен {toast.code} · {num(toast.amount)} R$</b>
            <div className={styles.hint}>{fmtUsd(toast.usd)}{toast.rate ? ` по ${toast.rate}` : ""}{toast.seller ? ` · ${toast.seller}` : ""} · покупатель извещён</div>
          </div>
        </div>
      )}

      <div className={styles.work}>
        <div className={styles.blockTitle}>Сейчас в работе</div>
        {data.active.length > 0 ? data.active.map((a) => (
          <div key={a.orderId} className={styles.activeRow}>
            <span className={styles.spinner} aria-hidden="true" />
            <b className={styles.code}>{a.code}</b>
            <span>{num(a.amount)} R$ · пасс {num(a.pass)}</span>
            <span className={styles.hint}>ищет продавца с {hhmm(a.at)}</span>
            <div className={styles.progress}><div /></div>
          </div>
        )) : (
          <div className={styles.idle}>
            {data.next.length ? `Следующие: ${data.next.map(nextLine).join(", ")}` : live ? "Подходящих заказов сейчас нет" : "Пусто"}
            {data.fit ? ` · под настройки подходят ${data.fit.fit} из ${data.fit.total}` : ""}
          </div>
        )}

        <div className={styles.blockTitle}>Лента выкупов</div>
        {data.feed.length === 0 && <div className={styles.idle}>Пока ничего</div>}
        {data.feed.map((f) => (
          <div key={`${f.orderId}:${f.at}`} className={cn(styles.feedRow, fresh.has(`${f.orderId}:${f.at}`) && styles.drop)}>
            <span className={styles.hint}>{hhmm(f.at)}</span>
            <b className={styles.code}>{f.code}</b>
            <span>{num(f.amount)} R$</span>
            <span className={styles.hint}>{f.ok ? (f.seller ? `продавец ${f.seller}` : "") : f.why}</span>
            <b>{f.ok ? `${fmtUsd(f.usd)}${f.rate ? ` · ${f.rate}` : ""}` : ""}</b>
            <span className={cn(styles.pill, f.ok ? styles.pillOk : styles.pillBad)}>{f.ok ? "✓ выкуплен" : "вернулся"}</span>
          </div>
        ))}
      </div>

      <details className={styles.offers}>
        <summary>
          Что выкупать · до {s.maxRate} · {s.lanes.length === LANES.length ? "все группы" : `${s.lanes.length} групп`} ·{" "}
          {s.nominals.length ? s.nominals.join("/") + " R$" : "все номиналы"} · {s.perTick} за проход
          {s.by ? ` · ${s.by}` : ""}
        </summary>
        <div className={styles.settings}>
          <div className={styles.setRow}>
            <span className={styles.label}>Макс. курс, $ за 1000 R$</span>
            <div className={styles.rateRow}>
              <button type="button" className={styles.btn} onClick={() => saveSettings({ maxRate: Math.round((s.maxRate - 0.1) * 10) / 10 })} aria-label="Курс меньше">−</button>
              <b className={styles.rate}>{s.maxRate.toFixed(1)}</b>
              <button type="button" className={styles.btn} onClick={() => saveSettings({ maxRate: Math.round((s.maxRate + 0.1) * 10) / 10 })} aria-label="Курс больше">+</button>
              {RATE_PRESETS.map((v) => (
                <button key={v} type="button" className={cn(styles.chip, Math.abs(v - s.maxRate) < 0.01 && styles.chipOn)} onClick={() => saveSettings({ maxRate: v })}>{v}</button>
              ))}
            </div>
            <span className={styles.hint}>
              {at.robux ? `по этому курсу сейчас ${num(at.robux)} R$, один продавец до ${num(at.maxOne)} · пасс 715 ≤ ${fmtUsd((715 / 1000) * s.maxRate)}` : "по этому курсу продавцов сейчас нет — заказы будут ждать"}
            </span>
          </div>
          <div className={styles.setRow}>
            <span className={styles.label}>Группы</span>
            <div className={styles.chips}>
              {LANES.map((l) => (
                <button key={l} type="button" className={cn(styles.chip, s.lanes.includes(l) && styles.chipOn)}
                  onClick={() => saveSettings({ lanes: s.lanes.includes(l) ? s.lanes.filter((x) => x !== l) : [...s.lanes, l] })}>{LANE_LABEL[l]}</button>
              ))}
            </div>
          </div>
          <div className={styles.setRow}>
            <span className={styles.label}>Номиналы (ничего не выбрано — все)</span>
            <div className={styles.chips}>
              {NOMINALS.map((n) => (
                <button key={n} type="button" className={cn(styles.chip, s.nominals.includes(n) && styles.chipOn)}
                  onClick={() => saveSettings({ nominals: s.nominals.includes(n) ? s.nominals.filter((x) => x !== n) : [...s.nominals, n] })}>{num(n)} R$</button>
              ))}
            </div>
          </div>
          <div className={styles.setGrid}>
            <label className={styles.setRow}>
              <span className={styles.label}>За проход</span>
              <input className={styles.input} type="number" min={1} max={10} value={s.perTick} onChange={(e) => saveSettings({ perTick: Number(e.target.value) })} />
            </label>
            <label className={styles.setRow}>
              <span className={styles.label}>Тратить в сутки до, $</span>
              <input className={styles.input} type="number" min={1} max={1000} value={s.dailyUsd} onChange={(e) => saveSettings({ dailyUsd: Number(e.target.value) })} />
            </label>
            <label className={styles.setRow}>
              <span className={styles.label}>Заказы старше, ч (0 — любые)</span>
              <input className={styles.input} type="number" min={0} max={168} value={s.minAgeHours} onChange={(e) => saveSettings({ minAgeHours: Number(e.target.value) })} />
            </label>
          </div>
        </div>
      </details>

      <details className={styles.offers}>
        <summary>
          Предложения · один продавец до {num(data.maxInstant)} R$ · всего ≤ {data.maxRate}: {num(data.stockUsable)} R$
          {data.snapshotAt ? ` · ${hhmm(data.snapshotAt)}` : ""}
        </summary>
        <div className={styles.offersBody}>
          <table className={styles.table}>
            <thead><tr><th>Курс $/1k</th><th>Всего R$</th><th>Продавцов</th><th>Максимум у одного</th><th /></tr></thead>
            <tbody>
              {data.offers.map((o) => {
                const fits = o.usable && o.maxOne >= data.minUsefulPass;
                return (
                  <tr key={o.rate} className={fits ? styles.fit : !o.usable ? styles.dim : undefined}>
                    <td>{o.rate}</td>
                    <td>{num(o.robux)}</td>
                    <td>{o.sellers ?? "—"}</td>
                    <td>{num(o.maxOne)}</td>
                    <td>{fits ? (o.maxOne >= 1429 ? "берёт 1429" : "берёт 715") : o.usable ? "мелочь" : `выше ${data.maxRate}`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className={styles.chart}>
            <div className={styles.label}>Сток ≤ {data.maxRate} за сутки (R$)</div>
            {data.history.length > 1 ? (
              <svg viewBox="0 0 320 80" width="100%" height="80" role="img" aria-label="График стока RBXRUBY за сутки">
                <path d={stockSpark(data.history, 320, 76)} fill="none" stroke="#7d9cff" strokeWidth="2" transform="translate(0,2)" />
              </svg>
            ) : <div className={styles.hint}>История копится — точка раз в 10 минут.</div>}
            <div className={styles.hint}>
              пик {num(Math.max(0, ...data.history.map((p) => p.usable)))} R$ · крупнейший продавец за сутки {num(Math.max(0, ...data.history.map((p) => p.maxInstant)))} R$
            </div>
          </div>
        </div>
      </details>
      {data.lastError && <div className={styles.err}>Последняя ошибка: {data.lastError}</div>}
    </section>
  );
}

/** Блок RBXRUBY в досье заказа: состояние, хроника, кнопки. */
export function RbxrubyOrderBox({ orderId, onToast, onChanged }: { orderId: string; onToast: (text: string, error?: boolean) => void; onChanged?: () => void }) {
  const [data, setData] = useState<RbxrubyOrderView | null>(null);
  const [busy, setBusy] = useState(false);
  const [arm, setArm] = useState(false);
  const load = useCallback(() => {
    fetch(`${API}?orderId=${encodeURIComponent(orderId)}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => d && setData(d)).catch(() => {});
  }, [orderId]);
  useEffect(load, [load]);
  useEffect(() => {
    if (data?.state?.state !== "open") return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [data?.state?.state, load]);

  const act = async (action: "send" | "cancel" | "exclude" | "include") => {
    if (action === "send" && !arm) { setArm(true); setTimeout(() => setArm(false), 4000); return; }
    setArm(false);
    setBusy(true);
    const r = await post({ action, orderId });
    setBusy(false);
    onToast(`RBXRUBY: ${r.message ?? r.error ?? (r.ok ? "готово" : "ошибка")}`, !r.ok);
    load();
    if (r.ok) onChanged?.();
  };

  if (!data) return null;
  const st = data.state?.state;
  return (
    <div className={styles.box}>
      <div className={styles.boxHead}>
        RBXRUBY
        {st === "open" && <span className={styles.spinner} aria-hidden="true" />}
        {data.state && <span className={styles.sub}>{data.state.label}{data.state.why ? `: ${data.state.why}` : ""}</span>}
      </div>
      {data.timeline.length > 0 && (
        <div className={styles.tl}>
          {data.timeline.map((t, i) => (
            <div key={i} style={{ display: "contents" }}>
              <span className={styles.tlAt}>{new Date(t.at).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
              <span className={t.tone === "ok" ? styles.ok : t.tone === "bad" ? styles.bad : undefined}>{t.text}</span>
            </div>
          ))}
        </div>
      )}
      <div className={styles.btns}>
        {st !== "open" && st !== "done" && (
          <button type="button" className={cn(styles.btn, styles.primary, arm && styles.armed)} disabled={busy} onClick={() => act("send")}>
            {arm ? "Нажмите ещё раз — отправить" : "Отправить в RBXRUBY сейчас"}
          </button>
        )}
        {st === "open" && <button type="button" className={cn(styles.btn, styles.danger)} disabled={busy} onClick={() => act("cancel")}>Отменить у RBXRUBY</button>}
        {st !== "open" && st !== "done" && (st === "excluded"
          ? <button type="button" className={styles.btn} disabled={busy} onClick={() => act("include")}>Снова можно в RBXRUBY</button>
          : <button type="button" className={styles.btn} disabled={busy} onClick={() => act("exclude")}>Не отдавать в RBXRUBY</button>)}
      </div>
    </div>
  );
}
