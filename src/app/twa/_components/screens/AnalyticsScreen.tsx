"use client";
import { C, tint } from "../theme";
import { useEffect, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ComposedChart, Line, Area, LineChart, ReferenceLine, Legend,
} from "recharts";

// ── Shared types ──────────────────────────────────────────────────────────────

interface DayData  { date: string; count: number; sum: number }
interface DashData { daily: DayData[]; week: { orders: number; sum: number }; prevWeek: { orders: number; sum: number }; apiAvailable: boolean }
interface AdvertData {
  totalActive: number; totalPaused: number; totalBudget: number;
  totalSpend7d: number; totalViews7d: number; totalClicks7d: number; totalOrders7d: number;
  avgCtr: number; avgCpo: number;
  campaigns: { id: number; status: number; balance: number; spend7d: number; orders7d: number }[];
  empty?: boolean;
}
interface FunnelItem { article: string; orders: number; buyouts: number; revenue: number; pctBuyout: number; retPct: number }
interface GoodItem { nmID: number; article: string; price: number; discount: number; discountedPrice: number }
interface FunnelData { funnel: FunnelItem[]; goods: GoodItem[] }

interface BuyerBucket { label: string; count: number }
interface BuyerFunnelData {
  nicks: BuyerBucket[]; gamepasses: BuyerBucket[];
  range: { type: string; from: string; to: string };
  totals: { nicks: number; gamepasses: number; conversionPct: number };
}

