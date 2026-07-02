"use client";
import { C } from "../theme";
import { useEffect, useState } from "react";
import StatCard from "../StatCard";

interface DashData {
  today:    { orders: number; sum: number; sales: number };
  week:     { orders: number; sum: number };
  prevWeek: { orders: number; sum: number };
  codes:    { denom: number; count: number }[];
  wbOrders: number;
  apiAvailable: boolean;
  tokenPresent?: boolean;
}


function rub(n: number) { return n.toLocaleString("ru-RU") + " ₽"; }
function delta(a: number, b: number): { text: string; color: string } | null {
  if (!b) return null;
  const d = Math.round(((a - b) / b) * 100);
  if (d === 0) return null;
  return { text: (d > 0 ? "↑" : "↓") + Math.abs(d) + "%", color: d > 0 ? C.green : C.red };
}

export default function Dashboard({ token }: { token: string }) {
  const [data,     setData]     = useState<DashData | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [feedback, setFeedback] = useState<{ unansweredFeedbacks: number; unansweredQuestions: number; items: any[] } | null>(null);

  useEffect(() => {
    fetch("/api/twa/dashboard", { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(setData).finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    fetch("/api/twa/feedback", { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null).then(d => { if (d) setFeedback(d); })
      .catch(() => {});
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
        <div style={{ fontSize: 11, fontWeight: 700, color: C.textSecondary, textTransform: "uppercase" as const, letterSpacing: 0.6, marginBottom: 10 }}>Сегодня</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <StatCard title="Заказы"       value={data.today.orders} accent />
          <StatCard title="Выручка"      value={rub(data.today.sum)} />
          <StatCard
            title="FBS в работе"
            value={data.wbOrders}
            sub={data.wbOrders > 0 ? "нужна обработка" : "очередь пуста"}
            subColor={data.wbOrders > 0 ? C.yellow : C.muted}
          />
          <StatCard title="Выкупов"      value={data.today.sales} />
        </div>
      </section>

      <section>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.textSecondary, textTransform: "uppercase" as const, letterSpacing: 0.6, marginBottom: 10 }}>Неделя vs прошлая</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <StatCard title="Заказов (7д)" value={data.week.orders} sub={od?.text} subColor={od?.color} />
          <StatCard title="Выручка (7д)" value={rub(data.week.sum)} sub={sd?.text} subColor={sd?.color} />
        </div>
      </section>

      <section>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.textSecondary, textTransform: "uppercase" as const, letterSpacing: 0.6, marginBottom: 10 }}>Коды WB</div>
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
            <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 10, display: "flex", justifyContent: "space-between", color: C.textSecondary, fontSize: 13 }}>
              <span>Итого кодов</span>
              <span style={{ fontWeight: 600, color: "#fff" }}>{totalCodes} шт</span>
            </div>
          </div>
        )}
      </section>

      {(feedback && (feedback.unansweredFeedbacks > 0 || feedback.unansweredQuestions > 0 || feedback.items.length > 0)) && (
        <section>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.textSecondary, textTransform: "uppercase" as const, letterSpacing: 0.6, marginBottom: 10 }}>
            Отзывы и вопросы
          </div>
          <div style={{ background: C.card, borderRadius: 14, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
            {feedback.unansweredFeedbacks > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 14 }}>⭐ Отзывов без ответа</span>
                <span style={{ fontSize: 16, fontWeight: 700, color: C.red }}>{feedback.unansweredFeedbacks}</span>
              </div>
            )}
            {feedback.unansweredQuestions > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 14 }}>❓ Вопросов без ответа</span>
                <span style={{ fontSize: 16, fontWeight: 700, color: C.yellow }}>{feedback.unansweredQuestions}</span>
              </div>
            )}
            {feedback.items.slice(0, 3).map((item: any) => (
              <div key={item.id} style={{ borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                  <span style={{ fontSize: 11, color: item.type === "feedback" ? C.yellow : C.accent }}>
                    {item.type === "feedback" ? `⭐ ${item.rating}/5` : "❓ вопрос"}
                    {item.article ? ` · ${item.article} R$` : ""}
                  </span>
                  <span style={{ fontSize: 11, color: C.muted }}>
                    {item.date ? new Date(item.date).toLocaleDateString("ru-RU", { day: "numeric", month: "short" }) : ""}
                  </span>
                </div>
                <div style={{ fontSize: 13, color: "#e5e5ea", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const }}>
                  {item.text || "(без текста)"}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
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
