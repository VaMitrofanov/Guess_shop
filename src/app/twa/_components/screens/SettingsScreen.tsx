"use client";
import { C } from "../theme";
import { useEffect, useState, useCallback } from "react";
import { haptic } from "../haptics";

interface Settings {
  purchaseRate:   number | null;
  usdToRub:       number;
  autoBuyEnabled: boolean;
  autoBuyRate:    number;
  bestRate:       { rateUSD: number; provider: string; inventory: number } | null;
  pendingOrders:  number;
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div style={{ fontSize: 12, fontWeight: 600, color: C.textSecondary, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8, paddingLeft: 4 }}>
      {title}
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div style={{ background: C.card, borderRadius: 14, overflow: "hidden" }}>{children}</div>;
}

function RowSep() {
  return <div style={{ height: 1, background: C.border, marginLeft: 16 }} />;
}

function SettingRow({ label, children, last = false }: { label: string; children: React.ReactNode; last?: boolean }) {
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 16px", gap: 12 }}>
        <span style={{ fontSize: 15, color: "#e5e5ea", flex: 1 }}>{label}</span>
        {children}
      </div>
      {!last && <RowSep />}
    </>
  );
}

function NumInput({ value, onChange, placeholder, step = 0.1 }: { value: string; onChange: (v: string) => void; placeholder?: string; step?: number }) {
  return (
    <input
      type="number" inputMode="decimal" value={value} onChange={e => onChange(e.target.value)}
      placeholder={placeholder} step={step}
      style={{
        background: C.elevated, border: "none", borderRadius: 8,
        color: "#fff", fontSize: 15, padding: "6px 10px",
        width: 90, textAlign: "right", outline: "none", WebkitAppearance: "none",
      }}
    />
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div
      className="twa-press-sm"
      onClick={() => { haptic.impact("rigid"); onChange(!on); }}
      style={{
        width: 51, height: 31, borderRadius: 16, flexShrink: 0,
        background: on ? C.green : C.elevated,
        position: "relative", cursor: "pointer", transition: "background 0.2s",
      }}
    >
      <div style={{
        position: "absolute", top: 2, left: on ? 22 : 2,
        width: 27, height: 27, borderRadius: "50%",
        background: "#fff", transition: "left 0.2s",
        boxShadow: "0 1px 4px rgba(0,0,0,0.3)",
      }} />
    </div>
  );
}

function SaveBtn({ onSave, saving, saved }: { onSave: () => void; saving: boolean; saved: boolean }) {
  return (
    <button
      className="twa-press"
      onClick={() => { if (!saving) { haptic.impact("medium"); onSave(); } }} disabled={saving}
      style={{
        background: saved ? C.green : C.accent, border: "none", borderRadius: 12,
        color: "#fff", fontSize: 15, fontWeight: 600, padding: "13px",
        cursor: saving ? "default" : "pointer", opacity: saving ? 0.7 : 1,
        transition: "background 0.3s", width: "100%",
      }}
    >
      {saving ? "Сохранение…" : saved ? "✓ Сохранено" : "Сохранить"}
    </button>
  );
}

function StatusPill({ enabled, bestRate, targetRate, pending }: {
  enabled: boolean; bestRate: Settings["bestRate"]; targetRate: number; pending: number;
}) {
  const conditionMet = bestRate && bestRate.rateUSD <= targetRate;
  return (
    <div style={{
      background: enabled
        ? conditionMet ? "rgba(48,209,88,0.08)" : "rgba(191,90,242,0.08)"
        : "rgba(142,142,147,0.08)",
      border: `1px solid ${enabled
        ? conditionMet ? "rgba(48,209,88,0.2)" : "rgba(191,90,242,0.15)"
        : "rgba(142,142,147,0.15)"}`,
      borderRadius: 12, padding: "10px 14px",
      display: "flex", alignItems: "center", gap: 10,
    }}>
      <div style={{
        width: 8, height: 8, borderRadius: "50%",
        background: enabled ? (conditionMet ? C.green : C.accent) : C.muted,
        boxShadow: enabled ? `0 0 6px ${conditionMet ? C.green : C.accent}` : "none",
      }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, color: "#e5e5ea", fontWeight: 500 }}>
          {!enabled ? "Автобай выключен" : conditionMet ? "Условие выполнено — выкупает" : "Ожидание подходящего курса"}
        </div>
        <div style={{ fontSize: 11, color: C.textSecondary, marginTop: 2 }}>
          {bestRate
            ? `Лучший: $${bestRate.rateUSD}/1K · ${bestRate.provider} · ${bestRate.inventory.toLocaleString("ru-RU")} R$`
            : "Нет данных о рыночном курсе"}
          {pending > 0 && ` · ${pending} в очереди`}
        </div>
      </div>
    </div>
  );
}

/* ───────────── Test codes — list + one-tap reset, for QA runs ───────────── */
interface TestCode {
  code: string;
  denomination: number;
  passPrice: number;
  exists: boolean;
  status: "AVAILABLE" | "RESERVED" | "CLAIMED" | null;
  isUsed: boolean;
}

