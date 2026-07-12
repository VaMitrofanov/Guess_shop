"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ChevronRight,
  CircleAlert,
  Link2,
  MessageSquareText,
  PackageOpen,
  ShoppingBag,
  Sparkles,
} from "lucide-react";
import { C } from "../theme";
import { haptic } from "../haptics";

interface DashData {
  today: { orders: number; sum: number; sales: number };
  week: { orders: number; sum: number };
  prevWeek: { orders: number; sum: number };
  codes: { denom: number; count: number }[];
  wbOrders: number;
  apiAvailable: boolean;
  tokenPresent?: boolean;
}

interface FeedbackData {
  unansweredFeedbacks: number;
  unansweredQuestions: number;
  items: Array<{ id: string }>;
}

function rub(value: number) {
  return `${value.toLocaleString("ru-RU")} ₽`;
}

function delta(current: number, previous: number) {
  if (!previous) return null;
  const value = Math.round(((current - previous) / previous) * 100);
  if (!value) return null;
  return `${value > 0 ? "+" : "−"}${Math.abs(value)}%`;
}

export default function Dashboard({ token, onOpenOrders }: { token: string; onOpenOrders?: () => void }) {
  const [data, setData] = useState<DashData | null>(null);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<FeedbackData | null>(null);

  useEffect(() => {
    fetch("/api/twa/dashboard", { headers: { Authorization: `Bearer ${token}` } })
      .then(response => response.ok ? response.json() : null)
      .then(setData)
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    fetch("/api/twa/feedback", { headers: { Authorization: `Bearer ${token}` } })
      .then(response => response.ok ? response.json() : null)
      .then(result => { if (result) setFeedback(result); })
      .catch(() => {});
  }, [token]);

  const feedbackCount = (feedback?.unansweredFeedbacks ?? 0) + (feedback?.unansweredQuestions ?? 0);
  const totalCodes = useMemo(() => data?.codes.reduce((sum, code) => sum + code.count, 0) ?? 0, [data]);
  const lowestCode = useMemo(() => {
    if (!data?.codes.length) return null;
    return [...data.codes].sort((a, b) => a.count - b.count)[0];
  }, [data]);

  if (loading) return <Skeleton />;
  if (!data) return <ErrorState />;

  const weekDelta = delta(data.week.sum, data.prevWeek.sum);
  const nextTitle = data.wbOrders > 0
    ? `Обработать FBS · ${data.wbOrders}`
    : lowestCode && lowestCode.count < 5
      ? `Пополнить ${lowestCode.denom} R$`
      : feedbackCount > 0
        ? `Ответить клиентам · ${feedbackCount}`
        : "Очередь под контролем";
  const nextMeta = data.wbOrders > 0
    ? "Заказы Wildberries ждут обработки"
    : lowestCode && lowestCode.count < 5
      ? `Осталось ${lowestCode.count} кодов`
      : feedbackCount > 0
        ? "Есть отзывы или вопросы без ответа"
        : "Срочных действий сейчас нет";

  function openOrders() {
    haptic.select();
    onOpenOrders?.();
  }

  return (
    <div className="twa-liquid-dashboard twa-fade-in">
      {!data.apiAvailable && (
        <div className="twa-liquid-alert">
          <CircleAlert size={18} />
          <div><strong>WB API недоступен</strong><span>Показываем данные из БД{data.tokenPresent === false ? " · токен не задан" : ""}</span></div>
        </div>
      )}

      <section className="twa-revenue-glass">
        <div className="twa-revenue-label"><span>Выручка сегодня</span><b>LIVE</b></div>
        <strong>{rub(data.today.sum)}</strong>
        <div className="twa-revenue-meta">
          <span>{data.today.orders} заказов · {data.today.sales} выкупов</span>
          {weekDelta && <span style={{ color: weekDelta.startsWith("+") ? C.green : C.red }}>{weekDelta} за неделю</span>}
        </div>
        <div className="twa-revenue-line" aria-hidden="true"><i /></div>
      </section>

      <div className="twa-quick-grid">
        <button type="button" className="twa-quick-glass twa-press-sm" onClick={openOrders}>
          <span><ShoppingBag size={18} /></span><small>Заказы</small><strong>{data.today.orders}</strong><em>сегодня</em>
        </button>
        <button type="button" className="twa-quick-glass twa-press-sm" onClick={openOrders}>
          <span><PackageOpen size={18} /></span><small>FBS</small><strong>{data.wbOrders}</strong><em>{data.wbOrders ? "в работе" : "очередь пуста"}</em>
        </button>
        <button type="button" className="twa-quick-glass twa-press-sm">
          <span><Link2 size={18} /></span><small>WB-коды</small><strong>{totalCodes}</strong><em>{lowestCode ? `min ${lowestCode.count} шт` : "нет кодов"}</em>
        </button>
        <button type="button" className="twa-quick-glass twa-press-sm">
          <span><MessageSquareText size={18} /></span><small>Ответы</small><strong>{feedbackCount}</strong><em>{feedbackCount ? "ждут" : "всё закрыто"}</em>
        </button>
      </div>

      <div className="twa-dashboard-section-title"><strong>Ближайшее действие</strong><button type="button" onClick={openOrders}>Все заказы</button></div>
      <button type="button" className="twa-next-action twa-press" onClick={openOrders}>
        <span><Sparkles size={19} /></span>
        <span><strong>{nextTitle}</strong><small>{nextMeta}</small></span>
        <ChevronRight size={19} />
      </button>

      <section className="twa-stock-glass">
        <div><span>Коды Wildberries</span><strong>{totalCodes} шт</strong></div>
        {data.codes.length === 0 ? (
          <p style={{ color: C.red }}>Коды закончились</p>
        ) : (
          <div className="twa-stock-list">
            {data.codes.slice(0, 5).map(code => {
              const pct = Math.min(100, (code.count / 30) * 100);
              const color = code.count < 5 ? C.red : code.count < 10 ? C.yellow : C.accent;
              return (
                <div key={code.denom}>
                  <span>{code.denom} R$</span>
                  <div><i style={{ width: `${pct}%`, background: color }} /></div>
                  <strong style={{ color }}>{code.count}</strong>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="twa-liquid-dashboard">
      {[170, 130, 64, 150].map((height, index) => (
        <div key={index} className="twa-liquid-skeleton" style={{ height, opacity: 0.8 - index * 0.1 }} />
      ))}
    </div>
  );
}

function ErrorState() {
  return (
    <div className="twa-liquid-error">
      <CircleAlert size={28} />
      <strong>Не удалось загрузить данные</strong>
      <span>Проверьте соединение и откройте экран снова</span>
    </div>
  );
}