interface PredictData {
  daily: { date: string; orders: number; amount: number }[];
  trendLine: { date: string; value: number }[];
  regression: { slope: number; intercept: number; r2: number; direction: "up" | "down" | "flat" };
  metrics: { avgDaily7d: number; avgDaily30d: number; growthWoW: number | null; growthMoM: number | null; revenue7d: number; revenue30d: number };
  projections: { orders30d: number; orders60d: number; orders90d: number; revenue30d: number; revenue60d: number; revenue90d: number };
  funnelTrend: { week: string; nicks: number; gamepasses: number; conversionPct: number }[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function rub(n: number) { return n.toLocaleString("ru-RU") + " ₽"; }
function pctDelta(a: number, b: number) {
  if (!b) return null;
  const d = Math.round(((a - b) / b) * 100);
  return { d, up: d >= 0 };
}
function computeTicks(maxVal: number, scale: number): number[] {
  if (maxVal === 0) return [0];
  const ceiling = Math.ceil(maxVal / scale) * scale;
  const ticks: number[] = [];
  for (let t = 0; t <= ceiling; t += scale) ticks.push(t);
  return ticks;
}

const tooltipStyle = { background: C.elevated, border: "none", borderRadius: 8, fontSize: 12 };

// ── Pill selector (reusable) ──────────────────────────────────────────────────

function PillRow<T extends string | number>({ items, value, onChange, small }: {
  items: { id: T; label: string }[]; value: T; onChange: (v: T) => void; small?: boolean;
}) {
  return (
    <div style={{ display: "flex", background: C.elevated, borderRadius: 8, padding: 2, gap: 1, flexWrap: "wrap" }}>
      {items.map(t => (
        <button key={String(t.id)} onClick={() => onChange(t.id)} style={{
          padding: small ? "3px 7px" : "4px 12px", borderRadius: 6, border: "none", cursor: "pointer",
          fontSize: small ? 11 : 12, fontWeight: 500, whiteSpace: "nowrap",
          background: value === t.id ? C.accent : "none",
          color: value === t.id ? "#fff" : C.textSecondary,
        }}>{t.label}</button>
      ))}
    </div>
  );
}

// ── DynamicsTab ───────────────────────────────────────────────────────────────

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
          <PillRow items={[{ id: "count" as const, label: "Шт" }, { id: "sum" as const, label: "₽" }]} value={view} onChange={setView} />
        </div>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={data.daily} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
            <XAxis dataKey="date" tick={{ fill: C.textSecondary, fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: C.textSecondary, fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: "#fff" }}
              formatter={(v) => { const n = Number(v ?? 0); return view === "sum" ? [rub(n), "Выручка"] : [n, "Заказов"]; }} />
            <Bar dataKey={view} fill={C.accent} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ── AdvertTab ─────────────────────────────────────────────────────────────────

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

// ── BuyerFunnelSection ────────────────────────────────────────────────────────

const RANGES = [
  { id: "day" as const,        label: "День" },
  { id: "week" as const,       label: "Неделя" },
  { id: "half-month" as const, label: "Полмес." },
  { id: "month" as const,      label: "Месяц" },
];
const SCALES = [1, 5, 10, 20, 30, 50, 100].map(s => ({ id: s, label: `×${s}` }));

function BuyerFunnelSection({ token }: { token: string }) {
  const [range, setRange] = useState<"day" | "week" | "half-month" | "month">("week");
  const [scale, setScale] = useState(5);
  const [data, setData]   = useState<BuyerFunnelData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/twa/buyer-funnel?range=${range}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null).then(setData)
      .catch(() => {}).finally(() => setLoading(false));
  }, [token, range]);

  if (loading) return <Skeleton />;
  if (!data) return <Empty text="Нет данных воронки" icon="👥" />;

  const maxNick = Math.max(...data.nicks.map(b => b.count), 1);
  const maxGP   = Math.max(...data.gamepasses.map(b => b.count), 1);
  const maxAll  = Math.max(maxNick, maxGP);
  const nickTicks = computeTicks(maxNick, scale);
  const gpTicks   = computeTicks(maxGP, scale);
  const allTicks  = computeTicks(maxAll, scale);

  // Correlation data
  const corrData = data.nicks.map((n, i) => ({
    label: n.label,
    nicks: n.count,
    gp: data.gamepasses[i]?.count ?? 0,
    gap: n.count - (data.gamepasses[i]?.count ?? 0),
  }));

  // Funnel direction
  const half = Math.floor(corrData.length / 2);
  const avgGapFirst = half > 0 ? corrData.slice(0, half).reduce((s, d) => s + d.gap, 0) / half : 0;
  const avgGapSecond = half > 0 ? corrData.slice(half).reduce((s, d) => s + d.gap, 0) / (corrData.length - half) : 0;
  const funnelImproving = avgGapSecond < avgGapFirst;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Controls */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, color: C.textSecondary, flexShrink: 0 }}>Период</span>
          <PillRow items={RANGES} value={range} onChange={setRange} small />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, color: C.textSecondary, flexShrink: 0 }}>Шаг Y</span>
          <PillRow items={SCALES} value={scale} onChange={setScale} small />
        </div>
      </div>

      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        <div style={{ background: C.card, borderRadius: 12, padding: "10px 12px", textAlign: "center" as const }}>
          <div style={{ fontSize: 11, color: C.textSecondary }}>Ники</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: C.blue, marginTop: 4 }}>{data.totals.nicks}</div>
        </div>
        <div style={{ background: C.card, borderRadius: 12, padding: "10px 12px", textAlign: "center" as const }}>
          <div style={{ fontSize: 11, color: C.textSecondary }}>Геймпассы</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: C.green, marginTop: 4 }}>{data.totals.gamepasses}</div>
        </div>
        <div style={{ background: C.card, borderRadius: 12, padding: "10px 12px", textAlign: "center" as const }}>
          <div style={{ fontSize: 11, color: C.textSecondary }}>Конверсия</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: C.accent, marginTop: 4 }}>{data.totals.conversionPct}%</div>
        </div>
      </div>

      {/* Chart 1: Nicks */}
      <div style={{ background: C.card, borderRadius: 12, padding: 16 }}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12 }}>Регистрация ников</div>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={data.nicks} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
            <XAxis dataKey="label" tick={{ fill: C.textSecondary, fontSize: 10 }} axisLine={false} tickLine={false}
              interval={range === "month" ? 2 : "preserveStartEnd"} />
            <YAxis ticks={nickTicks} domain={[0, nickTicks[nickTicks.length - 1]]}
              tick={{ fill: C.textSecondary, fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: "#fff" }}
              formatter={(v) => [Number(v), "Ников"]} />
            <Bar dataKey="count" fill={C.blue} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Chart 2: Gamepasses */}
      <div style={{ background: C.card, borderRadius: 12, padding: 16 }}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12 }}>Регистрация геймпассов</div>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={data.gamepasses} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
            <XAxis dataKey="label" tick={{ fill: C.textSecondary, fontSize: 10 }} axisLine={false} tickLine={false}
              interval={range === "month" ? 2 : "preserveStartEnd"} />
            <YAxis ticks={gpTicks} domain={[0, gpTicks[gpTicks.length - 1]]}
              tick={{ fill: C.textSecondary, fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: "#fff" }}
              formatter={(v) => [Number(v), "Геймпассов"]} />
            <Bar dataKey="count" fill={C.green} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Chart 3: Correlation */}
      <div style={{ background: C.card, borderRadius: 12, padding: 16 }}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12 }}>Корреляция: ники vs геймпассы</div>
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart data={corrData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
            <XAxis dataKey="label" tick={{ fill: C.textSecondary, fontSize: 10 }} axisLine={false} tickLine={false}
              interval={range === "month" ? 2 : "preserveStartEnd"} />
            <YAxis ticks={allTicks} domain={[0, allTicks[allTicks.length - 1]]}
              tick={{ fill: C.textSecondary, fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: "#fff" }} />
            <Legend wrapperStyle={{ fontSize: 11, color: C.textSecondary }} />
            <Bar dataKey="nicks" name="Ники" fill={C.blue} fillOpacity={0.6} radius={[3, 3, 0, 0]} />
            <Bar dataKey="gp" name="Геймпассы" fill={C.green} fillOpacity={0.6} radius={[3, 3, 0, 0]} />
            <Area dataKey="gap" name="Разрыв" fill={C.yellow} fillOpacity={0.15} stroke={C.yellow} strokeWidth={1} />
          </ComposedChart>
        </ResponsiveContainer>
        <div style={{
          textAlign: "center" as const, marginTop: 8, fontSize: 13, fontWeight: 600,
          color: funnelImproving ? C.green : C.red,
        }}>
          {funnelImproving ? "↓ Воронка сужается (улучшение)" : "↑ Воронка расходится"}
        </div>
      </div>
    </div>
  );
}