const TC_STATUS: Record<string, { label: string; color: string }> = {
  AVAILABLE: { label: "Свободен", color: C.green  },
  RESERVED:  { label: "Резерв",   color: C.yellow },
  CLAIMED:   { label: "Занят",    color: C.orange },
};

function TestCodesSection({ token }: { token: string }) {
  const [codes, setCodes]   = useState<TestCode[] | null>(null);
  const [busy, setBusy]     = useState<string | null>(null); // a code, or "__ALL__"
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/twa/test-codes", { headers: { Authorization: `Bearer ${token}` } });
      if (r.ok) { const d = await r.json(); setCodes(d.codes ?? []); }
    } catch { /* keep prior state */ }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  async function reset(code?: string) {
    if (busy) return;
    setBusy(code ?? "__ALL__");
    haptic.impact("medium");
    try {
      const r = await fetch("/api/twa/test-codes", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset", ...(code ? { code } : {}) }),
      });
      if (r.ok) { haptic.notify("success"); await load(); }
      else haptic.notify("error");
    } catch { haptic.notify("error"); }
    finally { setBusy(null); }
  }

  function copy(code: string) {
    navigator.clipboard?.writeText(code).catch(() => {});
    haptic.impact("light");
    setCopied(code);
    setTimeout(() => setCopied(c => (c === code ? null : c)), 1400);
  }

  return (
    <section>
      <SectionHeader title="Тестовые коды" />
      <Card>
        {codes === null && (
          <div style={{ padding: "14px 16px", fontSize: 13, color: C.textSecondary }}>Загрузка…</div>
        )}
        {codes?.map((c, i) => {
          const meta = c.status ? TC_STATUS[c.status] : null;
          return (
            <div key={c.code}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 14px" }}>
                <button
                  className="twa-press-sm"
                  onClick={() => copy(c.code)}
                  style={{
                    background: "transparent", border: "none", padding: 0, cursor: "pointer",
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                    fontSize: 15, fontWeight: 700, letterSpacing: 1.4,
                    color: copied === c.code ? C.green : C.accent, whiteSpace: "nowrap",
                  }}
                >
                  {copied === c.code ? `✓ ${c.code}` : c.code}
                </button>
                <span style={{ flex: 1, fontSize: 12, color: C.textSecondary, whiteSpace: "nowrap" }}>
                  {c.denomination} → {c.passPrice} R$
                </span>
                <span style={{
                  fontSize: 11, fontWeight: 600,
                  color: meta?.color ?? C.muted,
                  background: `${meta?.color ?? C.muted}1f`,
                  borderRadius: 7, padding: "3px 8px", whiteSpace: "nowrap",
                }}>
                  {meta?.label ?? "Нет"}
                </span>
                <button
                  className="twa-press-sm"
                  onClick={() => reset(c.code)}
                  disabled={!!busy}
                  title="Сбросить этот код"
                  style={{
                    background: "transparent", border: "none", cursor: busy ? "default" : "pointer",
                    fontSize: 17, lineHeight: 1, color: C.textSecondary, padding: "2px 4px",
                    opacity: busy === c.code ? 0.4 : 1,
                  }}
                >
                  {busy === c.code ? "…" : "↻"}
                </button>
              </div>
              {i < codes.length - 1 && <RowSep />}
            </div>
          );
        })}
      </Card>
      <button
        className="twa-press"
        onClick={() => reset()}
        disabled={!!busy}
        style={{
          marginTop: 10, width: "100%", padding: "13px", borderRadius: 12, border: "none",
          background: C.accent, color: "#fff", fontSize: 15, fontWeight: 600,
          cursor: busy ? "default" : "pointer", opacity: busy === "__ALL__" ? 0.7 : 1,
        }}
      >
        {busy === "__ALL__" ? "Сбрасываю…" : "↻ Сбросить все тестовые коды"}
      </button>
      <div style={{ fontSize: 11, color: C.textSecondary, paddingLeft: 4, marginTop: 6 }}>
        Сброс → код снова свободен (AVAILABLE), его заявка удаляется. Тестовые коды (isTest) в статистику и остатки не попадают. Тапни код, чтобы скопировать.
      </div>
    </section>
  );
}

