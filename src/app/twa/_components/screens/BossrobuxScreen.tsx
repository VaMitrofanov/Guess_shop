"use client";
import { C } from "../theme";
import { useEffect, useState, useCallback } from "react";
import { haptic } from "../haptics";

interface AccountInfo {
  hasCookie:      boolean;
  cookieValid?:   boolean;
  cookieUpdatedAt: string | null;
  accountName:    string | null;
  accountId:      number | null;
  balance:        number | null;
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

function InfoRow({ label, value, last = false }: { label: string; value: React.ReactNode; last?: boolean }) {
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 16px", gap: 12 }}>
        <span style={{ fontSize: 15, color: C.textSecondary }}>{label}</span>
        <span style={{ fontSize: 15, color: "#e5e5ea", fontWeight: 500, fontFamily: "monospace", letterSpacing: 0.2 }}>{value}</span>
      </div>
      {!last && <div style={{ height: 1, background: C.border, marginLeft: 16 }} />}
    </>
  );
}

function StatusDot({ valid }: { valid: boolean }) {
  return (
    <span style={{
      display: "inline-block", width: 8, height: 8, borderRadius: "50%",
      background: valid ? C.green : C.red,
      boxShadow: `0 0 6px ${valid ? C.green : C.red}44`,
      marginRight: 8, verticalAlign: "middle",
    }} />
  );
}

function Skeleton() {
  return (
    <div style={{ padding: "16px 16px", display: "flex", flexDirection: "column", gap: 20 }}>
      {[72, 100, 60].map((h, i) => (
        <div key={i} style={{ background: C.card, borderRadius: 14, height: h, animation: "pulse 1.5s ease-in-out infinite" }} />
      ))}
    </div>
  );
}

function formatDate(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
}

