"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronRight,
  CircleAlert,
  CircleDollarSign,
  Gamepad2,
  Link2,
  MessageCircleQuestion,
  PackageOpen,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  ShoppingBag,
  TriangleAlert,
  X,
} from "lucide-react";
import BottomSheet from "../BottomSheet";
import { C } from "../theme";
import { haptic } from "../haptics";

type OrdersTab = "BUYOUT" | "AWAITING_LINK" | "ERROR" | "NEW";

interface DashData {
  today: { orders: number; sum: number; sales: number };
  week: { orders: number; sum: number };
  prevWeek: { orders: number; sum: number };
  codes: { denom: number; count: number }[];
  attention: {
    total: number;
    buyout: number;
    awaitingLink: number;
    errors: number;
    oldestAt: string | null;
    firstError: string | null;
  };
  donorCoverage: {
    available: boolean;
    accountName: string | null;
    balance: number | null;
    requiredRobux: number;
    covered: boolean | null;
    shortfall: number | null;
  };
  inbox: { available: boolean; feedbacks: number; questions: number; total: number };
  apiAvailable: boolean;
  tokenPresent?: boolean;
}

interface SearchOrder {
  id: string;
  wbCode: string;
  amount: number;
  status: string;
  orderSource: string;
  robloxUsername: string | null;
  probableNick: string | null;
  matchReason: string;
  source: "db";
  user: { username: string | null; name: string | null; tgId?: string | null; vkId?: string | null };
}

interface SearchGamepass {
  gamepassId: number;
  name: string;
  price: number;
  sellerName: string | null;
  isForSale: boolean;
  observedAt: string;
  matchReason: string;
  source: "live";
}

