"use client";
import { useEffect, useState } from "react";
import StatCard from "../StatCard";

interface DashData {
  today:    { orders: number; sum: number; sales: number };
  week:     { orders: number; sum: number };
  prevWeek: { orders: number; sum: number };
  codes:    { denom: number; count: number }[];
  wbOrders: number;
  apiAvailable: boolean;
}

function rub(n: number) { return n.toLocaleString("ru-RU") + " ₽"; }
function pct(a: number, b: number) { if (!b) return ""; const d = Math.round(((a - b) / b) * 100); return d > 0 ? ` ↑${d}%` : d < 0 ? ` ↓${Math.abs(d)}%` : ""; }

export default function Dashboard({ token }: { token: string }) {
  const [data, setData] = useState<DashData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/twa/dashboard", { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(setData).finally(() => setLoading(false));
  }, [token]);

  if (loading) return <LoadingState />;
  if (!data)   return <ErrorState />;

  const totalCodes = data.codes.reduce((a, c) => a + c.count, 0);

  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      {!data.apiAvailable && (
        <div style={{ background: "#3a2c00", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "#ffd60a" }}>
          ⚠️ WB API недоступен — данные только из БД
        </div>
      )}

      <div style={{ fontSize: 13, fontWeight: 600, color: "#8e8e93", textTransform: "uppercase", letterSpacing: 0.5 }}>Сегодня</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <StatCard title="Заказы" value={data.today.orders} accent />
        <StatCard title="Выручка" value={rub(data.today.sum)} />
        <StatCard title="Выкупов" value={data.today.sales} />
        <StatCard title="FBS в работе" value={data.wbOrders} sub={data.wbOrders > 0 ? "нужна обработка" : "очередь пуста"} />
      </div>

      <div style={{ fontSize: 13, fontWeight: 600, color: "#8e8e93", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 4 }}>Неделя vs прошлая</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <StatCard title="Заказов за 7д" value={data.week.orders} sub={pct(data.week.orders, data.prevWeek.orders)} />
        <StatCard title="Выручка 7д" value={rub(data.week.sum)} sub={pct(data.week.sum, data.prevWeek.sum)} />
      </div>

      <div style={{ fontSize: 13, fontWeight: 600, color: "#8e8e93", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 4 }}>Коды WB</div>
      {data.codes.length === 0
        ? <div style={{ background: "#3a1c1c", borderRadius: 12, padding: "14px 16px", color: "#ff453a", fontSize: 14 }}>⚠️ Коды закончились!</div>
        : <div style={{ background: "#2c2c2e", borderRadius: 12, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
            {data.codes.map(c => (
              <div key={c.denom} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ color: "#bf5af2", fontWeight: 600 }}>{c.denom} R$</span>
                <span style={{ background: c.count < 5 ? "#3a1c1c" : "#1c3a1c", color: c.count < 5 ? "#ff453a" : "#30d158", borderRadius: 8, padding: "2px 10px", fontSize: 13, fontWeight: 600 }}>{c.count} шт</span>
              </div>
            ))}
            <div style={{ borderTop: "1px solid #3a3a3c", paddingTop: 8, display: "flex", justifyContent: "space-between", color: "#8e8e93", fontSize: 13 }}>
              <span>Итого</span><span>{totalCodes} шт</span>
            </div>
          </div>
      }
    </div>
  );
}

function LoadingState() {
  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      {[...Array(4)].map((_, i) => (
        <div key={i} style={{ background: "#2c2c2e", borderRadius: 12, height: 76, animation: "pulse 1.5s ease-in-out infinite" }} />
      ))}
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
    </div>
  );
}

function ErrorState() {
  return (
    <div style={{ padding: 32, textAlign: "center", color: "#8e8e93" }}>
      <div style={{ fontSize: 32, marginBottom: 8 }}>⚠️</div>
      <div>Ошибка загрузки данных</div>
    </div>
  );
}