export default function SettingsScreen({ token, onNavigate }: { token: string; onNavigate?: (screen: string) => void }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [purchaseRateStr, setPurchaseRateStr] = useState("");
  const [usdToRubStr, setUsdToRubStr] = useState("");
  const [autoBuyEnabled, setAutoBuyEnabled] = useState(false);
  const [autoBuyRateStr, setAutoBuyRateStr] = useState("");

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveErr, setSaveErr] = useState("");

  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/twa/settings", { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) { setError("Ошибка загрузки"); return; }
      const d: Settings = await r.json();
      setSettings(d);
      setPurchaseRateStr(d.purchaseRate !== null ? String(d.purchaseRate) : "");
      setUsdToRubStr(String(d.usdToRub));
      setAutoBuyEnabled(d.autoBuyEnabled);
      setAutoBuyRateStr(String(d.autoBuyRate));
    } catch { setError("Ошибка сети"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function save() {
    setSaving(true); setSaveErr(""); setSaved(false);
    try {
      const purchaseRate = purchaseRateStr.trim() === "" ? null : parseFloat(purchaseRateStr);
      const usdToRub = parseFloat(usdToRubStr);
      const autoBuyRate = parseFloat(autoBuyRateStr);
      const r = await fetch("/api/twa/settings", {
        method: "POST", headers,
        body: JSON.stringify({ purchaseRate, usdToRub, autoBuyEnabled, autoBuyRate }),
      });
      const d = await r.json();
      if (!r.ok) { setSaveErr(d.error ?? "Ошибка"); return; }
      setSettings(s => s ? { ...s, ...d } : s);
      setSaved(true); setTimeout(() => setSaved(false), 2000);
    } catch { setSaveErr("Ошибка сети"); }
    finally { setSaving(false); }
  }

  if (loading) return <Skeleton />;
  if (error) return <ErrorState msg={error} onRetry={load} />;
  if (!settings) return null;

  return (
    <div style={{ padding: "16px 16px 32px", display: "flex", flexDirection: "column", gap: 22, overflowY: "auto", height: "100%" }}>

      {/* AutoBuy status */}
      <section>
        <SectionHeader title="Автобай" />
        <StatusPill
          enabled={autoBuyEnabled}
          bestRate={settings.bestRate}
          targetRate={parseFloat(autoBuyRateStr) || settings.autoBuyRate}
          pending={settings.pendingOrders}
        />
        <div style={{ marginTop: 10 }}>
          <Card>
            <SettingRow label="Включён">
              <Toggle on={autoBuyEnabled} onChange={setAutoBuyEnabled} />
            </SettingRow>
            <SettingRow label="Целевой курс ($/1K R$)" last>
              <NumInput value={autoBuyRateStr} onChange={setAutoBuyRateStr} placeholder="4.0" step={0.1} />
            </SettingRow>
          </Card>
        </div>
        <div style={{ fontSize: 11, color: C.textSecondary, paddingLeft: 4, marginTop: 6 }}>
          buyer.py проверяет рынок каждые 60 сек. Выкупает когда курс ≤ целевого.
        </div>
      </section>

      {/* Rates */}
      <section>
        <SectionHeader title="Курсы" />
        <Card>
          <SettingRow label="Курс закупа ($/1K R$)">
            <NumInput value={purchaseRateStr} onChange={setPurchaseRateStr} placeholder="авто" step={0.1} />
          </SettingRow>
          <SettingRow label="USD → RUB" last>
            <NumInput value={usdToRubStr} onChange={setUsdToRubStr} placeholder="90" step={1} />
          </SettingRow>
        </Card>
        {settings.purchaseRate === null && (
          <div style={{ fontSize: 11, color: C.textSecondary, paddingLeft: 4, marginTop: 6 }}>
            Курс закупа не задан — используется рыночный
          </div>
        )}
      </section>

      {/* Save */}
      <SaveBtn onSave={save} saving={saving} saved={saved} />

      {saveErr && (
        <div style={{ background: C.red + "22", color: C.red, borderRadius: 10, padding: "10px 14px", fontSize: 13 }}>
          ❌ {saveErr}
        </div>
      )}

      {/* System link */}
      {onNavigate && (
        <section>
          <SectionHeader title="Мониторинг" />
          <button
            className="twa-press"
            onClick={() => { haptic.select(); onNavigate("system"); }}
            style={{
              width: "100%", background: C.card, border: "none", borderRadius: 14,
              padding: "15px 16px", cursor: "pointer",
              display: "flex", alignItems: "center", gap: 12,
              WebkitTapHighlightColor: "transparent",
            }}
          >
            <span style={{ fontSize: 22 }}>🖥</span>
            <div style={{ flex: 1, textAlign: "left" }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: "#e5e5ea" }}>Состояние системы</div>
              <div style={{ fontSize: 12, color: C.textSecondary, marginTop: 2 }}>Серверы, БД, сервисы</div>
            </div>
            <span style={{ color: C.muted, fontSize: 18 }}>›</span>
          </button>
        </section>
      )}

      {/* Test codes — QA reset surface */}
      <TestCodesSection token={token} />
    </div>
  );
}

function Skeleton() {
  return (
    <div style={{ padding: "16px 16px", display: "flex", flexDirection: "column", gap: 20 }}>
      {[72, 100, 80, 48].map((h, i) => (
        <div key={i} style={{ background: C.card, borderRadius: 14, height: h, animation: "pulse 1.5s ease-in-out infinite" }} />
      ))}
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}`}</style>
    </div>
  );
}

function ErrorState({ msg, onRetry }: { msg: string; onRetry: () => void }) {
  return (
    <div style={{ padding: 48, textAlign: "center", color: C.textSecondary }}>
      <div style={{ fontSize: 28, marginBottom: 10 }}>⚠️</div>
      <div style={{ fontSize: 14, marginBottom: 16 }}>{msg}</div>
      <button
        onClick={onRetry}
        style={{ background: C.accent, border: "none", borderRadius: 10, color: "#fff", fontSize: 14, fontWeight: 600, padding: "10px 20px", cursor: "pointer" }}
      >Повторить</button>
    </div>
  );
}
