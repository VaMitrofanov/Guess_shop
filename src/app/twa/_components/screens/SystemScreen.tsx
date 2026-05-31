"use client";
import { useEffect, useState, useCallback } from "react";

const C = {
  card: "#2c2c2e", elevated: "#3a3a3c", border: "#3a3a3c",
  accent: "#bf5af2", green: "#30d158", red: "#ff453a",
  yellow: "#ffd60a", orange: "#ff9f0a",
  sec: "#8e8e93", muted: "#48484a", bg: "#1c1c1e",
};

interface ServiceCheck { name: string; icon: string; ok: boolean; ms: number }

interface HetznerServer {
  name: string; status: string; city: string;
  cores: number; memory: number; monthlyEur: number;
}

interface ServerProvider {
  provider: string;
  balance?: number; currency?: string; daysLeft?: number;
  monthlyEur?: number; daysUntilBill?: number;
  servers?: HetznerServer[];
}

interface NeonStats {
  sizeMB: number; orderCount: number; unusedCodes: number;
  activeConnections: number; daysUntilBill: number; nextBillDate: string;
}

interface SystemData {
  services: ServiceCheck[];
  providers: ServerProvider[];
  neon: NeonStats | null;
  lastOrderMinAgo: number | null;
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div style={{ fontSize: 12, fontWeight: 600, color: C.sec, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 10, paddingLeft: 4 }}>
      {title}
    </div>
  );
}

function Pulse({ ok }: { ok: boolean }) {
  return (
    <div style={{ position: "relative", width: 10, height: 10, flexShrink: 0 }}>
      <div style={{
        position: "absolute", inset: 0, borderRadius: "50%",
        background: ok ? C.green : C.red,
        animation: ok ? "pulse-green 2s infinite" : "pulse-red 1.5s infinite",
      }} />
    </div>
  );
}

function ServiceRow({ svc, last }: { svc: ServiceCheck; last: boolean }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12,
      padding: "13px 16px",
      borderBottom: last ? "none" : `1px solid ${C.border}`,
    }}>
      <Pulse ok={svc.ok} />
      <span style={{ fontSize: 15, color: "#e5e5ea", flex: 1 }}>{svc.name}</span>
      <span style={{ fontSize: 13, color: svc.ok ? C.green : C.red, fontVariantNumeric: "tabular-nums" }}>
        {svc.ok ? `${svc.ms}ms` : "offline"}
      </span>
    </div>
  );
}

function HetznerCard({ provider }: { provider: ServerProvider }) {
  const warn = (provider.daysUntilBill ?? 99) <= 5;
  return (
    <div style={{ background: C.card, borderRadius: 14, overflow: "hidden" }}>
      <div style={{ padding: "13px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 15 }}>🇩🇪</span>
          <span style={{ fontSize: 15, fontWeight: 600, color: "#e5e5ea" }}>Hetzner</span>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: warn ? C.orange : "#e5e5ea" }}>
            €{provider.monthlyEur?.toFixed(2)}/мес
          </div>
          <div style={{ fontSize: 11, color: warn ? C.orange : C.sec }}>
            оплата через {provider.daysUntilBill}д{warn ? " ⚠️" : ""}
          </div>
        </div>
      </div>
      {provider.servers?.map((srv, i) => (
        <div key={srv.name} style={{
          padding: "11px 16px", display: "flex", alignItems: "center", gap: 10,
          borderBottom: i < (provider.servers!.length - 1) ? `1px solid ${C.border}` : "none",
        }}>
          <Pulse ok={srv.status === "running"} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, color: "#e5e5ea", fontWeight: 500 }}>{srv.name}</div>
            <div style={{ fontSize: 11, color: C.sec }}>{srv.city} · {srv.cores}vCPU · {srv.memory}GB</div>
          </div>
          <span style={{ fontSize: 12, color: C.sec }}>€{srv.monthlyEur.toFixed(2)}</span>
        </div>
      ))}
    </div>
  );
}

