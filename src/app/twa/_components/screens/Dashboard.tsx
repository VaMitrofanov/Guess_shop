"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronRight,
  CircleAlert,
  CircleDollarSign,
  Clipboard,
  ExternalLink,
  Gamepad2,
  History,
  Link2,
  MessageCircleQuestion,
  PackageOpen,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  ShoppingBag,
  Truck,
  TriangleAlert,
  UserRound,
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
  dbs: { active: number; waitingCode: number; codeReceived: number; readyReceive: number };
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
  order: {
    id: string; code: string; source: string; status: string; amount: number; robloxUsername: string | null;
    createdAt: string; pendingAt: string | null; completedAt: string | null; favorite: boolean; note: string | null;
  };
  client: {
    username: string | null; displayName: string | null; tgId: string | null; vkId: string | null; email: string | null;
    balance: number; identities: Array<{ provider: string; subject: string; verifiedAt: string | null }>;
  };
  gamepass: {
    id: string | null; url: string | null; name?: string; expectedPrice: number; livePrice?: number; isForSale?: boolean;
    sellerName?: string | null; observedAt?: string; reusedIn?: { wbCode: string; status: string } | null;
  };
  money: {
    saleAmountKopecks: number | null; purchaseCostKopecks: number | null; profitKopecks: number | null;
    payments: Array<{ status: string; provider: string; amountKopecks: number; refundedAmountKopecks: number; updatedAt: string }>;
  };
  fulfillment: { purchaserUsername: string | null; paidAt: string | null; completedAt: string | null };
  communications: { events: Array<{ type: string; createdAt: string }> };
  related: Array<{ id: string; wbCode: string; status: string; amount: number; orderSource: string; createdAt: string }>;
  warnings: string[];
  partialErrors: string[];
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

function dateTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" }) + " МСК";
}

function eventLabel(type: string) {
  const labels: Record<string, string> = {
    CREATED: "Создан", PENDING: "В очереди", IN_PROGRESS: "В работе", COMPLETED: "Выкуплен", REJECTED: "Отклонён",
    PAYMENT_CONFIRMED: "Оплата подтверждена", PAYMENT_REFUNDED: "Возврат подтверждён",
  };
  return labels[type] ?? type.replaceAll("_", " ");
}

function CopyAction({ value, label, compact = false }: { value: string | null | undefined; label: string; compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  const copy = async () => {
    let copiedNow = false;
    try {
      await navigator.clipboard.writeText(value);
      copiedNow = true;
    } catch {
      try {
        const input = document.createElement("textarea");
        input.value = value;
        input.style.position = "fixed";
        input.style.opacity = "0";
        document.body.append(input);
        input.select();
        copiedNow = document.execCommand("copy");
        input.remove();
      } catch { /* clipboard unavailable */ }
    }
    if (copiedNow) {
      haptic.notify("success");
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_600);
    }
  };
  return (
    <button type="button" className={`twa-dossier-action${compact ? " is-compact" : ""}`} onClick={() => void copy()}>
      <Clipboard size={compact ? 15 : 16} />{copied ? "Скопировано" : label}
    </button>
  );
}

function DossierLink({ href, label }: { href: string | null | undefined; label: string }) {
  if (!href) return null;
  return <a className="twa-dossier-action" href={href} target="_blank" rel="noreferrer"><ExternalLink size={16} />{label}</a>;
}

const DOSSIER_MOVE_TARGETS = [
  ["BUYOUT", "К выкупу"], ["AWAITING_LINK", "Ждут ссылку"], ["ERROR", "Ошибка"],
  ["DONE", "Готово"], ["FAVORITES", "Избранное"],
] as const;

