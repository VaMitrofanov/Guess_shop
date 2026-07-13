"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronRight,
  CircleAlert,
  CircleDollarSign,
  Gamepad2,
  PackageOpen,
  Search,
  ShieldCheck,
  Sparkles,
  UserRound,
  X,
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

interface SearchOrder {
  id: string;
  wbCode: string;
  amount: number;
  status: string;
  orderSource: string;
  robloxUsername: string | null;
  probableNick: string | null;
  user: { username: string | null; name: string | null };
}

interface SearchGamepass {
  gamepassId: number;
  name: string;
  price: number;
  sellerName: string | null;
  isForSale: boolean;
  observedAt: string;
}

interface SearchPayload {
  orders: SearchOrder[];
  gamepasses: SearchGamepass[];
  partialErrors: string[];
}

interface OrderDossier {
  completeness: "FULL" | "PARTIAL";
  observedAt: string;
  order: { id: string; code: string; source: string; status: string; amount: number; robloxUsername: string | null };
  client: { username: string | null; displayName: string | null; tgId: string | null; vkId: string | null };
  gamepass: { id: string | null; name?: string; livePrice?: number; reusedIn?: { wbCode: string } | null };
  money: { saleAmountKopecks: number | null; purchaseCostKopecks: number | null; profitKopecks: number | null; payments: Array<{ status: string }> };
  fulfillment: { purchaserUsername: string | null; paidAt: string | null; completedAt: string | null };
  related: Array<{ id: string }>;
  warnings: string[];
}

function kopecks(value: number | null | undefined) {
  if (value == null) return "—";
  return `${(value / 100).toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₽`;
}

function IntelligenceCard({ dossier, onOpen }: { dossier: OrderDossier; onOpen: () => void }) {
  const money = dossier.money ?? {};
  const groups = [
    { label: "Клиент", value: dossier.client?.username ? `@${dossier.client.username}` : dossier.client?.displayName ?? "—", sub: dossier.client?.tgId ? `TG ${dossier.client.tgId}` : dossier.client?.vkId ? `VK ${dossier.client.vkId}` : "identity не указана" },
    { label: "Геймпасс", value: dossier.gamepass?.name ?? dossier.gamepass?.id ?? "—", sub: dossier.gamepass?.livePrice != null ? `${dossier.gamepass.livePrice} R$ · live` : "live-данные недоступны" },
    { label: "Оплата", value: money.payments?.[0]?.status ?? (dossier.fulfillment?.paidAt ? "Подтверждена" : "—"), sub: money.saleAmountKopecks != null ? `Продажа ${kopecks(money.saleAmountKopecks)}` : "точная продажа не зафиксирована" },
    { label: "Выкуп", value: dossier.fulfillment?.purchaserUsername ?? "Не назначен", sub: dossier.fulfillment?.completedAt ? new Date(dossier.fulfillment.completedAt).toLocaleString("ru-RU") : "ещё не завершён" },
    { label: "Связи", value: `${dossier.related?.length ?? 0} прошлых заказов`, sub: dossier.gamepass?.reusedIn ? `ГП также в ${dossier.gamepass.reusedIn.wbCode}` : "дубликатов не найдено" },
    { label: "Контроль", value: dossier.completeness === "FULL" ? "Досье полное" : "Частичные данные", sub: new Date(dossier.observedAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) },
  ];
  return (
    <section className="twa-intelligence twa-fade-up">
      <div className="twa-intelligence-head">
        <div><span>{dossier.order.source} · {dossier.order.status}</span><strong>{dossier.order.code}</strong></div>
        <ShieldCheck size={21} color={dossier.completeness === "FULL" ? C.green : C.yellow} />
      </div>
      <div className="twa-intelligence-person">
        <div><strong>{dossier.order.robloxUsername ?? "Ник не подтверждён"}</strong><span>{dossier.client?.username ? `@${dossier.client.username}` : dossier.client?.displayName ?? "Клиент без username"}</span></div>
        <b>{dossier.order.amount.toLocaleString("ru-RU")} R$</b>
      </div>
      {(money.saleAmountKopecks != null || money.purchaseCostKopecks != null) && (
        <div className="twa-money-triplet">
          <span><small>Продажа</small><b>{kopecks(money.saleAmountKopecks)}</b></span>
          <span><small>Себестоимость</small><b>{kopecks(money.purchaseCostKopecks)}</b></span>
          <span><small>Прибыль</small><b style={{ color: money.profitKopecks != null && money.profitKopecks < 0 ? C.red : C.green }}>{kopecks(money.profitKopecks)}</b></span>
        </div>
      )}
      {dossier.warnings?.map((warning: string) => <div key={warning} className="twa-intelligence-warning"><CircleAlert size={16} />{warning}</div>)}
      <div className="twa-inset-group">
        {groups.map((group, index) => (
          <div className="twa-inset-row" key={group.label}>
            <span>{group.label}</span><div><strong>{group.value}</strong><small>{group.sub}</small></div>{index < groups.length && <ChevronRight size={16} />}
          </div>
        ))}
      </div>
      <button type="button" className="twa-primary-row twa-press" onClick={onOpen}>Открыть заказ <ChevronRight size={18} /></button>
    </section>
  );
}

