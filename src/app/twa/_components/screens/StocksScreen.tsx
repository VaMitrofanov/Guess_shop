"use client";
import { useEffect, useState } from "react";

interface StockItem {
  article: string; quantity: number; quantityFull: number;
  inWayToClient: number; inWayFromClient: number;
  avgDailySales: number; runwayDays: number; price: number;
}

function runway(d: number): { color: string; label: string } {
  if (d > 998) return { color: "#30d158", label: "∞" };
  if (d >= 14) return { color: "#30d158", label: `${d}д` };
  if (d >= 7)  return { color: "#ffd60a", label: `${d}д` };
  if (d > 0)   return { color: "#ff453a", label: `${d}д ⚠️` };
  return { color: "#636366", label: "0д" };
}

export default function StocksScreen({ token }: { token: string }) {
  const [data, setData] = useState<StockItem[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/twa/stocks", { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(setData).finally(() => setLoading(false));
  }, [token]);

  if (loading) return <div style={{ padding: 32, textAlign: "center", color: "#8e8e93" }}>Загрузка…</div>;
  if (!data)   return <div style={{ padding: 32, textAlign: "center", color: "#ff453a" }}>Ошибка загрузки</div>;

  const total    = data.reduce((a, s) => a + s.quantity, 0);
  const toClient = data.reduce((a, s) => a + s.inWayToClient, 0);
  const fromClient = data.reduce((a, s) => a + s.inWayFromClient, 0);

  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ background: "#2c2c2e", borderRadius: 12, padding: "12px 16px", display: "flex", justifyContent: "space-between" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 11, color: "#8e8e93" }}>На складе</div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{total}</div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 11, color: "#8e8e93" }}>→ Клиентам</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#ffd60a" }}>{toClient}</div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 11, color: "#8e8e93" }}>← Возвраты</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#ff9f0a" }}>{fromClient}</div>
        </div>
      </div>

      {data.map(s => {
        const r     = runway(s.runwayDays);
        const pct   = s.quantity > 0 && s.runwayDays < 999 ? Math.min(100, (s.runwayDays / 30) * 100) : 100;
        return (
          <div key={s.article} style={{ background: "#2c2c2e", borderRadius: 12, padding: "14px 16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 15 }}>{s.article}</div>
                <div style={{ fontSize: 12, color: "#8e8e93", marginTop: 2 }}>
                  {s.price > 0 ? `${s.price.toLocaleString("ru-RU")} ₽  ·  ` : ""}ср/д: {s.avgDailySales} шт
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{s.quantity}</div>
                <div style={{ fontSize: 11, color: "#8e8e93" }}>шт</div>
              </div>
            </div>

            {/* Runway bar */}
            <div style={{ background: "#3a3a3c", borderRadius: 4, height: 6, overflow: "hidden" }}>
              <div style={{ width: `${pct}%`, height: "100%", background: r.color, borderRadius: 4, transition: "width 0.3s" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 12 }}>
              <span style={{ color: "#8e8e93" }}>Осталось: <span style={{ color: r.color, fontWeight: 600 }}>{r.label}</span></span>
              {(s.inWayToClient > 0 || s.inWayFromClient > 0) && (
                <span style={{ color: "#8e8e93" }}>
                  {s.inWayToClient > 0 ? `✈️ ${s.inWayToClient}` : ""}
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