// ── FunnelTab (with buyer sub-tabs) ───────────────────────────────────────────

function FunnelTab({ token }: { token: string }) {
  const [sub, setSub] = useState<"buyers" | "wb">("buyers");
  const [wbData, setWbData] = useState<FunnelData | null>(null);
  const [wbLoading, setWbLoading] = useState(false);

  useEffect(() => {
    if (sub !== "wb" || wbData) return;
    setWbLoading(true);
    fetch("/api/twa/funnel", { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null).then(setWbData)
      .catch(() => {}).finally(() => setWbLoading(false));
  }, [token, sub, wbData]);

  return (
    <div style={{ padding: "12px 16px 0", display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Sub-tab selector */}
      <div style={{ display: "flex", background: C.card, borderRadius: 10, padding: 3, gap: 2 }}>
        {([
          { id: "buyers" as const, label: "Покупатели" },
          { id: "wb" as const, label: "WB товары" },
        ]).map(t => (
          <button key={t.id} onClick={() => setSub(t.id)} style={{
            flex: 1, padding: "7px 0", borderRadius: 8, border: "none", cursor: "pointer",
            fontSize: 13, fontWeight: 500,
            background: sub === t.id ? C.elevated : "none",
            color: sub === t.id ? "#fff" : C.textSecondary,
          }}>{t.label}</button>
        ))}
      </div>

      {sub === "buyers" && <BuyerFunnelSection token={token} />}

      {sub === "wb" && (
        wbLoading ? <Skeleton /> : !wbData || wbData.funnel.length === 0 ? (
          <Empty text="Нет данных воронки WB" icon="🔍" />
        ) : <WbFunnelContent data={wbData} />
      )}
    </div>
  );
}

function WbFunnelContent({ data }: { data: FunnelData }) {
  const totalOrders = data.funnel.reduce((s, f) => s + f.orders, 0);
  const totalRev    = data.funnel.reduce((s, f) => s + f.revenue, 0);

  function buyoutColor(val: number) { return val >= 85 ? C.green : val >= 70 ? C.yellow : C.red; }
  function retColor(val: number) { return val <= 5 ? C.green : val <= 15 ? C.yellow : C.red; }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
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
            <div style={{ textAlign: "center" as const }}><div style={{ fontSize: 13, fontWeight: 600 }}>{item.orders.toLocaleString("ru-RU")}</div></div>
            <div style={{ textAlign: "center" as const }}><div style={{ fontSize: 13, fontWeight: 600 }}>{item.buyouts.toLocaleString("ru-RU")}</div></div>
            <div style={{ textAlign: "center" as const }}><div style={{ fontSize: 14, fontWeight: 700, color: buyoutColor(item.pctBuyout) }}>{item.pctBuyout}%</div></div>
            <div style={{ textAlign: "center" as const }}><div style={{ fontSize: 14, fontWeight: 700, color: retColor(item.retPct) }}>{item.retPct}%</div></div>
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

// ── PredictTab ────────────────────────────────────────────────────────────────

function PredictTab({ token }: { token: string }) {
  const [data, setData] = useState<PredictData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/twa/predict", { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null).then(setData)
      .catch(() => {}).finally(() => setLoading(false));
  }, [token]);

  if (loading) return <Skeleton />;
  if (!data || data.daily.length < 7) return <Empty text="Недостаточно данных для прогноза (нужно > 7 дней)" icon="🔮" />;

  const { metrics: m, regression: reg, projections: proj, funnelTrend } = data;

  const wowDelta = m.growthWoW !== null ? { d: m.growthWoW, up: m.growthWoW >= 0 } : null;
  const momDelta = m.growthMoM !== null ? { d: m.growthMoM, up: m.growthMoM >= 0 } : null;

  // Trend chart data
  const trendChartData = data.trendLine.map((t, i) => ({
    date: t.date.slice(5),
    actual: i < data.daily.length ? data.daily[i].orders : undefined,
    trend: i < data.daily.length ? t.value : undefined,
    projection: i >= data.daily.length ? t.value : undefined,
  }));

  // Confidence
  const confLabel = reg.r2 >= 0.7 ? "высокая" : reg.r2 >= 0.4 ? "средняя" : "низкая";
  const confColor = reg.r2 >= 0.7 ? C.green : reg.r2 >= 0.4 ? C.yellow : C.red;
  const dirLabel = reg.direction === "up" ? "↑ рост" : reg.direction === "down" ? "↓ спад" : "→ стабильно";

  // Funnel conversion chart
  const avgConv = funnelTrend.length > 0
    ? Math.round(funnelTrend.reduce((s, f) => s + f.conversionPct, 0) / funnelTrend.length)
    : 0;
  const funnelChartData = funnelTrend.map(f => ({ week: f.week.slice(5), conv: f.conversionPct }));
  const firstConv = funnelTrend[0]?.conversionPct ?? 0;
  const lastConv = funnelTrend[funnelTrend.length - 1]?.conversionPct ?? 0;

  return (
    <div style={{ padding: "12px 16px 0", display: "flex", flexDirection: "column", gap: 12, paddingBottom: 24 }}>
      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {[
          { label: "Ср./день (7д)", val: String(m.avgDaily7d), delta: wowDelta, sub: "vs пред. неделя" },
          { label: "Ср./день (30д)", val: String(m.avgDaily30d), delta: momDelta, sub: "vs пред. месяц" },
          { label: "Выручка (7д)", val: `${m.revenue7d.toLocaleString("ru-RU")} R$`, delta: null, sub: "" },
          { label: "Выручка (30д)", val: `${m.revenue30d.toLocaleString("ru-RU")} R$`, delta: null, sub: "" },
        ].map(c => (
          <div key={c.label} style={{ background: C.card, borderRadius: 12, padding: "12px 14px" }}>
            <div style={{ fontSize: 12, color: C.textSecondary }}>{c.label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, marginTop: 2 }}>{c.val}</div>
            {c.delta && (
              <div style={{ fontSize: 12, color: c.delta.up ? C.green : C.red, marginTop: 2 }}>
                {c.delta.up ? "↑" : "↓"}{Math.abs(c.delta.d)}% {c.sub}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Trend chart */}
      <div style={{ background: C.card, borderRadius: 12, padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>Тренд заказов</span>
          <span style={{
            fontSize: 11, padding: "2px 8px", borderRadius: 6,
            background: tint(confColor, 0.15), color: confColor,
          }}>
            R² {reg.r2} · {confLabel} · {dirLabel}
          </span>
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart data={trendChartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
            <XAxis dataKey="date" tick={{ fill: C.textSecondary, fontSize: 9 }} axisLine={false} tickLine={false}
              interval={Math.ceil(trendChartData.length / 10)} />
            <YAxis tick={{ fill: C.textSecondary, fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: "#fff" }} />
            <Area dataKey="actual" name="Факт" fill={C.accent} fillOpacity={0.2} stroke={C.accent} strokeWidth={1.5} connectNulls={false} />
            <Line dataKey="trend" name="Тренд" stroke={C.blue} strokeWidth={2} strokeDasharray="6 3" dot={false} connectNulls={false} />
            <Line dataKey="projection" name="Прогноз" stroke={C.blue} strokeWidth={2} strokeDasharray="3 3" strokeOpacity={0.5} dot={false} connectNulls={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Projections table */}
      <div style={{ background: C.card, borderRadius: 12, padding: 16 }}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12 }}>Прогноз</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[
            { label: "Через 1 мес", orders: proj.orders30d, rev: proj.revenue30d },
            { label: "Через 2 мес", orders: proj.orders60d, rev: proj.revenue60d },
            { label: "Через 3 мес", orders: proj.orders90d, rev: proj.revenue90d },
          ].map(r => (
            <div key={r.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ color: C.textSecondary, fontSize: 14 }}>{r.label}</span>
              <div style={{ textAlign: "right" as const }}>
                <span style={{ fontWeight: 600, fontSize: 14 }}>{r.orders.toLocaleString("ru-RU")} заказов</span>
                <span style={{ color: C.textSecondary, fontSize: 12, marginLeft: 8 }}>{r.rev.toLocaleString("ru-RU")} R$</span>
              </div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 11, color: C.muted, marginTop: 12, textAlign: "center" as const }}>
          На основе линейной регрессии последних 90 дней
        </div>
      </div>

      {/* Funnel conversion trend */}
      {funnelTrend.length >= 2 && (
        <div style={{ background: C.card, borderRadius: 12, padding: 16 }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12 }}>Воронка: ник → геймпасс</div>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={funnelChartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
              <XAxis dataKey="week" tick={{ fill: C.textSecondary, fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: C.textSecondary, fontSize: 11 }} axisLine={false} tickLine={false}
                domain={[0, "auto"]} unit="%" />
              <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: "#fff" }}
                formatter={(v) => [`${v}%`, "Конверсия"]} />
              <ReferenceLine y={avgConv} stroke={C.yellow} strokeDasharray="4 4" strokeWidth={1} />
              <Line dataKey="conv" name="Конверсия" stroke={C.green} strokeWidth={2} dot={{ r: 3, fill: C.green }} />
            </LineChart>
          </ResponsiveContainer>
          <div style={{ textAlign: "center" as const, marginTop: 8, fontSize: 13, color: C.textSecondary }}>
            Конверсия: <b style={{ color: lastConv >= firstConv ? C.green : C.red }}>{firstConv}% → {lastConv}%</b> за {funnelTrend.length} нед
            <span style={{ marginLeft: 8, color: C.muted }}>· ср. {avgConv}%</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main AnalyticsScreen ──────────────────────────────────────────────────────

export default function AnalyticsScreen({ token }: { token: string }) {
  const [tab, setTab] = useState<"dynamics" | "advert" | "funnel" | "predict">("dynamics");

  return (
    <div style={{ paddingBottom: 24 }}>
      <div style={{ padding: "12px 16px", borderBottom: "1px solid #2c2c2e" }}>
        <div style={{ display: "flex", background: "#2c2c2e", borderRadius: 10, padding: 3, gap: 2 }}>
          {([
            { id: "dynamics", label: "Динамика" },
            { id: "advert",   label: "Реклама"  },
            { id: "funnel",   label: "Воронка"  },
            { id: "predict",  label: "Предикт"  },
          ] as const).map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              flex: 1, padding: "8px 0", borderRadius: 8, border: "none", cursor: "pointer",
              fontSize: 13, fontWeight: tab === t.id ? 600 : 400, whiteSpace: "nowrap",
              background: tab === t.id ? C.elevated : "none",
              color: tab === t.id ? "#fff" : C.textSecondary,
            }}>{t.label}</button>
          ))}
        </div>
      </div>

      {tab === "dynamics" && <DynamicsTab token={token} />}
      {tab === "advert"   && <AdvertTab token={token} />}
      {tab === "funnel"   && <FunnelTab token={token} />}
      {tab === "predict"  && <PredictTab token={token} />}
    </div>
  );
}

// ── Shared UI atoms ───────────────────────────────────────────────────────────

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
