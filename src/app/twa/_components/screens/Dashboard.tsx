"use client";
import { useEffect, useState } from "react";

interface DashData {
  today:    { orders: number; sum: number; sales: number };
  week:     { orders: number; sum: number };
  prevWeek: { orders: number; sum: number };
  codes:    { denom: number; count: number }[];
  wbOrders: number;
  apiAvailable: boolean;
  tokenPresent?: boolean;
}

const C = {
  card: "#2c2c2e", elevated: "#3a3a3c", border: "#3a3a3c",
  accent: "#bf5af2", green: "#30d158", red: "#ff453a", yellow: "#ffd60a",
  sec: "#8e8e93", muted: "#48484a",
};

function rub(n: number) { return n.toLocaleString("ru-RU") + " ₽"; }
function delta(a: number, b: number): { text: string; color: string } | null {
  if (!b) return null;
  const d = Math.round(((a - b) / b) * 100);
  if (d === 0) return null;
  return { text: (d > 0 ? "↑" : "↓") + Math.abs(d) + "%", color: d > 0 ? C.green : C.red };
}

function MetricCard({ label, value, sub, subColor, accent }: {
  label: string; value: string | number; sub?: string; subColor?: string; accent?: boolean;
}) {
  return (
    <div style={{
      background: C.card, borderRadius: 14, padding: "14px 16px",
      borderLeft: accent ? `3px solid ${C.accent}` : "none",
    }}>
      <div style={{ fontSize: 12, color: C.sec, marginBottom: 5 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: accent ? C.accent : "#fff" }}>{value}</div>
      {sub && <div style={{ fontSize: 12, marginTop: 3, color: subColor ?? C.sec }}>{sub}</div>}
    </div>
  );
}

export default function Dashboard({ token }: { token: string }) {
  const [data,    setData]    = useState<DashData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/twa/dashboard", { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(setData).finally(() => setLoading(false));
  }, [token]);

  if (loading) return <Skeleton />;
  if (!data)   return <ErrorState />;

  const totalCodes = data.codes.reduce((a, c) => a + c.count, 0);
  const od = delta(data.week.orders, data.prevWeek.orders);
  const sd = delta(data.week.sum,    data.prevWeek.sum);

  return (
    <div style={{ padding: 16, paddingBottom: 24, display: "flex", flexDirection: "column", gap: 20 }}>
      {!data.apiAvailable && (
        <div style={{ background: "#2a2000", border: "1px solid #3d3000", borderRadius: 12, padding: "10px 14px", fontSize: 13, color: C.yellow }}>
          ⚠️ WB API недоступен — данные только из БД
          {data.tokenPresent === false && (
            <div style={{ fontSize: 11, marginTop: 3, color: "#ff9f0a" }}>WB_API_TOKEN не задан</div>
          )}
        </div>
      )}

      <section>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.sec, textTransform: "uppercase" as const, letterSpacing: 0.6, marginBottom: 10 }}>Сегодня</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <MetricCard label="Заказы"       value={data.today.orders} accent />
          <MetricCard label="Выручка"      value={rub(data.today.sum)} />
          <MetricCard
            label="FBS в работе"
            value={data.wbOrders}
            sub={data.wbOrders > 0 ? "нужна обработка" : "очередь пуста"}
            subColor={data.wbOrders > 0 ? C.yellow : C.muted}
          />
          <MetricCard label="Выкупов"      value={data.today.sales} />
        </div>
      </section>

      <section>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.sec, textTransform: "uppercase" as const, letterSpacing: 0.6, marginBottom: 10 }}>Неделя vs прошлая</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <MetricCard label="Заказов (7д)" value={data.week.orders} sub={od?.text} subColor={od?.color} />
          <MetricCard label="Выручка (7д)" value={rub(data.week.sum)} sub={sd?.text} subColor={sd?.color} />
        </div>
      </section>

      <section>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.sec, textTransform: "uppercase" as const, letterSpacing: 0.6, marginBottom: 10 }}>Коды WB</div>
        {data.codes.length === 0 ? (
          <div style={{ background: "#2a0808", border: "1px solid #3d1010", borderRadius: 14, padding: "14px 16px", color: C.red, fontSize: 14 }}>
            ⚠️ Коды закончились!
          </div>
        ) : (
          <div style={{ background: C.card, borderRadius: 14, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
            {data.codes.map(c => {
              const low   = c.count < 5;
              const color = low ? C.red : c.count < 10 ? C.yellow : C.green;
              const pct   = Math.min(100, (c.count / 30) * 100);
              return (
                <div key={c.denom}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <span style={{ color: C.accent, fontWeight: 600, fontSize: 15 }}>{c.denom} R$</span>
                    <span style={{ color, fontWeight: 600, fontSize: 13 }}>{c.count} шт{low ? " ⚠️" : ""}</span>
                  </div>
                  <div style={{ background: C.elevated, borderRadius: 4, height: 5 }}>
                    <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 4, transition: "width 0.3s" }} />
                  </div>
                </div>
              );
            })}
            <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 10, display: "flex", justifyContent: "space-between", color: C.sec, fontSize: 13 }}>
              <span>Итого кодов</span>
              <span style={{ fontWeight: 600, color: "#fff" }}>{totalCodes} шт</span>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function Skeleton() {
  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      {[120, 76, 76, 140].map((h, i) => (
        <div key={i} style={{ background: "#2c2c2e", borderRadius: 14, height: h, animation: "pulse 1.5s ease-in-out infinite" }} />
      ))}
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}`}</style>
    </div>
  );
}

function ErrorState() {
  return (
    <div style={{ padding: 40, textAlign: "center" as const, color: "#8e8e93" }}>
      <div style={{ fontSize: 32, marginBottom: 8 }}>⚠️</div>
      <div style={{ fontSize: 14 }}>Ошибка загрузки данных</div>
    </div>
  );
}
