"use client";

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { RBXRUBY_MODE_LABEL, fmtUsd, nextLine, stockSpark, type RbxrubyOverviewView, type RbxrubyOrderView } from "@/lib/rbxruby-view";
import styles from "./rbxruby.module.css";

const num = (n: number) => n.toLocaleString("ru-RU");
const API = "/api/admin/rbxruby";

async function post(body: Record<string, unknown>): Promise<{ ok: boolean; message?: string; error?: string }> {
  const res = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, ...data };
}

/** Плашка RBXRUBY над «Первым делом»: режим, баланс, сток, сутки/неделя. */
export default function RbxrubyPanel({ onToast, onChanged }: { onToast: (text: string, error?: boolean) => void; onChanged?: () => void }) {
  const [data, setData] = useState<RbxrubyOverviewView | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetch(API, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => d && setData(d)).catch(() => {});
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  const setMode = async (mode: "on" | "dry" | "off") => {
    if (mode === "on" && !window.confirm("Включить выкуп через RBXRUBY? Заказы начнут уходить и списывать деньги с баланса.")) return;
    setBusy(true);
    const r = await post({ action: "mode", mode });
    setBusy(false);
    if (!r.ok) return onToast(r.error ?? "не получилось", true);
    onToast(`RBXRUBY: ${RBXRUBY_MODE_LABEL[mode]}`);
    load();
    onChanged?.();
  };

  if (!data || !data.configured) return null;
  const modeCls = data.mode === "on" ? styles.modeOn : data.mode === "dry" ? styles.modeDry : styles.modeOff;
  const cheap = data.balance != null ? Math.floor(data.balance / ((715 / 1000) * data.maxRate)) : null;

  return (
    <section className={styles.panel} aria-label="Автовыкуп RBXRUBY">
      <div className={styles.head}>
        <div className={styles.title}>
          RBXRUBY
          <span className={cn(styles.mode, modeCls)}>{data.envOff ? "ВЫКЛ рубильником" : RBXRUBY_MODE_LABEL[data.mode]}</span>
        </div>
        <div className={styles.sub}>
          Автовыкуп · раз в минуту · порядок «Первым делом» · курс до {data.maxRate}
          {data.modeBy ? ` · режим: ${data.modeBy}` : ""}
        </div>
        {!data.envOff && (
          <div className={styles.btns}>
            {data.mode !== "on" && <button type="button" className={cn(styles.btn, styles.primary)} disabled={busy} onClick={() => setMode("on")}>Включить выкуп</button>}
            {data.mode !== "dry" && <button type="button" className={styles.btn} disabled={busy} onClick={() => setMode("dry")}>Тест</button>}
            {data.mode !== "off" && <button type="button" className={cn(styles.btn, data.mode === "on" && styles.danger)} disabled={busy} onClick={() => setMode("off")}>Пауза</button>}
          </div>
        )}
      </div>
      <div className={styles.stat}>
        <span className={styles.label}>Баланс</span>
        <span className={styles.value}>{fmtUsd(data.balance)}</span>
        <span className={styles.hint}>{cheap != null ? `≈ ${cheap} пассов по 715 R$` : "ещё не загружен"}</span>
      </div>
      <div className={styles.stat}>
        <span className={styles.label}>Продавцы ≤ {data.maxRate}</span>
        <span className={styles.value}>{num(data.stockUsable)} R$</span>
        <span className={styles.hint}>
          {data.stockLines.map((l) => `${l.rate} — ${num(l.robux)}`).join(" · ") || "пусто"} · один до {num(data.maxInstant)}
        </span>
      </div>
      <div className={styles.stat}>
        <span className={styles.label}>За сутки</span>
        <span className={styles.value}>{data.day.completed} выкуплено</span>
        <span className={styles.hint}>
          {data.day.inFlight} в полёте · {data.day.failed} вернулось · {fmtUsd(data.day.usd)} · {num(data.day.robux)} R$
        </span>
      </div>
      <div className={styles.stat}>
        <span className={styles.label}>За неделю</span>
        <span className={styles.value}>{data.week.completed} · {fmtUsd(data.week.usd)}</span>
        <span className={styles.hint}>
          {num(data.week.robux)} R${data.week.avgRate ? ` · средний курс ${data.week.avgRate}` : ""}
          {data.next.length ? ` · следующие: ${data.next.map(nextLine).join(", ")}` : ""}
        </span>
      </div>
      {data.lastError && <div className={styles.err}>Последняя ошибка: {data.lastError}</div>}
      <details className={styles.offers}>
        <summary>
          Предложения · {data.offers.length} курсов · один продавец до {num(data.maxInstant)} R$
          {data.snapshotAt ? ` · ${new Date(data.snapshotAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}` : ""}
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
    </section>
  );
}

/** Блок RBXRUBY в досье заказа: состояние, хроника, кнопки. */
export function RbxrubyOrderBox({ orderId, onToast, onChanged }: { orderId: string; onToast: (text: string, error?: boolean) => void; onChanged?: () => void }) {
  const [data, setData] = useState<RbxrubyOrderView | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    fetch(`${API}?orderId=${encodeURIComponent(orderId)}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => d && setData(d)).catch(() => {});
  }, [orderId]);
  useEffect(load, [load]);

  const act = async (action: "send" | "cancel" | "exclude" | "include") => {
    if (action === "send" && !window.confirm("Отправить заказ в RBXRUBY сейчас? Деньги зарезервируются с баланса.")) return;
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
          <button type="button" className={cn(styles.btn, styles.primary)} disabled={busy} onClick={() => act("send")}>Отправить в RBXRUBY сейчас</button>
        )}
        {st === "open" && <button type="button" className={cn(styles.btn, styles.danger)} disabled={busy} onClick={() => act("cancel")}>Отменить у RBXRUBY</button>}
        {st !== "open" && st !== "done" && (st === "excluded"
          ? <button type="button" className={styles.btn} disabled={busy} onClick={() => act("include")}>Снова можно в RBXRUBY</button>
          : <button type="button" className={styles.btn} disabled={busy} onClick={() => act("exclude")}>Не отдавать в RBXRUBY</button>)}
      </div>
    </div>
  );
}
