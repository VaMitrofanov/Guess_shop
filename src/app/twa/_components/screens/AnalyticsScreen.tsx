"use client";
import { C } from "../theme";
import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

interface DayData  { date: string; count: number; sum: number }
interface DashData { daily: DayData[]; week: { orders: number; sum: number }; prevWeek: { orders: number; sum: number }; apiAvailable: boolean }
interface AdvertData {
  totalActive: number; totalPaused: number; totalBudget: number;
  totalSpend7d: number; totalViews7d: number; totalClicks7d: number; totalOrders7d: number;
  avgCtr: number; avgCpo: number;
  campaigns: { id: number; status: number; balance: number; spend7d: number; orders7d: number }[];
  empty?: boolean;
}


function rub(n: number) { return n.toLocaleString("ru-RU") + " ₽"; }
function pctDelta(a: number, b: number) {
  if (!b) return null;
  const d = Math.round(((a - b) / b) * 100);
  return { d, up: d >= 0 };
}

function DynamicsTab({ token }: { token: string }) {
  const [data,    setData]    = useState<DashData | null>(null);
  const [loading, setLoading] = useState(true);
  const [view,    setView]    = useState<"count" | "sum">("count");

  useEffect(() => {
    fetch("/api/twa/dashboard", { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(setData).finally(() => setLoading(false));
  }, [token]);

  if (loading) return <Skeleton />;
  if (!data?.daily) return <Empty text="Нет данных" />;

  const od = pctDelta(data.week.orders, data.prevWeek.orders);
  const sd = pctDelta(data.week.sum,    data.prevWeek.sum);

  return (
    <div style={{ padding: "12px 16px 0", display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {[
          { label: "Заказов (7д)", val: String(data.week.orders), delta: od },
          { label: "Выручка (7д)", val: rub(data.week.sum), delta: sd },
        ].map(c => (
          <div key={c.label} style={{ background: C.card, borderRadius: 12, padding: "12px 14px" }}>
            <div style={{ fontSize: 12, color: C.textSecondary }}>{c.label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, marginTop: 2 }}>{c.val}</div>
            {c.delta && (
              <div style={{ fontSize: 12, color: c.delta.up ? C.green : C.red, marginTop: 2 }}>
                {c.delta.up ? "↑" : "↓"}{Math.abs(c.delta.d)}% vs прошлой
              </div>
            )}
          </div>
        ))}
      </div>

      <div style={{ background: C.card, borderRadius: 12, padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>7 дней</span>
          <div style={{ display: "flex", background: C.elevated, borderRadius: 8, padding: 2, gap: 1 }}>
            {(["count", "sum"] as const).map(v => (
              <button key={v} onClick={() => setView(v)} style={{
                padding: "4px 12px", borderRadius: 6, border: "none", cursor: "pointer",
                fontSize: 12, fontWeight: 500,
                background: view === v ? C.accent : "none",
                color: view === v ? "#fff" : C.textSecondary,
              }}>{v === "count" ? "Шт" : "₽"}</button>
            ))}
          </div>
        </div>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={data.daily} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
            <XAxis dataKey="date" tick={{ fill: C.textSecondary, fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: C.textSecondary, fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip
              contentStyle={{ background: C.elevated, border: "none", borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: "#fff" }}
              formatter={(v) => {
                const n = Number(v ?? 0);
                return view === "sum" ? [rub(n), "Выручка"] : [n, "Заказов"];
              }}
            />
            <Bar dataKey={view} fill={C.accent} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function AdvertTab({ token }: { token: string }) {
  const [data,    setData]    = useState<AdvertData | null>(null);
  const [loading, setLoading] = useState(true);
  const [sub,     setSub]     = useState<"summary" | "campaigns">("summary");

  useEffect(() => {
    fetch("/api/twa/advert", { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(setData).finally(() => setLoading(false));
  }, [token]);

  if (loading) return <Skeleton />;
  if (!data || data.empty) return <Empty text="Нет активных кампаний" icon="📣" />;

  const statusLabel = (s: number) =>
    s === 11 ? { label: "активна", color: C.green }
  : s === 9  ? { label: "пауза",   color: C.yellow }
  :            { label: `#${s}`,   color: C.textSecondary };

  return (
    <div style={{ padding: "12px 16px 0", display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        {[
          { label: "Активных",  val: data.totalActive,                        color: C.green  },
          { label: "На паузе",  val: data.totalPaused,                        color: C.yellow },
          { label: "Бюджет",    val: rub(Math.round(data.totalBudget)),       color: C.accent },
        ].map(c => (
          <div key={c.label} style={{ background: C.card, borderRadius: 12, padding: "10px 12px", textAlign: "center" as const }}>
            <div style={{ fontSize: 11, color: C.textSecondary }}>{c.label}</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: c.color, marginTop: 4 }}>{c.val}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", background: C.card, borderRadius: 10, padding: 3, gap: 2 }}>
        {(["summary", "campaigns"] as const).map(t => (
          <button key={t} onClick={() => setSub(t)} style={{
            flex: 1, padding: "7px 0", borderRadius: 8, border: "none", cursor: "pointer",
            fontSize: 13, fontWeight: 500,
            background: sub === t ? C.elevated : "none",
            color: sub === t ? "#fff" : C.textSecondary,
          }}>{t === "summary" ? "Итоги 7д" : "Кампании"}</button>
        ))}
      </div>

      {sub === "summary" && (
        <div style={{ background: C.card, borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          {data.totalSpend7d === 0 ? (
            <div style={{ color: C.textSecondary, fontSize: 13, textAlign: "center" as const }}>Нет данных о расходах</div>
          ) : (
            [
              { label: "Расходы (7д)",  val: rub(Math.round(data.totalSpend7d)) },
              { label: "Показы (7д)",   val: data.totalViews7d.toLocaleString("ru-RU") },
              { label: "Клики (7д)",    val: data.totalClicks7d.toLocaleString("ru-RU") },
              { label: "CTR",           val: `${data.avgCtr}%` },
              ...(data.totalOrders7d > 0 ? [
                { label: "Заказов",     val: `${data.totalOrders7d} шт` },
                { label: "CPO",         val: rub(data.avgCpo) + "/заказ" },
              ] : []),
            ].map(r => (
              <div key={r.label} style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: C.textSecondary, fontSize: 14 }}>{r.label}</span>
                <span style={{ fontWeight: 600, fontSize: 14 }}>{r.val}</span>
              </div>
            ))
          )}
        </div>
      )}

      {sub === "campaigns" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {data.campaigns.map(c => {
            const st = statusLabel(c.status);
            return (
              <div key={c.id} style={{ background: C.card, borderRadius: 12, padding: "12px 16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ color: C.textSecondary, fontSize: 13 }}>ID {c.id}</span>
                  <span style={{ fontSize: 12, color: st.color, fontWeight: 600 }}>{st.label}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 13 }}>
                  <span style={{ color: C.textSecondary }}>Остаток</span>
                  <span style={{ fontWeight: 600, color: c.balance > 0 ? "#fff" : C.red }}>{rub(Math.round(c.balance))}</span>
                </div>
                {c.spend7d > 0 && (
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 13 }}>
                    <span style={{ color: C.textSecondary }}>Потрачено 7д</span>
                    <span>{rub(Math.round(c.spend7d))}{c.orders7d > 0 ? `  ·  ${c.orders7d} зак.` : ""}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface FunnelItem {
  article: string;
  orders: number; buyouts: number;
  revenue: number; pctBuyout: number; retPct: number;
}
interface GoodItem {
  nmID: number; article: string;
  price: number; discount: number; discountedPrice: number;
}
interface FunnelData { funnel: FunnelItem[]; goods: GoodItem[] }

function FunnelTab({ token }: { token: string }) {
  const [data, setData] = useState<FunnelData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/twa/funnel", { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null).then(setData)
      .catch(() => {}).finally(() => setLoading(false));
  }, [token]);

  if (loading) return <Skeleton />;
  if (!data || data.funnel.length === 0) return (
    <div style={{ padding: 24, textAlign: "center" as const, color: C.textSecondary, fontSize: 13 }}>
      <div style={{ fontSize: 32, marginBottom: 8 }}>🔍</div>
      Нет данных воронки.<br />Данные появятся после первых заказов за 30 дней.
    </div>
  );

  const totalOrders = data.funnel.reduce((s, f) => s + f.orders, 0);
  const totalRev    = data.funnel.reduce((s, f) => s + f.revenue, 0);

  function buyoutColor(val: number) {
    return val >= 85 ? C.green : val >= 70 ? C.yellow : C.red;
  }
  function retColor(val: number) {
    return val <= 5 ? C.green : val <= 15 ? C.yellow : C.red;
  }

  return (
    <div style={{ padding: "12px 16px 0", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div style={{ background: C.card, borderRadius: 12, padding: "10px 14px" }}>
          <div style={{ fontSize: 11, color: C.textSecondary }}>Заказов (30д)</div>
          <div style={{ fontSize: 20, fontWeight: 700, marginTop: 3 }}>{totalOrders.toLocaleString("ru-RU")}</div>
        </div>
        <div style={{ background: C.card, borderRadius: 12, padding: "10px 14px" }}>
          <div style={{ fontSize: 11, color: C.textSecondary }}>Выручка (30д)</div>
          <div style={{ fontSize: 20, fontWeight: 700, marginTop: 3 }}>{rub(Math.round(totalRev))}</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "80px 1fr 1fr 1fr 1fr", gap: 4, padding: "0 4px" }}>
        {["Артикул", "Заказы", "Выкупы", "Выкуп%", "Возврат%"].map(h => (
          <div key={h} style={{ fontSize: 10, color: C.muted, textAlign: "center" as const }}>{h}</div>
        ))}
      </div>

      {data.funnel.map(item => (
        <div key={item.article} style={{ background: C.card, borderRadius: 12, padding: "10px 12px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "80px 1fr 1fr 1fr 1fr", gap: 4, alignItems: "center" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.accent }}>{item.article} R$</div>
            <div style={{ textAlign: "center" as const }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{item.orders.toLocaleString("ru-RU")}</div>
            </div>
            <div style={{ textAlign: "center" as const }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{item.buyouts.toLocaleString("ru-RU")}</div>
            </div>
            <div style={{ textAlign: "center" as const }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: buyoutColor(item.pctBuyout) }}>{item.pctBuyout}%</div>
            </div>
            <div style={{ textAlign: "center" as const }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: retColor(item.retPct) }}>{item.retPct}%</div>
            </div>
          </div>
        </div>
      ))}

      {data.goods.length > 0 && (
        <>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.textSecondary, textTransform: "uppercase" as const, letterSpacing: 0.6, marginTop: 4 }}>
            Текущие цены WB
          </div>
          {data.goods.map(g => (
            <div key={g.nmID} style={{ background: C.card, borderRadius: 12, padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ color: C.accent, fontWeight: 600, fontSize: 15 }}>{g.article} R$</span>
              <div style={{ textAlign: "right" as const }}>
                <span style={{ fontSize: 16, fontWeight: 700 }}>{g.discountedPrice.toLocaleString("ru-RU")} ₽</span>
                {g.discount > 0 && (
                  <span style={{ fontSize: 12, color: C.muted, marginLeft: 6 }}>
                    {g.price.toLocaleString("ru-RU")} ₽ −{g.discount}%
                  </span>
                )}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

export default function AnalyticsScreen({ token }: { token: string }) {
  const [tab, setTab] = useState<"dynamics" | "advert" | "funnel">("dynamics");

  return (
    <div style={{ paddingBottom: 24 }}>
      <div style={{ padding: "12px 16px", borderBottom: "1px solid #2c2c2e" }}>
        <div style={{ display: "flex", background: "#2c2c2e", borderRadius: 10, padding: 3, gap: 2 }}>
          {([
            { id: "dynamics", label: "Динамика" },
            { id: "advert",   label: "Реклама"  },
            { id: "funnel",   label: "Воронка"  },
          ] as const).map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              flex: 1, padding: "8px 0", borderRadius: 8, border: "none", cursor: "pointer",
              fontSize: 13, fontWeight: tab === t.id ? 600 : 400,
              background: tab === t.id ? C.elevated : "none",
              color: tab === t.id ? "#fff" : C.textSecondary,
            }}>{t.label}</button>
          ))}
        </div>
      </div>

      {tab === "dynamics" && <DynamicsTab token={token} />}
      {tab === "advert"   && <AdvertTab token={token} />}
      {tab === "funnel"   && <FunnelTab token={token} />}
    </div>
  );
}

function Skeleton() {
  return (
    <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
      {[76, 180, 60].map((h, i) => (
        <div key={i} style={{ background: "#2c2c2e", borderRadius: 12, height: h, animation: "pulse 1.5s ease-in-out infinite" }} />
      ))}
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}`}</style>
    </div>
  );
}

function Empty({ text, icon = "📊" }: { text: string; icon?: string }) {
  return (
    <div style={{ padding: 40, textAlign: "center" as const, color: "#8e8e93" }}>
      <div style={{ fontSize: 32, marginBottom: 8 }}>{icon}</div>
      <div style={{ fontSize: 14 }}>{text}</div>
    </div>
  );
}
