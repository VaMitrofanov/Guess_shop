"use client";
import { useEffect, useState } from "react";

interface StockItem {
  article: string; quantity: number; quantityFull: number;
  inWayToClient: number; inWayFromClient: number;
  avgDailySales: number; runwayDays: number; price: number;
}

const C = {
  card: "#2c2c2e", elevated: "#3a3a3c", border: "#3a3a3c",
  accent: "#bf5af2", green: "#30d158", red: "#ff453a", yellow: "#ffd60a",
  sec: "#8e8e93", muted: "#48484a",
};

function runwayInfo(d: number): { color: string; label: string } {
  if (d > 998) return { color: C.green,  label: "∞" };
  if (d >= 14) return { color: C.green,  label: `${d}д` };
  if (d >= 7)  return { color: C.yellow, label: `${d}д` };
  if (d > 0)   return { color: C.red,    label: `${d}д ⚠️` };
  return        { color: "#636366",      label: "0д" };
}

export default function StocksScreen({ token }: { token: string }) {
  const [data,    setData]    = useState<StockItem[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/twa/stocks", { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(setData).finally(() => setLoading(false));
  }, [token]);

  if (loading) return <Skeleton />;
  if (!data)   return (
    <div style={{ padding: 40, textAlign: "center" as const, color: C.red }}>
      <div style={{ fontSize: 32, marginBottom: 8 }}>⚠️</div>
      <div style={{ fontSize: 14 }}>Ошибка загрузки</div>
    </div>
  );

  const total      = data.reduce((a, s) => a + s.quantity,        0);
  const toClient   = data.reduce((a, s) => a + s.inWayToClient,   0);
  const fromClient = data.reduce((a, s) => a + s.inWayFromClient, 0);

  return (
    <div style={{ padding: 16, paddingBottom: 24, display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Summary row */}
      <div style={{ background: C.card, borderRadius: 14, padding: "14px 16px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, textAlign: "center" as const }}>
          {[
            { label: "На складе",    val: total,      color: "#fff"    },
            { label: "→ Клиентам",   val: toClient,   color: C.yellow  },
            { label: "← Возвраты",  val: fromClient,  color: C.red     },
          ].map(c => (
            <div key={c.label}>
              <div style={{ fontSize: 11, color: C.sec, marginBottom: 4 }}>{c.label}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: c.color }}>{c.val}</div>
            </div>
          ))}
        </div>
      </div>

      {data.map(s => {
        const r   = runwayInfo(s.runwayDays);
        const pct = s.quantity > 0 && s.runwayDays < 999 ? Math.min(100, (s.runwayDays / 30) * 100) : 100;
        return (
          <div key={s.article} style={{ background: C.card, borderRadius: 14, padding: "14px 16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 16 }}>{s.article} R$</div>
                <div style={{ fontSize: 12, color: C.sec, marginTop: 3 }}>
                  {s.price > 0 ? `${s.price.toLocaleString("ru-RU")} ₽  ·  ` : ""}
                  ср/д: {s.avgDailySales} шт
                </div>
              </div>
              <div style={{ textAlign: "right" as const }}>
                <div style={{ fontSize: 24, fontWeight: 700 }}>{s.quantity}</div>
                <div style={{ fontSize: 11, color: C.sec }}>шт</div>
              </div>
            </div>

            <div style={{ background: C.elevated, borderRadius: 4, height: 6, overflow: "hidden" }}>
              <div style={{ width: `${pct}%`, height: "100%", background: r.color, borderRadius: 4, transition: "width 0.3s" }} />
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 7, fontSize: 12 }}>
              <span style={{ color: C.sec }}>
                Запас: <span style={{ color: r.color, fontWeight: 600 }}>{r.label}</span>
              </span>
              {(s.inWayToClient > 0 || s.inWayFromClient > 0) && (
                <span style={{ color: C.sec }}>
                  {s.inWayToClient   > 0 ? `✈️ ${s.inWayToClient}`   : ""}
                  {s.inWayFromClient > 0 ? ` 🔄 ${s.inWayFromClient}` : ""}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Skeleton() {
  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      {[80, 100, 100, 100].map((h, i) => (
        <div key={i} style={{ background: "#2c2c2e", borderRadius: 14, height: h, animation: "pulse 1.5s ease-in-out infinite" }} />
      ))}
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}`}</style>
    </div>
  );
}