function DossierContent({ dossier, token, onOpenOrder, onDossierChange }: {
  dossier: OrderDossier; token: string; onOpenOrder: (code: string) => void; onDossierChange: (next: OrderDossier) => void;
}) {
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveTarget, setMoveTarget] = useState<(typeof DOSSIER_MOVE_TARGETS)[number][0] | "">("");
  const [moveNote, setMoveNote] = useState("");
  const [actionResult, setActionResult] = useState<{ text: string; error?: boolean } | null>(null);
  const money = dossier.money ?? {};
  const clientTitle = dossier.client?.username ? `@${dossier.client.username}` : dossier.client?.displayName ?? "Клиент без имени";
  const primaryId = dossier.client?.tgId ? `TG ${dossier.client.tgId}` : dossier.client?.vkId ? `VK ${dossier.client.vkId}` : "Контакт не привязан";
  const payment = money.payments?.[0];
  const profitTone = money.profitKopecks != null && money.profitKopecks < 0 ? "is-negative" : "";
  const liveState = dossier.gamepass?.livePrice != null
    ? `${dossier.gamepass.livePrice.toLocaleString("ru-RU")} R$ · ${dossier.gamepass.isForSale === false ? "снят с продажи" : "live"}`
    : `ожидалось ${dossier.gamepass?.expectedPrice.toLocaleString("ru-RU")} R$`;
  const contactLink = dossier.client?.tgId ? `tg://user?id=${dossier.client.tgId}` : dossier.client?.vkId ? `https://vk.com/id${dossier.client.vkId}` : null;

  async function runAction(action: "complete" | "set-error" | "restore-to-buyout" | "toggle-favorite" | "move-to") {
    if (busyAction) return;
    if (action === "complete" && !window.confirm("Отметить заказ выкупленным? Клиенту уйдёт уведомление.")) return;
    if (action === "set-error" && !window.confirm("Переместить заказ в ошибки?")) return;
    if (action === "move-to" && (!moveTarget || !moveNote.trim())) {
      setActionResult({ text: "Для переноса выберите раздел и оставьте заметку.", error: true });
      return;
    }
    setBusyAction(action);
    setActionResult(null);
    try {
      const response = await fetch("/api/twa/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          action,
          orderId: dossier.order.id,
          ...(action === "move-to" ? { target: moveTarget, note: moveNote.trim() } : {}),
        }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        haptic.notify("error");
        setActionResult({ text: payload.error ?? "Действие не выполнено", error: true });
        return;
      }
      haptic.notify("success");
      const moveStatus = moveTarget === "BUYOUT" ? "PENDING"
        : moveTarget === "AWAITING_LINK" ? "AWAITING_GAMEPASS"
          : moveTarget === "ERROR" ? "ERROR"
            : moveTarget === "DONE" ? "COMPLETED"
              : dossier.order.status;
      const status = action === "complete" ? "COMPLETED"
        : action === "set-error" ? "ERROR"
          : action === "restore-to-buyout" ? "PENDING"
            : action === "move-to" ? moveStatus : dossier.order.status;
      onDossierChange({ ...dossier, order: { ...dossier.order, status, favorite: action === "toggle-favorite" ? !dossier.order.favorite : dossier.order.favorite } });
      if (action === "move-to") { setMoveOpen(false); setMoveNote(""); setMoveTarget(""); }
      setActionResult({ text: action === "complete" ? "Заказ отмечен выкупленным" : action === "set-error" ? "Заказ перенесён в ошибки" : action === "restore-to-buyout" ? "Заказ возвращён к выкупу" : action === "toggle-favorite" ? "Избранное обновлено" : "Заказ перенесён" });
    } catch {
      haptic.notify("error");
      setActionResult({ text: "Ошибка сети — статус не менялся", error: true });
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="twa-search-dossier">
      <header className="twa-dossier-hero">
        <div className="twa-dossier-kicker"><span>Операционное досье · {dossier.order.source}</span><b className={dossier.completeness === "FULL" ? "is-ready" : "is-partial"}>{dossier.completeness === "FULL" ? "Проверено" : "Частично"}</b></div>
        <div className="twa-dossier-code-row"><strong>{dossier.order.code}</strong><CopyAction value={dossier.order.code} label="Код" compact /></div>
        <div className="twa-dossier-summary">
          <div><span>{dossier.order.status}</span><strong>{dossier.order.robloxUsername ?? "Ник Roblox не подтверждён"}</strong></div>
          <b>{dossier.order.amount.toLocaleString("ru-RU")} <small>R$</small></b>
        </div>
      </header>

      {dossier.warnings?.map(warning => <div key={warning} className="twa-intelligence-warning"><CircleAlert size={17} />{warning}</div>)}
      {dossier.partialErrors?.map(error => <div key={error} className="twa-dossier-partial"><CircleAlert size={16} />{error}</div>)}

      <section className="twa-dossier-section">
        <div className="twa-dossier-section-head"><span><UserRound size={16} />Клиент</span><small>{primaryId}</small></div>
        <div className="twa-dossier-value"><strong>{clientTitle}</strong><span>{dossier.client?.displayName && dossier.client.displayName !== clientTitle ? dossier.client.displayName : ""}</span></div>
        <div className="twa-dossier-actions">
          <CopyAction value={dossier.client?.tgId} label={`TG ${dossier.client?.tgId ?? ""}`} />
          <CopyAction value={dossier.client?.vkId} label={`VK ${dossier.client?.vkId ?? ""}`} />
          <CopyAction value={dossier.client?.email} label="Email" />
          <DossierLink href={contactLink} label="Открыть чат" />
        </div>
      </section>

      <section className="twa-dossier-section twa-dossier-management">
        <div className="twa-dossier-section-head"><span><ShieldCheck size={16} />Управление</span><small>переносы пишутся в аудит</small></div>
        <div className="twa-dossier-manage-actions">
          {dossier.order.status === "ERROR" ? (
            <button type="button" className="twa-dossier-manage-action is-success" disabled={!!busyAction} onClick={() => void runAction("restore-to-buyout")}>Вернуть к выкупу</button>
          ) : ["PENDING", "IN_PROGRESS"].includes(dossier.order.status) && (
            <button type="button" className="twa-dossier-manage-action is-success" disabled={!!busyAction} onClick={() => void runAction("complete")}>{busyAction === "complete" ? "Отмечаем…" : "Выкуплено"}</button>
          )}
          {["PENDING", "IN_PROGRESS", "ERROR"].includes(dossier.order.status) && dossier.order.status !== "ERROR" && (
            <button type="button" className="twa-dossier-manage-action is-warning" disabled={!!busyAction} onClick={() => void runAction("set-error")}>В ошибку</button>
          )}
          <button type="button" className="twa-dossier-manage-action" disabled={!!busyAction} onClick={() => setMoveOpen(value => !value)}>Переместить</button>
          <button type="button" className="twa-dossier-manage-action" disabled={!!busyAction} onClick={() => void runAction("toggle-favorite")}>{dossier.order.favorite ? "Убрать из избранного" : "В избранное"}</button>
          <button type="button" className="twa-dossier-manage-action is-quiet" onClick={() => onOpenOrder(dossier.order.code)}>Полный заказ</button>
        </div>
        {moveOpen && (
          <div className="twa-dossier-move-form">
            <div className="twa-dossier-move-targets">{DOSSIER_MOVE_TARGETS.map(([id, label]) => <button key={id} type="button" className={moveTarget === id ? "is-selected" : ""} onClick={() => setMoveTarget(id)}>{label}</button>)}</div>
            <textarea value={moveNote} onChange={event => setMoveNote(event.target.value)} rows={2} maxLength={500} placeholder="Почему переносим? Эта заметка попадёт в аудит." aria-label="Заметка к переносу" />
            <button type="button" className="twa-dossier-move-submit" disabled={busyAction === "move-to"} onClick={() => void runAction("move-to")}>{busyAction === "move-to" ? "Переносим…" : "Подтвердить перенос"}</button>
          </div>
        )}
        {actionResult && <div className={`twa-dossier-action-result${actionResult.error ? " is-error" : ""}`}>{actionResult.text}</div>}
      </section>

      <section className="twa-dossier-section">
        <div className="twa-dossier-section-head"><span><Gamepad2 size={16} />Геймпасс</span><small>{liveState}</small></div>
        <div className="twa-dossier-value"><strong>{dossier.gamepass?.name ?? "Геймпасс не привязан"}</strong><span>{dossier.gamepass?.sellerName ? `Создатель: ${dossier.gamepass.sellerName}` : dossier.gamepass?.id ? `Pass ID ${dossier.gamepass.id}` : ""}</span></div>
        <div className="twa-dossier-actions">
          <CopyAction value={dossier.gamepass?.id} label="Скопировать ID" />
          <CopyAction value={dossier.gamepass?.url} label="Скопировать ссылку" />
          <DossierLink href={dossier.gamepass?.url} label="Открыть Roblox" />
        </div>
      </section>

      <section className="twa-dossier-section">
        <div className="twa-dossier-section-head"><span><CircleDollarSign size={16} />Деньги</span><small>{payment?.status ?? (dossier.fulfillment?.paidAt ? "Подтверждена" : "Не зафиксирована")}</small></div>
        <div className="twa-dossier-finances">
          <div><small>Продажа</small><strong>{kopecks(money.saleAmountKopecks)}</strong></div>
          <div><small>Себестоимость</small><strong>{kopecks(money.purchaseCostKopecks)}</strong></div>
          <div className={profitTone}><small>Прибыль</small><strong>{kopecks(money.profitKopecks)}</strong></div>
        </div>
      </section>

      <section className="twa-dossier-section">
        <div className="twa-dossier-section-head"><span><History size={16} />След и контроль</span><small>{dateTime(dossier.observedAt)}</small></div>
        <div className="twa-dossier-facts">
          <div><span>Создан</span><strong>{dateTime(dossier.order.createdAt)}</strong></div>
          <div><span>Выкуп</span><strong>{dossier.fulfillment?.purchaserUsername ?? "Не назначен"}</strong><small>{dateTime(dossier.fulfillment?.completedAt ?? dossier.fulfillment?.paidAt)}</small></div>
          {dossier.related?.length > 0 && <button type="button" className="twa-dossier-related" onClick={() => onOpenOrder(dossier.related[0].wbCode)}><span>Связанные заказы</span><strong>{dossier.related.length} · открыть последний <ChevronRight size={15} /></strong></button>}
          {dossier.communications?.events?.slice(0, 3).map(event => <div key={`${event.type}-${event.createdAt}`}><span>{eventLabel(event.type)}</span><strong>{dateTime(event.createdAt)}</strong></div>)}
        </div>
      </section>

      {dossier.order.note && <section className="twa-dossier-note"><div><span>Заметка менеджера</span><CopyAction value={dossier.order.note} label="Копировать" compact /></div><p>{dossier.order.note}</p></section>}
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
        {dossier ? <DossierContent dossier={dossier} token={token} onOpenOrder={onOpenOrder} onDossierChange={setDossier} /> : selectedOrder ? <SearchPreview order={selectedOrder} /> : null}
      </BottomSheet>
    </section>
  );
}