function SmartSearch({ token, onOpenOrder, onOpenAccount }: { token: string; onOpenOrder: (query: string) => void; onOpenAccount: () => void }) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<SearchPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [dossier, setDossier] = useState<OrderDossier | null>(null);
  const [dossierLoading, setDossierLoading] = useState(false);
  const requestRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const value = query.trim();
    if (value.length < 2) { requestRef.current?.abort(); return; }
    const timer = window.setTimeout(async () => {
      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;
      setLoading(true);
      try {
        const response = await fetch(`/api/twa/search?q=${encodeURIComponent(value)}`, {
          headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
        });
        const payload = response.ok ? await response.json() : null;
        if (!controller.signal.aborted) setResult(payload);
      } catch (error) {
        if ((error as Error).name !== "AbortError") setResult({ orders: [], gamepasses: [], partialErrors: ["Поиск временно недоступен"] });
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }, 320);
    return () => window.clearTimeout(timer);
  }, [query, token]);

  function changeQuery(value: string) {
    setQuery(value);
    setDossier(null);
    setResult(null);
    if (value.trim().length < 2) {
      requestRef.current?.abort();
      setResult(null);
      setLoading(false);
    }
  }

  async function selectOrder(order: SearchOrder) {
    haptic.select();
    setDossierLoading(true);
    try {
      const response = await fetch(`/api/twa/orders/${order.id}/intelligence`, { headers: { Authorization: `Bearer ${token}` } });
      if (response.ok) setDossier(await response.json() as OrderDossier);
    } finally { setDossierLoading(false); }
  }

  return (
    <section className={`twa-smart-search${result || loading ? " is-active" : ""}`}>
      <div className="twa-search-field">
        <Search size={19} />
        <input value={query} onChange={event => changeQuery(event.target.value)} placeholder="Заказ, @username, ник или геймпасс" aria-label="Умный поиск" />
        {loading && <i className="twa-search-spinner" />}
        {query && !loading && <button type="button" onClick={() => changeQuery("")} aria-label="Очистить"><X size={14} /></button>}
      </div>
      {dossierLoading && <div className="twa-search-loading">Собираем полное досье заказа…</div>}
      {dossier && <IntelligenceCard dossier={dossier} onOpen={() => onOpenOrder(dossier.order.code)} />}
      {result && !dossier && (
        <div className="twa-search-results twa-fade-up">
          {result.orders.length > 0 && <div className="twa-result-group"><span>Заказы</span>{result.orders.map(order => (
            <button type="button" key={order.id} className="twa-result-row twa-press-sm" onClick={() => selectOrder(order)}>
              <span className="twa-result-icon"><PackageOpen size={18} /></span>
              <span><strong>{order.wbCode} · {order.robloxUsername ?? order.probableNick ?? "без ника"}</strong><small>{order.orderSource} · {order.status} · {order.amount} R$ · {order.user.username ? `@${order.user.username}` : order.user.name ?? "клиент"}</small></span>
              <ChevronRight size={17} />
            </button>
          ))}</div>}
          {result.gamepasses.length > 0 && <div className="twa-result-group"><span>Геймпассы Roblox · live</span>{result.gamepasses.map(pass => (
            <button type="button" key={pass.gamepassId} className="twa-result-row twa-press-sm" onClick={onOpenAccount}>
              <span className="twa-result-icon"><Gamepad2 size={18} /></span>
              <span><strong>{pass.name} · {pass.price} R$</strong><small>{pass.sellerName ?? "Roblox"} · ID {pass.gamepassId}</small></span>
              <ChevronRight size={17} />
            </button>
          ))}</div>}
          {result.orders.length === 0 && result.gamepasses.length === 0 && <div className="twa-search-empty">Ничего не найдено</div>}
          {result.partialErrors.map(error => <div key={error} className="twa-search-partial">{error}</div>)}
        </div>
      )}
    </section>
  );
}

export default function Dashboard({ token, onOpenOrders, onOpenAccount }: { token: string; onOpenOrders?: (query?: string) => void; onOpenAccount?: () => void }) {
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

  function openOrders(query?: string) {
    haptic.select();
    onOpenOrders?.(query);
  }

  return (
    <div className="twa-liquid-dashboard twa-fade-in">
      <SmartSearch token={token} onOpenOrder={openOrders} onOpenAccount={() => onOpenAccount?.()} />
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

      <div className="twa-dashboard-section-title"><strong>Сейчас</strong><button type="button" onClick={() => openOrders()}>Все заказы</button></div>
      <div className="twa-inset-group">
        <button type="button" className="twa-inset-row twa-press-sm" onClick={() => openOrders()}>
          <span className="twa-result-icon"><Sparkles size={18} /></span><div><strong>{nextTitle}</strong><small>{nextMeta}</small></div><ChevronRight size={18} />
        </button>
        <button type="button" className="twa-inset-row twa-press-sm" onClick={() => onOpenAccount?.()}>
          <span className="twa-result-icon"><UserRound size={18} /></span><div><strong>Аккаунт и выкуп</strong><small>{totalCodes} WB-кодов · {feedbackCount} ответов · donor balance</small></div><ChevronRight size={18} />
        </button>
        <div className="twa-inset-row">
          <span className="twa-result-icon"><CircleDollarSign size={18} /></span><div><strong>Неделя · {rub(data.week.sum)}</strong><small>{data.week.orders} заказов{weekDelta ? ` · ${weekDelta}` : ""}</small></div>
        </div>
      </div>
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