interface SearchPayload {
  orders: SearchOrder[];
  gamepasses: SearchGamepass[];
  counts: { all: number; orders: number; gamepasses: number };
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

type SearchFilter = "all" | "orders" | "gamepasses";

function rub(value: number) {
  return `${value.toLocaleString("ru-RU")} ₽`;
}

function kopecks(value: number | null | undefined) {
  if (value == null) return "—";
  return `${(value / 100).toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₽`;
}

function delta(current: number, previous: number) {
  if (!previous) return null;
  const value = Math.round(((current - previous) / previous) * 100);
  if (!value) return null;
  return `${value > 0 ? "+" : "−"}${Math.abs(value)}%`;
}

function ageLabel(value: string | null) {
  if (!value) return "очередь свежая";
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 60) return `старейшее ${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `старейшее ${hours} ч`;
  return `старейшее ${Math.floor(hours / 24)} д`;
}

function plural(count: number, one: string, few: string, many: string) {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

function DossierContent({ dossier }: { dossier: OrderDossier }) {
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
    <div className="twa-intelligence twa-search-dossier">
      <div className="twa-intelligence-head">
        <div><span>{dossier.order.source} · {dossier.order.status}</span><strong>{dossier.order.code}</strong></div>
        <ShieldCheck size={24} color={dossier.completeness === "FULL" ? C.green : C.yellow} />
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
      {dossier.warnings?.map(warning => <div key={warning} className="twa-intelligence-warning"><CircleAlert size={17} />{warning}</div>)}
      <div className="twa-inset-group">
        {groups.map(group => (
          <div className="twa-inset-row" key={group.label}>
            <span>{group.label}</span><div><strong>{group.value}</strong><small>{group.sub}</small></div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SearchPreview({ order }: { order: SearchOrder }) {
  return (
    <div className="twa-search-preview">
      <div className="twa-search-preview-kicker"><span>БД · {order.matchReason}</span><b>{order.orderSource}</b></div>
      <strong>{order.robloxUsername ?? order.probableNick ?? "Ник не указан"}</strong>
      <div className="twa-search-preview-amount">{order.amount.toLocaleString("ru-RU")} <small>R$</small></div>
      <div className="twa-search-preview-client">
        <span>{order.user.username ? `@${order.user.username}` : order.user.name ?? "Клиент"}</span>
        <code>{order.wbCode}</code>
      </div>
      <div className={`twa-search-preview-status${order.status === "ERROR" ? " is-error" : ""}`}>
        {order.status === "ERROR" ? <TriangleAlert size={18} /> : <ShieldCheck size={18} />}
        {order.status}
      </div>
    </div>
  );
}

function SmartSearch({ token, onOpenOrder, onOpenAccount }: { token: string; onOpenOrder: (query: string) => void; onOpenAccount: () => void }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SearchFilter>("all");
  const [result, setResult] = useState<SearchPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<SearchOrder | null>(null);
  const [dossier, setDossier] = useState<OrderDossier | null>(null);
  const [dossierLoading, setDossierLoading] = useState(false);
  const [sheetExpanded, setSheetExpanded] = useState(false);
  const requestRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const value = query.trim();
    if (value.length < 2) {
      requestRef.current?.abort();
      return;
    }
    const timer = window.setTimeout(async () => {
      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;
      setLoading(true);
      try {
        const response = await fetch(`/api/twa/search?q=${encodeURIComponent(value)}`, {
          headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
        });
        const payload = response.ok ? await response.json() as SearchPayload : null;
        if (!controller.signal.aborted) setResult(payload);
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          setResult({ orders: [], gamepasses: [], counts: { all: 0, orders: 0, gamepasses: 0 }, partialErrors: ["Roblox: live-поиск временно недоступен"] });
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 320);
    return () => window.clearTimeout(timer);
  }, [query, token]);

  function changeQuery(value: string) {
    setQuery(value);
    setSelectedOrder(null);
    setDossier(null);
    if (value.trim().length < 2) {
      requestRef.current?.abort();
      setLoading(false);
      setResult(null);
    }
  }

  async function loadDossier() {
    if (!selectedOrder || dossierLoading) return;
    haptic.select();
    setDossierLoading(true);
    try {
      const response = await fetch(`/api/twa/orders/${selectedOrder.id}/intelligence`, { headers: { Authorization: `Bearer ${token}` } });
      if (response.ok) setDossier(await response.json() as OrderDossier);
    } finally {
      setDossierLoading(false);
    }
  }

  const counts = result?.counts ?? { all: 0, orders: 0, gamepasses: 0 };
  const showOrders = filter !== "gamepasses";
  const showGamepasses = filter !== "orders";

  return (
    <section className={`twa-smart-search${result || loading ? " is-active" : ""}`}>
      <div className="twa-search-field">
        <Search size={21} />
        <input value={query} onChange={event => changeQuery(event.target.value)} placeholder="Заказ, @username, ник или геймпасс" aria-label="Умный поиск" />
        {loading && <i className="twa-search-spinner" />}
        {query && !loading && <button type="button" onClick={() => changeQuery("")} aria-label="Очистить"><X size={15} /></button>}
      </div>
      {result && (
        <>
          <div className="twa-search-chips" aria-label="Фильтр поиска">
            {([['all', 'Все', counts.all], ['orders', 'Заказы', counts.orders], ['gamepasses', 'Геймпассы', counts.gamepasses]] as const).map(([id, label, count]) => (
              <button key={id} type="button" aria-pressed={filter === id} onClick={() => { haptic.select(); setFilter(id); }}>{label} <b>{count}</b></button>
            ))}
          </div>
          <div className="twa-search-results twa-fade-up">
            {showOrders && result.orders.length > 0 && <div className="twa-result-group"><span>Заказы · БД</span>{result.orders.map(order => (
              <button type="button" key={order.id} className="twa-result-row twa-press-sm" onClick={() => { haptic.select(); setSelectedOrder(order); setDossier(null); }}>
                <span className="twa-result-icon"><PackageOpen size={20} /></span>
                <span><strong>{order.robloxUsername ?? order.probableNick ?? order.wbCode}</strong><small>{order.matchReason} · {order.orderSource} · {order.status} · {order.amount} R$</small></span>
                <ChevronRight size={19} />
              </button>
            ))}</div>}
            {showGamepasses && <div className="twa-result-group"><span>Геймпассы · Roblox live</span>{result.gamepasses.map(pass => (
              <button type="button" key={pass.gamepassId} className="twa-result-row twa-press-sm" onClick={onOpenAccount}>
                <span className="twa-result-icon"><Gamepad2 size={20} /></span>
                <span><strong>{pass.name} · {pass.price} R$</strong><small>{pass.matchReason} · {pass.sellerName ?? "Roblox"} · ID {pass.gamepassId}</small></span>
                <ChevronRight size={19} />
              </button>
            ))}{result.partialErrors.map(error => <div key={error} className="twa-search-partial">{error}</div>)}</div>}
            {((filter === "orders" && !result.orders.length) || (filter === "gamepasses" && !result.gamepasses.length) || (filter === "all" && !counts.all)) && <div className="twa-search-empty">Ничего не найдено</div>}
          </div>
        </>
      )}
      <BottomSheet
        open={selectedOrder !== null}
        onClose={() => { setSelectedOrder(null); setDossier(null); setSheetExpanded(false); }}
        ariaLabel={dossier ? "Досье заказа" : "Предпросмотр заказа"}
        className="twa-search-sheet"
        expandable
        expanded={sheetExpanded}
        onExpandedChange={setSheetExpanded}
        footer={selectedOrder && (
          <button type="button" className="twa-primary-row twa-press" disabled={dossierLoading} onClick={() => dossier ? onOpenOrder(dossier.order.code) : void loadDossier()}>
            {dossierLoading ? "Собираем досье…" : dossier ? "Открыть заказ" : "Открыть досье"} <ChevronRight size={20} />
          </button>
        )}
      >
        {dossier ? <DossierContent dossier={dossier} /> : selectedOrder ? <SearchPreview order={selectedOrder} /> : null}
      </BottomSheet>
    </section>
  );
}

export default function Dashboard({
  token,
  onOpenOrders,
  onOpenAccount,
  onOpenInbox,
}: {
  token: string;
  onOpenOrders?: (query?: string, tab?: OrdersTab) => void;
  onOpenAccount?: () => void;
  onOpenInbox?: () => void;
}) {
  const [data, setData] = useState<DashData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const response = await fetch("/api/twa/dashboard", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      if (response.ok) setData(await response.json() as DashData);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/twa/dashboard", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" })
      .then(response => response.ok ? response.json() as Promise<DashData> : null)
      .then(payload => { if (!cancelled && payload) setData(payload); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token]);

  const totalCodes = useMemo(() => data?.codes.reduce((sum, code) => sum + code.count, 0) ?? 0, [data]);
  if (loading) return <Skeleton />;
  if (!data) return <ErrorState onRetry={() => void load(true)} />;

  const weekDelta = delta(data.week.sum, data.prevWeek.sum);
  const donor = data.donorCoverage;
  const coverageText = donor.balance === null
    ? "баланс донора недоступен"
    : donor.covered
      ? `${donor.balance.toLocaleString("ru-RU")} R$ на доноре · покрытие есть`
      : `не хватает ${donor.shortfall?.toLocaleString("ru-RU")} R$`;

  function openOrders(tab: OrdersTab, query?: string) {
    haptic.select();
    onOpenOrders?.(query, tab);
  }

  return (
    <div className="twa-liquid-dashboard twa-fade-in">
      <SmartSearch token={token} onOpenOrder={query => onOpenOrders?.(query)} onOpenAccount={() => onOpenAccount?.()} />
      {!data.apiAvailable && (
        <div className="twa-liquid-alert">
          <CircleAlert size={19} />
          <div><strong>WB API недоступен</strong><span>Очереди из БД работают{data.tokenPresent === false ? " · токен WB не задан" : ""}</span></div>
        </div>
      )}

      <section className="twa-action-hero">
        <div className="twa-action-hero-head"><span>Требует действия</span><b>{ageLabel(data.attention.oldestAt)}</b></div>
        <strong>{data.attention.total}</strong>
        <div className="twa-action-metrics">
          <button type="button" onClick={() => openOrders("BUYOUT")}><small>К выкупу</small><b>{data.attention.buyout}</b></button>
          <button type="button" onClick={() => openOrders("AWAITING_LINK")}><small>Ждут ссылку</small><b>{data.attention.awaitingLink}</b></button>
          <button type="button" onClick={() => openOrders("ERROR")}><small>Ошибки</small><b>{data.attention.errors}</b></button>
        </div>
      </section>

      <div className="twa-dashboard-section-title"><strong>Сейчас</strong><button type="button" onClick={() => onOpenOrders?.()}>Все заказы</button></div>
      <div className="twa-inset-group twa-action-list">
        <button type="button" className="twa-inset-row twa-press-sm" onClick={() => openOrders("BUYOUT")}>
          <span className="twa-result-icon is-buyout"><ShoppingBag size={21} /></span><div><strong>Выкупить {data.attention.buyout} {plural(data.attention.buyout, "заказ", "заказа", "заказов")}</strong><small>{data.donorCoverage.requiredRobux.toLocaleString("ru-RU")} R$ нужно · {coverageText}</small></div><ChevronRight size={20} />
        </button>
        <button type="button" className="twa-inset-row twa-press-sm" onClick={() => openOrders("AWAITING_LINK")}>
          <span className="twa-result-icon is-link"><Link2 size={21} /></span><div><strong>Запросить {data.attention.awaitingLink} {plural(data.attention.awaitingLink, "ссылку", "ссылки", "ссылок")}</strong><small>Клиенты без подтверждённого геймпасса</small></div><ChevronRight size={20} />
        </button>
        <button type="button" className="twa-inset-row twa-press-sm" onClick={() => openOrders("ERROR")}>
          <span className="twa-result-icon is-error"><TriangleAlert size={21} /></span><div><strong>Исправить {data.attention.errors} {plural(data.attention.errors, "ошибку", "ошибки", "ошибок")}</strong><small>{data.attention.firstError ?? "Активных ошибок нет"}</small></div><ChevronRight size={20} />
        </button>
        <button type="button" className="twa-inset-row twa-press-sm" onClick={() => { haptic.select(); onOpenInbox?.(); }}>
          <span className="twa-result-icon is-inbox"><MessageCircleQuestion size={21} /></span><div><strong>Ответить {data.inbox.total} {plural(data.inbox.total, "клиенту", "клиентам", "клиентам")}</strong><small>{data.inbox.feedbacks} {plural(data.inbox.feedbacks, "отзыв", "отзыва", "отзывов")} · {data.inbox.questions} {plural(data.inbox.questions, "вопрос", "вопроса", "вопросов")}</small></div><ChevronRight size={20} />
        </button>
      </div>

      <div className="twa-quick-grid twa-dashboard-commands">
        <button type="button" className="twa-quick-glass twa-press" onClick={() => openOrders("NEW")}><span><Plus size={22} /></span><strong>Новый заказ</strong><small>Создать или принять</small></button>
        <button type="button" className="twa-quick-glass twa-press" disabled={refreshing} onClick={() => { haptic.select(); void load(true); }}><span><RefreshCw size={22} className={refreshing ? "is-spinning" : ""} /></span><strong>{refreshing ? "Обновляем" : "Обновить"}</strong><small>Очереди и ресурсы</small></button>
      </div>

      <div className="twa-inset-group twa-week-summary">
        <div className="twa-inset-row"><span className="twa-result-icon"><CircleDollarSign size={21} /></span><div><strong>Неделя · {rub(data.week.sum)}</strong><small>{data.week.orders} заказов{weekDelta ? ` · ${weekDelta}` : ""} · {totalCodes} WB-кодов</small></div></div>
      </div>
    </div>
  );
}

function Skeleton() {
  return <div className="twa-liquid-dashboard">{[49, 190, 31, 390].map((height, index) => <div key={index} className="twa-liquid-skeleton" style={{ height, opacity: 0.82 - index * 0.1 }} />)}</div>;
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="twa-liquid-error">
      <CircleAlert size={30} />
      <strong>Не удалось загрузить Action Center</strong>
      <span>Проверьте соединение и попробуйте снова</span>
      <button type="button" className="twa-primary-row" onClick={onRetry}>Повторить</button>
    </div>
  );
}
