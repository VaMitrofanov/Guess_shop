"use client";
import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

interface DayData { date: string; count: number; sum: number }
interface DashData { daily: DayData[]; week: { orders: number; sum: number }; prevWeek: { orders: number; sum: number }; apiAvailable: boolean }

function rub(n: number) { return n.toLocaleString("ru-RU") + " ₽"; }

export default function DynamicsScreen({ token }: { token: string }) {
  const [data, setData] = useState<DashData | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"count" | "sum">("count");

  useEffect(() => {
    fetch("/api/twa/dashboard", { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(setData).finally(() => setLoading(false));
  }, [token]);

  if (loading) return <div style={{ padding: 32, textAlign: "center", color: "#8e8e93" }}>Загрузка…</div>;
  if (!data?.daily) return <div style={{ padding: 32, textAlign: "center", color: "#8e8e93" }}>Нет данных</div>;

  const pctDelta = (a: number, b: number) => { if (!b) return null; const d = Math.round(((a - b) / b) * 100); return { d, up: d >= 0 }; };
  const odelta = pctDelta(data.week.orders, data.prevWeek.orders);
  const sdelta = pctDelta(data.week.sum, data.prevWeek.sum);

  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div style={{ background: "#2c2c2e", borderRadius: 12, padding: "12px 14px" }}>
          <div style={{ fontSize: 12, color: "#8e8e93" }}>Заказов (7д)</div>
          <div style={{ fontSize: 22, fontWeight: 700, marginTop: 2 }}>{data.week.orders}</div>
          {odelta && <div style={{ fontSize: 12, color: odelta.up ? "#30d158" : "#ff453a", marginTop: 2 }}>{odelta.up ? "↑" : "↓"}{Math.abs(odelta.d)}% vs прошлой</div>}
        </div>
        <div style={{ background: "#2c2c2e", borderRadius: 12, padding: "12px 14px" }}>
          <div style={{ fontSize: 12, color: "#8e8e93" }}>Выручка (7д)</div>
          <div style={{ fontSize: 18, fontWeight: 700, marginTop: 2 }}>{rub(data.week.sum)}</div>
          {sdelta && <div style={{ fontSize: 12, color: sdelta.up ? "#30d158" : "#ff453a", marginTop: 2 }}>{sdelta.up ? "↑" : "↓"}{Math.abs(sdelta.d)}% vs прошлой</div>}
        </div>
      </div>

      <div style={{ background: "#2c2c2e", borderRadius: 12, padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontWeight: 600 }}>График 7 дней</div>
          <div style={{ display: "flex", gap: 4 }}>
            {(["count", "sum"] as const).map(v => (
              <button key={v} onClick={() => setView(v)} style={{
                padding: "4px 10px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 500,
                background: view === v ? "#bf5af2" : "#3a3a3c", color: view === v ? "#fff" : "#8e8e93",
              }}>{v === "count" ? "Шт" : "₽"}</button>
            ))}
          </div>
        </div>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={data.daily} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#3a3a3c" vertical={false} />
            <XAxis dataKey="date" tick={{ fill: "#8e8e93", fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: "#8e8e93", fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip
              contentStyle={{ background: "#3a3a3c", border: "none", borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: "#fff" }}
              formatter={(v) => { const n = Number(v ?? 0); return view === "sum" ? [rub(n), "Выручка"] : [n, "Заказов"]; }}
            />
            <Bar dataKey={view} fill="#bf5af2" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
