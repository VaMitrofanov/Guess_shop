"use client";
import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

interface CodesData {
  inventory: { denom: number; count: number }[];
  usedToday: number; usedWeek: number;
  chart: { date: string; count: number }[];
}

export default function CodesScreen({ token }: { token: string }) {
  const [data, setData] = useState<CodesData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/twa/codes", { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(setData).finally(() => setLoading(false));
  }, [token]);

  if (loading) return <div style={{ padding: 32, textAlign: "center", color: "#8e8e93" }}>Загрузка…</div>;
  if (!data)   return <div style={{ padding: 32, textAlign: "center", color: "#ff453a" }}>Ошибка загрузки</div>;

  const total = data.inventory.reduce((a, c) => a + c.count, 0);

  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {[
          { label: "Сегодня активаций", value: data.usedToday, accent: data.usedToday > 0 },
          { label: "За 7 дней", value: data.usedWeek },
        ].map(c => (
          <div key={c.label} style={{ background: "#2c2c2e", borderRadius: 12, padding: "12px 14px" }}>
            <div style={{ fontSize: 12, color: "#8e8e93" }}>{c.label}</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: c.accent ? "#bf5af2" : "#fff", marginTop: 4 }}>{c.value}</div>
          </div>
        ))}
      </div>

      <div style={{ background: "#2c2c2e", borderRadius: 12, padding: 16 }}>
        <div style={{ fontWeight: 600, marginBottom: 16 }}>Активации за 7 дней</div>
        <ResponsiveContainer width="100%" height={150}>
          <BarChart data={data.chart} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#3a3a3c" vertical={false} />
            <XAxis dataKey="date" tick={{ fill: "#8e8e93", fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: "#8e8e93", fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip contentStyle={{ background: "#3a3a3c", border: "none", borderRadius: 8, fontSize: 12 }} labelStyle={{ color: "#fff" }} />
            <Bar dataKey="count" name="Активаций" fill="#bf5af2" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div style={{ background: "#2c2c2e", borderRadius: 12, padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
          <span style={{ fontWeight: 600 }}>Остатки кодов</span>
          <span style={{ color: "#8e8e93", fontSize: 13 }}>Всего: {total} шт</span>
        </div>
        {data.inventory.length === 0
          ? <div style={{ color: "#ff453a", fontSize: 13, textAlign: "center", padding: "8px 0" }}>⚠️ Нет кодов!</div>
          : data.inventory.map(c => {
              const pct   = Math.min(100, (c.count / 50) * 100);
              const color = c.count < 5 ? "#ff453a" : c.count < 10 ? "#ffd60a" : "#30d158";
              return (
                <div key={c.denom} style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                    <span style={{ color: "#bf5af2", fontWeight: 600 }}>{c.denom} R$</span>
                    <span style={{ color, fontWeight: 600, fontSize: 13 }}>{c.count} шт</span>
                  </div>
                  <div style={{ background: "#3a3a3c", borderRadius: 4, height: 6 }}>
                    <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 4 }} />
                  </div>
                </div>
              );
            })
        }
      </div>
    </div>
  );
}