export default function BossrobuxScreen({ token }: { token: string }) {
  const [info, setInfo] = useState<AccountInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const [cookieInput, setCookieInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const r = await fetch("/api/twa/roblox-account", { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) { setError("Ошибка загрузки"); return; }
      setInfo(await r.json());
    } catch { setError("Ошибка сети"); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function refreshBalance() {
    setRefreshing(true);
    try {
      const r = await fetch("/api/twa/roblox-account", {
        method: "POST", headers,
        body: JSON.stringify({ action: "refresh-balance" }),
      });
      const d = await r.json();
      if (!r.ok) {
        haptic.notify("error");
        setSaveMsg({ text: d.error ?? "Ошибка", ok: false });
        return;
      }
      setInfo(prev => prev ? { ...prev, accountName: d.accountName, accountId: d.accountId, balance: d.balance, cookieValid: true } : prev);
      haptic.notify("success");
    } catch { haptic.notify("error"); }
    finally { setRefreshing(false); }
  }

  async function saveCookie() {
    if (!cookieInput.trim()) return;
    setSaving(true); setSaveMsg(null);
    try {
      const r = await fetch("/api/twa/roblox-account", {
        method: "POST", headers,
        body: JSON.stringify({ action: "set-cookie", cookie: cookieInput.trim() }),
      });
      const d = await r.json();
      if (!r.ok) {
        haptic.notify("error");
        setSaveMsg({ text: d.error ?? "Ошибка", ok: false });
        return;
      }
      haptic.notify("success");
      setSaveMsg({ text: `Сохранено · ${d.accountName}`, ok: true });
      setCookieInput("");
      setInfo({
        hasCookie: true, cookieValid: true,
        cookieUpdatedAt: new Date().toISOString(),
        accountName: d.accountName, accountId: d.accountId, balance: d.balance,
      });
      setTimeout(() => setSaveMsg(null), 3000);
    } catch { haptic.notify("error"); setSaveMsg({ text: "Ошибка сети", ok: false }); }
    finally { setSaving(false); }
  }

  if (loading) return <Skeleton />;
  if (error) return (
    <div style={{ padding: 24, textAlign: "center" }}>
      <div style={{ color: C.red, fontSize: 14, marginBottom: 12 }}>{error}</div>
      <button className="twa-press" onClick={load} style={{
        background: C.card, border: "none", borderRadius: 10,
        color: C.accent, fontSize: 14, fontWeight: 600, padding: "10px 24px", cursor: "pointer",
      }}>Повторить</button>
    </div>
  );

  return (
    <div style={{ padding: "16px 16px 32px", display: "flex", flexDirection: "column", gap: 22, overflowY: "auto", height: "100%" }}>

      {/* Account info */}
      <section>
        <SectionHeader title="Roblox-аккаунт" />
        <Card>
          {info?.hasCookie ? (
            <>
              <div style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: 10 }}>
                <StatusDot valid={info.cookieValid !== false} />
                <span style={{ fontSize: 17, fontWeight: 600, color: "#e5e5ea" }}>
                  {info.accountName ?? "Неизвестный"}
                </span>
                {info.cookieValid === false && (
                  <span style={{ fontSize: 12, color: C.red, fontWeight: 500 }}>Cookie истёк</span>
                )}
              </div>
              <div style={{ height: 1, background: C.border, marginLeft: 16 }} />
              <InfoRow label="ID" value={info.accountId?.toLocaleString() ?? "—"} />
              <InfoRow label="Баланс" value={info.balance !== null ? `${info.balance.toLocaleString()} R$` : "—"} />
              <InfoRow label="Cookie обновлён" value={formatDate(info.cookieUpdatedAt)} last />
            </>
          ) : (
            <div style={{ padding: "20px 16px", textAlign: "center" }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>🔑</div>
              <div style={{ fontSize: 15, color: C.textSecondary }}>Cookie не задан</div>
              <div style={{ fontSize: 12, color: C.textTertiary, marginTop: 4 }}>Вставьте .ROBLOSECURITY ниже</div>
            </div>
          )}
        </Card>

        {info?.hasCookie && (
          <button
            className="twa-press"
            onClick={() => { haptic.impact("light"); refreshBalance(); }}
            disabled={refreshing}
            style={{
              marginTop: 10, width: "100%",
              background: C.card, border: "none", borderRadius: 12,
              color: C.accent, fontSize: 14, fontWeight: 600,
              padding: "12px", cursor: refreshing ? "default" : "pointer",
              opacity: refreshing ? 0.6 : 1,
            }}
          >
            {refreshing ? "Обновляю…" : "🔄 Обновить баланс"}
          </button>
        )}
      </section>

      {/* Set cookie */}
      <section>
        <SectionHeader title="Cookie" />
        <Card>
          <div style={{ padding: 12 }}>
            <textarea
              value={cookieInput}
              onChange={e => setCookieInput(e.target.value)}
              placeholder=".ROBLOSECURITY значение…"
              rows={3}
              style={{
                width: "100%", background: C.elevated, border: "none", borderRadius: 10,
                color: "#fff", fontSize: 13, padding: "10px 12px",
                resize: "vertical", outline: "none", fontFamily: "monospace",
                lineHeight: 1.4, boxSizing: "border-box",
              }}
            />
            <button
              className="twa-press"
              onClick={() => { haptic.impact("medium"); saveCookie(); }}
              disabled={saving || !cookieInput.trim()}
              style={{
                marginTop: 8, width: "100%",
                background: cookieInput.trim() ? C.green : C.elevated,
                border: "none", borderRadius: 10,
                color: "#fff", fontSize: 14, fontWeight: 600,
                padding: "12px", cursor: saving ? "default" : "pointer",
                opacity: saving || !cookieInput.trim() ? 0.5 : 1,
                transition: "background 0.2s, opacity 0.2s",
              }}
            >
              {saving ? "Проверяю…" : "💾 Сохранить cookie"}
            </button>
          </div>
        </Card>

        {saveMsg && (
          <div style={{
            marginTop: 8, padding: "10px 14px", borderRadius: 10,
            background: saveMsg.ok ? `${C.green}22` : `${C.red}22`,
            color: saveMsg.ok ? C.green : C.red,
            fontSize: 13, fontWeight: 500,
          }}>
            {saveMsg.ok ? "✅" : "❌"} {saveMsg.text}
          </div>
        )}

        <div style={{ fontSize: 11, color: C.textTertiary, paddingLeft: 4, marginTop: 6 }}>
          Cookie валидируется при сохранении. Обновляй когда меняешь аккаунт.
        </div>
      </section>
    </div>
  );
}
