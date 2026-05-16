"use client";
import { useEffect, useState } from "react";

interface AdvertData {
  totalActive: number; totalPaused: number; totalBudget: number;
  totalSpend7d: number; totalViews7d: number; totalClicks7d: number; totalOrders7d: number;
  avgCtr: number; avgCpo: number;
  campaigns: { id: number; status: number; balance: number; spend7d: number; orders7d: number }[];
  empty?: boolean;
}

function rub(n: number) { return n.toLocaleString("ru-RU") + " ₽"; }

export default function AdvertScreen({ token }: { token: string }) {
  const [data, setData] = useState<AdvertData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"summary" | "campaigns">("summary");

  useEffect(() => {
    fetch("/api/twa/advert", { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(setData).finally(() => setLoading(false));
  }, [token]);

  if (loading) return <div style={{ padding: 32, textAlign: "center", color: "#8e8e93" }}>Загрузка…</div>;
  if (!data || data.empty) return (
    <div style={{ padding: 32, textAlign: "center", color: "#8e8e93" }}>
      <div style={{ fontSize: 32, marginBottom: 8 }}>📣</div>
      <div>Нет активных кампаний</div>
    </div>
  );

  const statusLabel = (s: number) => s === 11 ? { label: "активна", color: "#30d158" } : s === 9 ? { label: "пауза", color: "#ffd60a" } : { label: `#${s}`, color: "#8e8e93" };
  const hasStats = data.totalSpend7d > 0;

  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        {[
          { label: "Активных", value: data.totalActive, color: "#30d158" },
          { label: "Пауза", value: data.totalPaused, color: "#ffd60a" },
          { label: "Бюджет", value: rub(Math.round(data.totalBudget)), color: "#bf5af2" },
        ].map(c => (
          <div key={c.label} style={{ background: "#2c2c2e", borderRadius: 12, padding: "10px 12px", textAlign: "center" }}>
            <div style={{ fontSize: 11, color: "#8e8e93" }}>{c.label}</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: c.color, marginTop: 4 }}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", background: "#2c2c2e", borderRadius: 10, padding: 3, gap: 2 }}>
        {(["summary", "campaigns"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            flex: 1, padding: "7px 0", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 500,
            background: tab === t ? "#3a3a3c" : "none", color: tab === t ? "#fff" : "#8e8e93",
          }}>{t === "summary" ? "Итоги 7д" : "Кампании"}</button>
        ))}
      </div>

      {tab === "summary" && (
        <div style={{ background: "#2c2c2e", borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          {!hasStats ? (
            <div style={{ color: "#8e8e93", fontSize: 13, textAlign: "center", padding: "8px 0" }}>
              ℹ️ Данные о расходах недоступны
            </div>
          ) : (
            <>
              {[
                { label: "Расходы (7д)", value: rub(Math.round(data.totalSpend7d)) },
                { label: "Показы (7д)",  value: data.totalViews7d.toLocaleString("ru-RU") },
                { label: "Клики (7д)",   value: data.totalClicks7d.toLocaleString("ru-RU") },
                { label: "CTR",          value: `${data.avgCtr}%` },
                ...(data.totalOrders7d > 0 ? [
                  { label: "CPO",        value: rub(data.avgCpo) + "/заказ" },
                  { label: "Заказов",    value: String(data.totalOrders7d) + " шт" },
                ] : []),
              ].map(r => (
                <div key={r.label} style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "#8e8e93", fontSize: 14 }}>{r.label}</span>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{r.value}</span>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {tab === "campaigns" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {data.campaigns.map(c => {
            const st = statusLabel(c.status);
            return (
              <div key={c.id} style={{ background: "#2c2c2e", borderRadius: 12, padding: "12px 16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ color: "#8e8e93", fontSize: 13 }}>ID {c.id}</span>
                  <span style={{ fontSize: 12, color: st.color, fontWeight: 600 }}>{st.label}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 13 }}>
                  <span style={{ color: "#8e8e93" }}>Остаток</span>
                  <span style={{ fontWeight: 600, color: c.balance > 0 ? "#fff" : "#ff453a" }}>{rub(Math.round(c.balance))}</span>
                </div>
                {c.spend7d > 0 && (
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 13 }}>
                    <span style={{ color: "#8e8e93" }}>Потрачено 7д</span>
                    <span>{rub(Math.round(c.spend7d))}{c.orders7d > 0 ? `  (${c.orders7d} зак.)` : ""}</span>
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