function VdsinaCard({ provider }: { provider: ServerProvider }) {
  const warn = (provider.daysLeft ?? 99) <= 10;
  return (
    <div style={{ background: C.card, borderRadius: 14, padding: "14px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 15 }}>🇷🇺</span>
          <span style={{ fontSize: 15, fontWeight: 600, color: "#e5e5ea" }}>VDSina</span>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: warn ? C.orange : "#e5e5ea" }}>
            {provider.balance?.toFixed(0)}{provider.currency}
          </div>
          {provider.daysLeft != null && (
            <div style={{ fontSize: 11, color: warn ? C.orange : C.sec }}>
              ~{provider.daysLeft}д до конца{warn ? " ⚠️" : ""}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function NeonCard({ neon }: { neon: NeonStats }) {
  const warn = neon.daysUntilBill <= 5;
  const sizeStr = neon.sizeMB >= 100 ? `${(neon.sizeMB / 1024).toFixed(2)} GB` : `${neon.sizeMB.toFixed(0)} MB`;
  return (
    <div style={{ background: C.card, borderRadius: 14, overflow: "hidden" }}>
      <div style={{ padding: "13px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 15 }}>🐘</span>
          <span style={{ fontSize: 15, fontWeight: 600, color: "#e5e5ea" }}>Neon Postgres</span>
        </div>
        <div style={{ fontSize: 12, color: warn ? C.orange : C.sec }}>
          оплата {neon.nextBillDate}{warn ? " ⚠️" : ""}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 0 }}>
        {[
          { label: "Размер", value: sizeStr },
          { label: "Заказов", value: String(neon.orderCount) },
          { label: "Кодов", value: String(neon.unusedCodes) },
          { label: "Конн.", value: String(neon.activeConnections) },
        ].map((m, i) => (
          <div key={i} style={{ padding: "12px 8px", textAlign: "center", borderRight: i < 3 ? `1px solid ${C.border}` : "none" }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#e5e5ea" }}>{m.value}</div>
            <div style={{ fontSize: 10, color: C.sec, marginTop: 3 }}>{m.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function SystemScreen({ token }: { token: string }) {
  const [data, setData] = useState<SystemData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const r = await fetch("/api/twa/system", { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) { setError("Ошибка загрузки"); return; }
      setData(await r.json());
      setError("");
    } catch { setError("Нет соединения"); }
    finally { setLoading(false); setRefreshing(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <Skeleton />;
  if (error) return <ErrorState msg={error} onRetry={() => load()} />;
  if (!data) return null;

  const allOk = data.services.every(s => s.ok);

  return (
    <div style={{ padding: "16px 16px 32px", display: "flex", flexDirection: "column", gap: 20, overflowY: "auto", height: "100%" }}>
      <style>{`
        @keyframes pulse-green { 0%,100%{opacity:1} 50%{opacity:0.5} }
        @keyframes pulse-red   { 0%,100%{opacity:1} 50%{opacity:0.3} }
      `}</style>

      {/* Header status pill */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        background: allOk ? "rgba(48,209,88,0.08)" : "rgba(255,69,58,0.08)",
        border: `1px solid ${allOk ? "rgba(48,209,88,0.2)" : "rgba(255,69,58,0.2)"}`,
        borderRadius: 14, padding: "12px 16px",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 20 }}>{allOk ? "✅" : "⚠️"}</span>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: allOk ? C.green : C.red }}>
              {allOk ? "Все системы работают" : "Есть проблемы"}
            </div>
            {data.lastOrderMinAgo != null && (
              <div style={{ fontSize: 12, color: C.sec, marginTop: 2 }}>
                Последний заказ: {data.lastOrderMinAgo < 60 ? `${data.lastOrderMinAgo} мин назад` : `${Math.floor(data.lastOrderMinAgo / 60)}ч назад`}
              </div>
            )}
          </div>
        </div>
        <button
          onClick={() => load(true)} disabled={refreshing}
          style={{
            background: "none", border: "none", fontSize: 20, cursor: "pointer",
            color: refreshing ? C.muted : C.accent,
            transform: refreshing ? "rotate(180deg)" : "none",
            transition: "transform 0.3s",
          }}
        >↻</button>
      </div>

      {/* Services */}
      <section>
        <SectionHeader title="Сервисы" />
        <div style={{ background: C.card, borderRadius: 14, overflow: "hidden" }}>
          {data.services.map((svc, i) => (
            <ServiceRow key={svc.name} svc={svc} last={i === data.services.length - 1} />
          ))}
        </div>
      </section>

      {/* Servers */}
      {data.providers.length > 0 && (
        <section>
          <SectionHeader title="Серверы" />
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {data.providers.map(p =>
              p.provider === "hetzner" ? <HetznerCard key={p.provider} provider={p} />
                : <VdsinaCard key={p.provider} provider={p} />
            )}
          </div>
        </section>
      )}

      {/* Database */}
      {data.neon && (
        <section>
          <SectionHeader title="База данных" />
          <NeonCard neon={data.neon} />
        </section>
      )}
    </div>
  );
}

function Skeleton() {
  return (
    <div style={{ padding: "16px 16px", display: "flex", flexDirection: "column", gap: 16 }}>
      {[72, 160, 100, 80].map((h, i) => (
        <div key={i} style={{
          background: C.card, borderRadius: 14, height: h,
          animation: "pulse 1.5s ease-in-out infinite",
        }} />
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
        style={{
          background: C.accent, border: "none", borderRadius: 10,
          color: "#fff", fontSize: 14, fontWeight: 600, padding: "10px 20px", cursor: "pointer",
        }}
      >Повторить</button>
    </div>
  );
}
