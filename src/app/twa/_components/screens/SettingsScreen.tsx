"use client";
import { useEffect, useState, useCallback } from "react";

const C = {
  card: "#2c2c2e", elevated: "#3a3a3c", border: "#3a3a3c",
  accent: "#bf5af2", green: "#30d158", red: "#ff453a", yellow: "#ffd60a", orange: "#ff9f0a",
  sec: "#8e8e93", muted: "#48484a", bg: "#1c1c1e",
};

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
    <div style={{ fontSize: 12, fontWeight: 600, color: C.sec, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8, paddingLeft: 4 }}>
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
      onClick={() => onChange(!on)}
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
      onClick={onSave} disabled={saving}
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
        <div style={{ fontSize: 11, color: C.sec, marginTop: 2 }}>
          {bestRate
            ? `Лучший: $${bestRate.rateUSD}/1K · ${bestRate.provider} · ${bestRate.inventory.toLocaleString("ru-RU")} R$`
            : "Нет данных о рыночном курсе"}
          {pending > 0 && ` · ${pending} в очереди`}
        </div>
      </div>
    </div>
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
        <div style={{ fontSize: 11, color: C.sec, paddingLeft: 4, marginTop: 6 }}>
          buyer.py проверяет рынок каждые 60 сек. Выкупает когда курс ≤ целевого.
        </div>
      </section>

      {/* Rates */}
      <section>
        <SectionHeader title="Курсы" />
        <Card>
          <SettingRow label="Курс закупа (₽/R$)">
            <NumInput value={purchaseRateStr} onChange={setPurchaseRateStr} placeholder="авто" step={0.1} />
          </SettingRow>
          <SettingRow label="USD → RUB" last>
            <NumInput value={usdToRubStr} onChange={setUsdToRubStr} placeholder="90" step={1} />
          </SettingRow>
        </Card>
        {settings.purchaseRate === null && (
          <div style={{ fontSize: 11, color: C.sec, paddingLeft: 4, marginTop: 6 }}>
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
            onClick={() => onNavigate("system")}
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
              <div style={{ fontSize: 12, color: C.sec, marginTop: 2 }}>Серверы, БД, сервисы</div>
            </div>
            <span style={{ color: C.muted, fontSize: 18 }}>›</span>
          </button>
        </section>
      )}
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
    <div style={{ padding: 48, textAlign: "center", color: C.sec }}>
      <div style={{ fontSize: 28, marginBottom: 10 }}>⚠️</div>
      <div style={{ fontSize: 14, marginBottom: 16 }}>{msg}</div>
      <button
        onClick={onRetry}
        style={{ background: C.accent, border: "none", borderRadius: 10, color: "#fff", fontSize: 14, fontWeight: 600, padding: "10px 20px", cursor: "pointer" }}
      >Повторить</button>
    </div>
  );
}
