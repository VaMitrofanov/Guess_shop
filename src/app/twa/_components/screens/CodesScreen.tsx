"use client";
import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

interface CodesData {
  inventory: { denom: number; count: number }[];
  usedToday: number; usedWeek: number;
  chart: { date: string; count: number }[];
}

const C = {
  card: "#2c2c2e", elevated: "#3a3a3c", border: "#3a3a3c",
  accent: "#bf5af2", green: "#30d158", red: "#ff453a", yellow: "#ffd60a",
  sec: "#8e8e93", muted: "#48484a",
};

export default function CodesScreen({ token }: { token: string }) {
  const [data,    setData]    = useState<CodesData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/twa/codes", { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(setData).finally(() => setLoading(false));
  }, [token]);

  if (loading) return <Skeleton />;
  if (!data)   return (
    <div style={{ padding: 40, textAlign: "center" as const, color: "#8e8e93" }}>
      <div style={{ fontSize: 32, marginBottom: 8 }}>⚠️</div>
      <div style={{ fontSize: 14 }}>Ошибка загрузки</div>
    </div>
  );

  const total = data.inventory.reduce((a, c) => a + c.count, 0);

  return (
    <div style={{ padding: 16, paddingBottom: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {[
          { label: "Активаций сегодня", val: data.usedToday, accent: data.usedToday > 0 },
          { label: "За 7 дней",         val: data.usedWeek,  accent: false },
        ].map(c => (
          <div key={c.label} style={{ background: C.card, borderRadius: 14, padding: "14px 16px" }}>
            <div style={{ fontSize: 12, color: C.sec, marginBottom: 5 }}>{c.label}</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: c.accent ? C.accent : "#fff" }}>{c.val}</div>
          </div>
        ))}
      </div>

      {/* Chart */}
      <div style={{ background: C.card, borderRadius: 14, padding: 16 }}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 14 }}>Активации за 7 дней</div>
        <ResponsiveContainer width="100%" height={150}>
          <BarChart data={data.chart} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
            <XAxis dataKey="date" tick={{ fill: C.sec, fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: C.sec, fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip
              contentStyle={{ background: C.elevated, border: "none", borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: "#fff" }}
            />
            <Bar dataKey="count" name="Активаций" fill={C.accent} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Inventory */}
      <div style={{ background: C.card, borderRadius: 14, padding: "14px 16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>Остатки кодов</span>
          <span style={{ color: C.sec, fontSize: 13 }}>Всего: {total} шт</span>
        </div>

        {data.inventory.length === 0 ? (
          <div style={{ color: C.red, fontSize: 13, textAlign: "center" as const, padding: "8px 0" }}>⚠️ Нет кодов!</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {data.inventory.map(c => {
              const color = c.count < 5 ? C.red : c.count < 10 ? C.yellow : C.green;
              const pct   = Math.min(100, (c.count / 50) * 100);
              return (
                <div key={c.denom}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ color: C.accent, fontWeight: 600, fontSize: 15 }}>{c.denom} R$</span>
                    <span style={{ color, fontWeight: 600, fontSize: 13 }}>{c.count} шт</span>
                  </div>
                  <div style={{ background: C.elevated, borderRadius: 4, height: 5 }}>
                    <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 4 }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function Skeleton() {
  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      {[76, 170, 200].map((h, i) => (
        <div key={i} style={{ background: "#2c2c2e", borderRadius: 14, height: h, animation: "pulse 1.5s ease-in-out infinite" }} />
      ))}
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}`}</style>
    </div>
  );
}