export default function Dashboard({
  token,
  onOpenOrders,
  onOpenAccount,
  onOpenInbox,
  onOpenDelivery,
}: {
  token: string;
  onOpenOrders?: (query?: string, tab?: OrdersTab) => void;
  onOpenAccount?: () => void;
  onOpenInbox?: () => void;
  onOpenDelivery?: () => void;
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
        {data.dbs.active > 0 && (
          <button type="button" className="twa-inset-row twa-press-sm" onClick={() => { haptic.select(); onOpenDelivery?.(); }}>
            <span className="twa-result-icon is-delivery"><Truck size={21} /></span><div><strong>DBS доставка · {data.dbs.active} {plural(data.dbs.active, "заказ", "заказа", "заказов")}</strong><small>{data.dbs.waitingCode > 0 ? `${data.dbs.waitingCode} ждут код` : ""}{data.dbs.waitingCode > 0 && data.dbs.codeReceived > 0 ? " · " : ""}{data.dbs.codeReceived > 0 ? `${data.dbs.codeReceived} код получен` : ""}{(data.dbs.waitingCode > 0 || data.dbs.codeReceived > 0) && data.dbs.readyReceive > 0 ? " · " : ""}{data.dbs.readyReceive > 0 ? `${data.dbs.readyReceive} к завершению` : ""}{!data.dbs.waitingCode && !data.dbs.codeReceived && !data.dbs.readyReceive ? "в процессе" : ""}</small></div><ChevronRight size={20} />
          </button>
        )}
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
