"use client";
import { useEffect, useState } from "react";

interface StockItem {
  article: string; quantity: number; quantityFull: number;
  inWayToClient: number; inWayFromClient: number;
  avgDailySales: number; runwayDays: number; price: number;
}

interface SupplyItem {
  id: string; done: boolean;
  createdAt: string; closedAt: string | null;
  name: string; cargoType: number;
}

interface GoodItem {
  nmID: number; article: string;
  price: number; discount: number; discountedPrice: number;
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

function cargoLabel(n: number): string {
  if (n === 1) return "FBO";
  if (n === 2) return "FBS";
  if (n === 3) return "Кросс";
  return `Тип ${n}`;
}

function StocksContent({ data }: { data: StockItem[] }) {
  const total      = data.reduce((a, s) => a + s.quantity,        0);
  const toClient   = data.reduce((a, s) => a + s.inWayToClient,   0);
  const fromClient = data.reduce((a, s) => a + s.inWayFromClient, 0);

  return (
    <div style={{ padding: 16, paddingBottom: 24, display: "flex", flexDirection: "column", gap: 12 }}>
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

function SuppliesContent({ token }: { token: string }) {
  const [data, setData] = useState<SupplyItem[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/twa/supplies", { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null).then(setData)
      .catch(() => {}).finally(() => setLoading(false));
  }, [token]);

  if (loading) return <Skeleton />;
  if (!data || data.length === 0) return (
    <div style={{ padding: 40, textAlign: "center" as const, color: C.sec, fontSize: 14 }}>
      Нет поставок
    </div>
  );

  return (
    <div style={{ padding: 16, paddingBottom: 24, display: "flex", flexDirection: "column", gap: 10 }}>
      {data.map(s => (
        <div key={s.id} style={{ background: C.card, borderRadius: 14, padding: "14px 16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 15 }}>{s.name || s.id}</div>
              {s.name && <div style={{ fontSize: 12, color: C.sec, marginTop: 2 }}>ID: {s.id}</div>}
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: s.done ? C.green : C.yellow }}>
                {s.done ? "Принята" : "В работе"}
              </span>
              <span style={{ fontSize: 11, color: C.muted }}>{cargoLabel(s.cargoType)}</span>
            </div>
          </div>
          <div style={{ fontSize: 12, color: C.sec }}>
            Создана: {new Date(s.createdAt).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}
            {s.closedAt && (
              <span>
                {" "}· Закрыта: {new Date(s.closedAt).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function PricesContent({ token }: { token: string }) {
  const [data, setData] = useState<GoodItem[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/twa/goods", { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null).then(setData)
      .catch(() => {}).finally(() => setLoading(false));
  }, [token]);

  if (loading) return <Skeleton />;
  if (!data || data.length === 0) return (
    <div style={{ padding: 40, textAlign: "center" as const, color: C.sec, fontSize: 14 }}>
      Нет данных
    </div>
  );

  return (
    <div style={{ padding: 16, paddingBottom: 24, display: "flex", flexDirection: "column", gap: 10 }}>
      {data.map(g => (
        <div key={g.nmID} style={{ background: C.card, borderRadius: 14, padding: "14px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ color: C.accent, fontWeight: 600, fontSize: 16 }}>{g.article} R$</span>
          <div style={{ textAlign: "right" as const }}>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{g.discountedPrice.toLocaleString("ru-RU")} ₽</div>
            {g.discount > 0 && (
              <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
                {g.price.toLocaleString("ru-RU")} ₽ −{g.discount}%
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function StocksScreen({ token }: { token: string }) {
  const [tab, setTab]   = useState<"stocks" | "supplies" | "prices">("stocks");
  const [data, setData] = useState<StockItem[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/twa/stocks", { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(setData).finally(() => setLoading(false));
  }, [token]);

  return (
    <div style={{ paddingBottom: 24 }}>
      <div style={{ padding: "10px 16px", borderBottom: "1px solid #2c2c2e" }}>
        <div style={{ display: "flex", background: "#2c2c2e", borderRadius: 10, padding: 3, gap: 2 }}>
          {(["stocks", "supplies", "prices"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              flex: 1, padding: "8px 0", borderRadius: 8, border: "none", cursor: "pointer",
              fontSize: 13, fontWeight: tab === t ? 600 : 400,
              background: tab === t ? C.elevated : "none",
              color: tab === t ? "#fff" : C.sec,
            }}>
              {t === "stocks" ? "Склад" : t === "supplies" ? "Поставки" : "Цены"}
            </button>
          ))}
        </div>
      </div>

      {tab === "stocks" && (
        loading ? <Skeleton /> : !data ? (
          <div style={{ padding: 40, textAlign: "center" as const, color: C.red }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>⚠️</div>
            <div style={{ fontSize: 14 }}>Ошибка загрузки</div>
          </div>
        ) : <StocksContent data={data} />
      )}
      {tab === "supplies" && <SuppliesContent token={token} />}
      {tab === "prices"   && <PricesContent token={token} />}
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
