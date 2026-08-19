"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clipboard,
  Clock3,
  Gamepad2,
  KeyRound,
  Loader2,
  MessageCircle,
  PackageCheck,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Truck,
  UserRound,
  X,
} from "lucide-react";
import { useVisiblePolling } from "@/hooks/useVisiblePolling";
import type { WbDeliveryAction, WbDeliveryOrderDto, WbDeliveryOrderResponse, WbDeliveryOverview, WbGamepassPreview } from "@/types/wb-delivery";
import {
  WB_FUNNEL_HINT,
  WB_FUNNEL_LABEL,
  WB_QUEUE_SECTIONS,
  WB_STAGE_LABEL,
  WB_TERMINAL_STAGES,
  WB_URGENT_STAGES,
  wbAuditLabel,
  wbGateStateLabel,
  wbSupplierStatusLabel,
} from "@/lib/wb-delivery-labels";
import BottomSheet from "../BottomSheet";
import { haptic } from "../haptics";
import { toast } from "../Toast";
import css from "./WbDeliveryScreen.module.css";

export type WbDeliveryFocus = "waitingCode" | "readyReceive" | "attention" | "inBot";

function dateTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function money(value: number | null) {
  if (value == null) return "—";
  return `${Math.round(value / 100).toLocaleString("ru-RU")} ₽`;
}

/** How the operator refers to an order out loud. The WB number is the fallback
 * only when WB has not served a name yet. */
function orderTitle(order: WbDeliveryOrderDto) {
  return order.buyerName ? `${order.buyerName} · #${order.wbOrderId}` : `WB #${order.wbOrderId}`;
}

/** The line under the stage chip: for an order in our own funnel the funnel step
 * is the real status, not the word "В нашем боте". */
function orderSubtitle(order: WbDeliveryOrderDto) {
  if (order.stage === "in_bot" || order.stage === "link_sent") return WB_FUNNEL_LABEL[order.funnelStep];
  return WB_STAGE_LABEL[order.stage];
}

/** Hero counters are drill-downs: tapping one opens exactly the orders it
 * counted, so both read the same stage predicate. */
const FOCUS: Record<WbDeliveryFocus, { label: string; empty: string; match: (order: WbDeliveryOrderDto) => boolean }> = {
  attention:    { label: "Нужна проверка", empty: "Проверять нечего",       match: (order) => order.stage === "attention" },
  waitingCode:  { label: "Ждут код",       empty: "Никто не ждёт код",      match: (order) => order.stage === "waiting_code" },
  readyReceive: { label: "Закрыть на WB",  empty: "Закрывать сейчас нечего", match: (order) => order.stage === "ready_receive" },
  inBot:        { label: "В нашем боте",   empty: "В боте сейчас пусто",    match: (order) => order.stage === "in_bot" },
};

export default function WbDeliveryScreen({ token, initialFocus }: { token: string; initialFocus?: WbDeliveryFocus | null }) {
  const [data, setData] = useState<WbDeliveryOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<WbDeliveryAction | null>(null);
  const [tab, setTab] = useState<"urgent" | "active" | "done">(initialFocus ? "active" : "urgent");
  const [focus, setFocus] = useState<WbDeliveryFocus | null>(initialFocus ?? null);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [manualCode, setManualCode] = useState("");
  const [message, setMessage] = useState("");
  const [confirming, setConfirming] = useState<{ action: WbDeliveryAction; title: string; body: string; cta: string; facts: [string, string][] } | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const response = await fetch("/api/twa/wb-delivery", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Ошибка WB Доставки");
      setData(body);
    } catch (error) {
      if (!silent) toast(error instanceof Error ? error.message : "Нет соединения", "error");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [token]);

  const loadSelected = useCallback(async (orderId: string) => {
    try {
      const response = await fetch(`/api/twa/wb-delivery?orderId=${encodeURIComponent(orderId)}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (response.status === 404) {
        await load(true);
        return;
      }
      const body = await response.json() as WbDeliveryOrderResponse & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Не удалось обновить чат");
      setData((current) => {
        if (!current) return current;
        const index = current.orders.findIndex((order) => order.id === body.order.id);
        if (index < 0) return current;
        const orders = [...current.orders];
        orders[index] = body.order;
        return { ...current, generatedAt: body.generatedAt, orders };
      });
    } catch {
      // Silent polling: the next cycle or a foreground resume retries automatically.
    }
  }, [load, token]);

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(initial);
  }, [load]);

  const pollOverview = useCallback(() => load(true), [load]);
  const pollSelected = useCallback(async () => {
    if (selectedId) await loadSelected(selectedId);
  }, [loadSelected, selectedId]);
  // The overview replaces the whole order array. Running it next to the 5s
  // detail poll let a 20s-old snapshot overwrite a chat message that had just
  // arrived, so it stands down entirely while a card is open.
  useVisiblePolling(pollOverview, 20_000, !selectedId);
  useVisiblePolling(pollSelected, 5_000, Boolean(selectedId));

  const post = useCallback(async (action: WbDeliveryAction, orderId: string | null, extra: Record<string, unknown> = {}) => {
    const response = await fetch("/api/twa/wb-delivery", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...(orderId ? { orderId } : {}), ...extra }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Действие не выполнено");
    return body as { message: string; orderId?: string; preview?: WbGamepassPreview };
  }, [token]);

  async function act(action: WbDeliveryAction, order: WbDeliveryOrderDto | null, extra: Record<string, unknown> = {}) {
    haptic.impact(action === "receive" ? "heavy" : "medium");
    setBusy(action);
    try {
      const body = await post(action, order?.id ?? null, extra);
      if (body.orderId) setSelectedId(body.orderId);
      setManualCode("");
      if (action === "send_message") setMessage("");
      haptic.notify("success");
      toast(body.message, "success");
      await (selectedId ? loadSelected(selectedId) : load(true));
    } catch (error) {
      haptic.notify("error");
      toast(error instanceof Error ? error.message : "Действие не выполнено", "error");
    } finally {
      setBusy(null);
    }
  }

  const orders = useMemo(() => {
    const all = data?.orders ?? [];
    const needle = query.trim().toLowerCase();
    const searched = needle
      ? all.filter((order) => [
        order.wbOrderId,
        order.buyerName,
        order.activationCode,
        order.vendorCode,
        order.fulfillment?.robloxUsername,
        order.denomination != null ? String(order.denomination) : null,
      ].some((value) => value?.toLowerCase().includes(needle)))
      : all;
    // A search is a search: it looks across every queue, not inside the tab.
    if (needle) return searched;
    if (focus) return searched.filter(FOCUS[focus].match);
    if (tab === "done") return searched.filter((order) => WB_TERMINAL_STAGES.includes(order.stage));
    if (tab === "urgent") return searched.filter((order) => WB_URGENT_STAGES.includes(order.stage));
    return searched.filter((order) => !WB_TERMINAL_STAGES.includes(order.stage));
  }, [data?.orders, focus, query, tab]);

  const grouped = useMemo(() => {
    if (query.trim() || focus || tab !== "active") return null;
    return WB_QUEUE_SECTIONS
      .map((section) => ({ ...section, orders: orders.filter((order) => (section.stages as readonly string[]).includes(order.stage)) }))
      .filter((section) => section.orders.length > 0);
  }, [focus, orders, query, tab]);

  const selected = data?.orders.find((order) => order.id === selectedId) ?? null;

  if (loading) return <div className={css.loading}>{[1,2,3].map((item) => <i key={item} />)}</div>;
  if (!data) return <div className={css.empty}><AlertTriangle /><strong>Контур недоступен</strong><button onClick={() => void load()}>Повторить</button></div>;

  if (selected) {
    return <>
      <OrderDetail
        order={selected}
        data={data}
        busy={busy}
        manualCode={manualCode}
        message={message}
        setManualCode={setManualCode}
        setMessage={setMessage}
        onBack={() => { haptic.select(); setSelectedId(null); void load(true); }}
        onAction={(action, extra) => void act(action, selected, extra)}
        onConfirm={setConfirming}
        post={post}
        onCreated={async (text) => { toast(text, "success"); haptic.notify("success"); await loadSelected(selected.id); }}
      />
      <ConfirmSheet
        request={confirming}
        busy={busy}
        onClose={() => setConfirming(null)}
        onConfirm={(action) => { setConfirming(null); void act(action, selected); }}
      />
    </>;
  }

  const heroNumbers = [
    ["attention", data.metrics.attention, "проверить", data.metrics.attention ? css.alertNumber : ""],
    ["waitingCode", data.metrics.waitingCode, "ждут код", ""],
    ["readyReceive", data.metrics.readyReceive, "закрыть", data.metrics.readyReceive ? css.hotNumber : ""],
    ["inBot", data.metrics.inBot, "в боте", ""],
  ] as const;

  return (
    <div className={css.screen}>
      <section className={css.hero}>
        <div className={css.heroTop}><span className={data.environment.workerStatus === "HEALTHY" ? css.okDot : css.warnDot} /><div><strong>{data.environment.workerStatus === "HEALTHY" ? "DBS на связи" : "Нужна проверка"}</strong><small>{data.environment.workerLastSeenAt ? dateTime(data.environment.workerLastSeenAt) : "ещё не запускался"}</small></div><button onClick={() => void act("sync", null)} disabled={Boolean(busy)} aria-label="Синхронизировать"><RefreshCw className={busy === "sync" ? css.spin : ""} /></button></div>
        <div className={css.heroNumbers}>{heroNumbers.map(([id, value, label, extra]) => (
          <button
            type="button"
            key={id}
            className={`${extra} ${focus === id ? css.numberActive : ""}`.trim()}
            aria-pressed={focus === id}
            onClick={() => { haptic.select(); setQuery(""); setFocus(focus === id ? null : id); }}
          >
            <strong>{value}</strong><small>{label}</small>
          </button>
        ))}</div>
        <div className={css.heroSafety}><ShieldCheck /><span>Коды получения зашифрованы · открываются только в карточке заказа</span></div>
      </section>

      <div className={css.searchField}>
        <Search />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Имя, номер WB, код, ник Roblox"
          aria-label="Поиск по заказам DBS"
        />
        {query && <button type="button" onClick={() => { haptic.select(); setQuery(""); }} aria-label="Очистить"><X /></button>}
      </div>

      {!query.trim() && <section className={css.toolbar}>
        <div>{([ ["urgent", "Срочные"], ["active", "В работе"], ["done", "Готово"] ] as const).map(([id,label]) => <button key={id} className={!focus && tab === id ? css.tabActive : ""} onClick={() => { haptic.select(); setFocus(null); setTab(id); }}>{label}{id === "urgent" && data.metrics.urgent > 0 ? <b>{data.metrics.urgent}</b> : null}</button>)}</div>
      </section>}

      {focus && <button type="button" className={css.focusChip} onClick={() => { haptic.select(); setFocus(null); }}>
        <span>{FOCUS[focus].label}</span><b>{orders.length}</b><X />
      </button>}

      {query.trim() && <div className={css.searchSummary}>Найдено: <b>{orders.length}</b> · поиск идёт по всем очередям</div>}

      <div className={css.orderList}>
        {grouped
          ? grouped.map((section) => (
            <div key={section.id} className={css.section}>
              <div className={css.sectionHead}><strong>{section.title}</strong><span>{section.hint}</span><b>{section.orders.length}</b></div>
              {section.orders.map((order) => <OrderRow key={order.id} order={order} onOpen={() => { haptic.impact("light"); setSelectedId(order.id); }} />)}
            </div>
          ))
          : orders.map((order) => <OrderRow key={order.id} order={order} onOpen={() => { haptic.impact("light"); setSelectedId(order.id); }} />)}
        {!orders.length && <div className={css.empty}><Truck /><strong>{query.trim() ? "Ничего не найдено" : focus ? FOCUS[focus].empty : tab === "urgent" ? "Срочных заказов нет" : "В этой очереди пусто"}</strong><span>{query.trim() ? "Попробуйте имя покупателя, номер заказа или код." : "Здесь только реальные заказы WB."}</span></div>}
      </div>
    </div>
  );
}

function OrderRow({ order, onOpen }: { order: WbDeliveryOrderDto; onOpen: () => void }) {
  const hint = WB_FUNNEL_HINT[order.funnelStep];
  return (
    <button type="button" className={`${css.orderCard} ${css[`stage_${order.stage}`] ?? ""}`} onClick={onOpen}>
      <div className={css.cardTop}><span>{orderSubtitle(order)}</span><time>{dateTime(order.updatedAt)}</time></div>
      <div className={css.cardMain}>
        <span className={css.cardIcon}>{order.stage === "ready_receive" ? <PackageCheck /> : order.stage === "code_received" ? <KeyRound /> : order.buyerName ? <UserRound /> : <Truck />}</span>
        <div>
          <strong>{orderTitle(order)}</strong>
          <p>{order.denomination ? `${order.denomination.toLocaleString("ru-RU")} R$` : "нет номинала"} · {money(order.finalPriceKopecks)}</p>
        </div>
        <ChevronRight />
      </div>
      <div className={css.cardFooter}>
        <span><MessageCircle /> {order.chatReady ? "чат открыт" : "ждём чат"}</span>
        {order.fulfillment?.robloxUsername
          ? <span><UserRound /> {order.fulfillment.robloxUsername}</span>
          : hint ? <span><Clock3 /> {hint}</span> : null}
      </div>
    </button>
  );
}

/** The irreversible actions get a real verification screen with the facts of the
 * order, not a one-line browser prompt (docs/wb-dbs-delivery-plan.md §8). */
function ConfirmSheet({ request, busy, onClose, onConfirm }: {
  request: { action: WbDeliveryAction; title: string; body: string; cta: string; facts: [string, string][] } | null;
  busy: WbDeliveryAction | null;
  onClose: () => void;
  onConfirm: (action: WbDeliveryAction) => void;
}) {
  return (
    <BottomSheet
      open={request !== null}
      onClose={onClose}
      ariaLabel={request?.title ?? "Подтверждение"}
      className={css.confirmSheet}
      footer={request && (
        <div className={css.confirmActions}>
          <button type="button" className={css.confirmCancel} onClick={onClose}>Отмена</button>
          <button type="button" className={css.confirmGo} disabled={Boolean(busy)} onClick={() => onConfirm(request.action)}>
            {busy === request.action ? <Loader2 className={css.spin} /> : null}{request.cta}
          </button>
        </div>
      )}
    >
      {request && (
        <div className={css.confirmBody}>
          <strong>{request.title}</strong>
          <p>{request.body}</p>
          <dl>{request.facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        </div>
      )}
    </BottomSheet>
  );
}

function OrderDetail({ order, data, busy, manualCode, message, setManualCode, setMessage, onBack, onAction, onConfirm, post, onCreated }: {
  order: WbDeliveryOrderDto;
  data: WbDeliveryOverview;
  busy: WbDeliveryAction | null;
  manualCode: string;
  message: string;
  setManualCode: (value: string) => void;
  setMessage: (value: string) => void;
  onBack: () => void;
  onAction: (action: WbDeliveryAction, extra?: Record<string, unknown>) => void;
  onConfirm: (request: { action: WbDeliveryAction; title: string; body: string; cta: string; facts: [string, string][] }) => void;
  post: (action: WbDeliveryAction, orderId: string | null, extra?: Record<string, unknown>) => Promise<{ message: string; preview?: WbGamepassPreview }>;
  onCreated: (message: string) => Promise<void>;
}) {
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const [codeShown, setCodeShown] = useState(false);
  const chat = useMemo(() => [...order.chat].reverse(), [order.chat]);

  // A chat that opens on its oldest message is backwards; the newest line is
  // the one the operator came to read.
  useEffect(() => {
    const node = messagesRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [chat.length]);

  // Closing the WB delivery is the one step with a deadline we cannot replay,
  // so it outranks minting and sending the gate — the same order the worker
  // uses (tryAutoReceive before tryAutoGate).
  const next = order.permissions.receive
    ? { action: "receive" as const, icon: <PackageCheck />, title: "Закрыть доставку на WB", text: "Код покупателя уйдёт в WB один раз и будет удалён", button: "Закрыть заказ" }
    : order.permissions.requestCode
      ? { action: "request_code" as const, icon: <MessageCircle />, title: "Запросить код", text: "Покупатель получит инструкцию в чат WB", button: "Отправить инструкцию" }
      : order.permissions.remindCode
        ? { action: "remind_code" as const, icon: <Clock3 />, title: "Ждём код покупателя", text: "Запрос уже отправлен, код подхватится сам", button: "Напомнить о коде" }
        : order.permissions.issueGate
          ? { action: "issue_gate" as const, icon: <KeyRound />, title: "Выпустить WB-гейт", text: `Персональный код на ${order.denomination} R$`, button: "Выпустить код" }
          : order.permissions.sendGate
            ? { action: "send_gate" as const, icon: <Send />, title: "Отправить гейт", text: "Ссылка и код уйдут в чат покупателя", button: "Отправить покупателю" }
            : null;

  function confirmReceive() {
    haptic.impact("medium");
    onConfirm({
      action: "receive",
      title: "Закрыть доставку на WB?",
      body: "WB примет код покупателя один раз. После успеха код удаляется, отменить действие нельзя.",
      cta: "Закрыть заказ",
      facts: [
        ["Покупатель", order.buyerName ?? "имя не пришло"],
        ["Заказ WB", `#${order.wbOrderId}`],
        ["Номинал", order.denomination ? `${order.denomination.toLocaleString("ru-RU")} R$` : "не настроен"],
        ["Статус WB", wbSupplierStatusLabel(order.supplierStatus)],
        ["Код гейта", order.activationCode ?? "ещё не выпущен"],
        ["Код покупателя", order.deliveryCode.valid ? "получен и действует" : "нет действующего кода"],
      ],
    });
  }

  return <div className={css.detailScreen}>
    <button type="button" className={css.back} onClick={onBack}><ChevronLeft /> Очередь</button>
    <section className={css.detailHero}>
      <div>
        <span className={`${css.detailStage} ${css[`stage_${order.stage}`] ?? ""}`}>{orderSubtitle(order)}</span>
        <h2>{order.buyerName ?? `WB #${order.wbOrderId}`}</h2>
        <p>{order.buyerName ? `WB #${order.wbOrderId} · ` : ""}{order.denomination ?? "—"} R$ · {money(order.finalPriceKopecks)} · {order.vendorCode ?? `nmID ${order.nmId}`}</p>
      </div>
      <div className={css.detailStatus}><span>WB</span><strong>{wbSupplierStatusLabel(order.supplierStatus)}</strong><small>{wbSupplierStatusLabel(order.wbStatus)}</small></div>
    </section>
    <div className={css.mobileFlags}><span className={data.environment.cryptoReady ? css.flagOn : css.flagOff}>шифрование</span><span className={data.environment.chatSendEnabled ? css.flagOn : css.flagOff}>чат {data.environment.chatSendEnabled ? "on" : "off"}</span><span className={data.environment.mutationsEnabled ? css.flagOn : css.flagOff}>WB {data.environment.mutationsEnabled ? "on" : "off"}</span></div>
    {order.lastErrorCode && <div className={css.mobileError}><AlertTriangle /><div><strong>Остановитесь и сверьте WB</strong><span>{order.lastErrorCode}</span></div></div>}
    {order.unserved && <div className={css.mobileError}><AlertTriangle /><div><strong>Покупатель не получил код</strong><span>{order.blockedReason}</span></div></div>}
    {!order.unserved && !order.lastErrorCode && order.blockedReason && <div className={css.mobileError}><AlertTriangle /><div><strong>{order.cancelledAt ? "Отменён, но код на руках" : "Действия недоступны"}</strong><span>{order.blockedReason}</span></div></div>}
    {next && <section className={`${css.nextCard} ${next.action === "receive" ? css.nextDanger : ""}`}><span>{next.icon}</span><div><strong>{next.title}</strong><p>{next.text}</p><button disabled={Boolean(busy)} onClick={() => next.action === "receive" ? confirmReceive() : onAction(next.action)}>{busy === next.action ? <Loader2 className={css.spin} /> : <ChevronRight />}{next.button}</button></div></section>}
    {order.stage === "complete" && !order.unserved && <div className={css.completeCard}><CheckCircle2 /><div><strong>Заказ завершён</strong><span>Код получения удалён, покупатель прошёл воронку до конца.</span></div></div>}

    <section className={css.infoGrid}>
      <div>
        <span>Код покупателя</span>
        <strong>{order.deliveryCode.valid ? (codeShown && order.deliveryCode.value ? order.deliveryCode.value : "Получен · скрыт") : order.deliveryCode.consumedAt ? "Использован" : "Не получен"}</strong>
        {order.deliveryCode.valid && order.deliveryCode.value
          ? <button type="button" className={css.revealButton} onClick={() => { haptic.select(); setCodeShown((value) => !value); }}>{codeShown ? "Скрыть" : "Показать"}</button>
          : <small>{order.deliveryCode.expiresAt ? `до ${dateTime(order.deliveryCode.expiresAt)}` : "нет секрета"}</small>}
      </div>
      <div>
        <span>Код гейта</span>
        <strong>{order.activationCode ?? "Не выпущен"}</strong>
        {order.activationCode
          ? <CopyButton value={order.gateUrl ?? order.activationCode} label="Копировать ссылку" />
          : <small>{wbGateStateLabel(order.gateState)}</small>}
      </div>
      <div><span>Покупатель в боте</span><strong>{WB_FUNNEL_LABEL[order.funnelStep]}</strong><small>{order.fulfillment?.robloxUsername ?? WB_FUNNEL_HINT[order.funnelStep] ?? "нет ника"}</small></div>
      <div><span>Гейт</span><strong>{wbGateStateLabel(order.gateState)}</strong><small>{order.fulfillment?.platform ?? "платформа неизвестна"}</small></div>
    </section>

    <section className={css.statusActions}>
      <button disabled={!order.permissions.confirm || Boolean(busy)} onClick={() => onConfirm({ action: "confirm", title: "Подтвердить сборку?", body: "WB переведёт заказ в статус «на сборке».", cta: "Подтвердить", facts: [["Покупатель", order.buyerName ?? "—"], ["Заказ WB", `#${order.wbOrderId}`]] })}><Check /> Сборка</button>
      <button disabled={!order.permissions.deliver || Boolean(busy)} onClick={() => onConfirm({ action: "deliver", title: "Передать в доставку?", body: "WB переведёт заказ в статус «в доставке».", cta: "Передать", facts: [["Покупатель", order.buyerName ?? "—"], ["Заказ WB", `#${order.wbOrderId}`]] })}><Truck /> В доставку</button>
      {order.permissions.markServedExternally && <button disabled={Boolean(busy)} onClick={() => onConfirm({ action: "mark_served_externally", title: "Выдано вне системы?", body: "Обязательство закроется без выпуска кода. Действие попадёт в аудит.", cta: "Закрыть заказ", facts: [["Покупатель", order.buyerName ?? "—"], ["Заказ WB", `#${order.wbOrderId}`]] })}><Check /> Выдано вне системы</button>}
      {order.permissions.markGateSent && <button disabled={Boolean(busy)} onClick={() => onConfirm({ action: "mark_gate_sent", title: "Гейт отправлен вручную?", body: "Отметьте только если ссылка и код действительно ушли покупателю из кабинета WB.", cta: "Зафиксировать", facts: [["Код гейта", order.activationCode ?? "—"], ["Заказ WB", `#${order.wbOrderId}`]] })}><Send /> Гейт отправлен вручную</button>}
    </section>

    {order.permissions.createInternalOrder && (
      <BuyoutSection
        key={order.id}
        order={order}
        onPreview={(gamepass) => post("preview_gamepass", order.id, { gamepass })}
        onCreate={(gamepass, robloxUsername, force) => post("create_internal_order", order.id, { gamepass, robloxUsername, force })}
        onDone={onCreated}
      />
    )}

    <section className={css.mobileManual}><div><strong>Резервный ввод 5–7 цифр</strong><small>Если событие чата задержалось</small></div><div><input value={manualCode} onChange={(event) => setManualCode(event.target.value.replace(/\D/g, "").slice(0,7))} inputMode="numeric" autoComplete="off" maxLength={7} placeholder="123456" /><button disabled={!order.permissions.saveDeliveryCode || manualCode.length < 5 || Boolean(busy)} onClick={() => onAction("save_delivery_code", { code: manualCode })}>Сохранить</button></div></section>

    <section className={css.mobileChat}>
      <header><div><MessageCircle /><span><strong>{order.buyerName ? `Чат · ${order.buyerName}` : "Чат покупателя"}</strong><small>{order.chatReady ? "автообновление каждые 5 с" : "ждём чат · автообновление включено"}</small></span></div><b>{order.chat.length}</b></header>
      <div className={css.mobileMessages} ref={messagesRef}>{chat.map((event) => <div key={event.id} className={event.direction === "seller" ? css.mobileOut : css.mobileIn}><p>{event.text || "Событие чата"}</p><span>{event.containsDeliveryCode && <ShieldCheck />} {dateTime(event.sentAt)}{event.pending ? " · отправляется" : ""}</span></div>)}</div>
      <div className={css.mobileComposer}><textarea value={message} onChange={(event) => setMessage(event.target.value)} rows={2} placeholder="Сообщение покупателю…" /><button disabled={!order.permissions.sendMessage || !message.trim() || Boolean(busy)} onClick={() => onAction("send_message", { message })}><Send /></button></div>
    </section>

    <section className={css.mobileAudit}><strong>Хронология</strong>{order.audit.slice(0,8).map((event) => <div key={event.id}><span><Check /></span><p>{wbAuditLabel(event.type)}<small>{dateTime(event.createdAt)}</small></p></div>)}</section>
  </div>;
}

/** The mobile twin of the desktop buyout block. Game pass search misses often
 * enough that an operator on a phone needs the same door: paste the pass, read
 * back who owns it and what it costs, create the ordinary buyout order. */
function BuyoutSection({ order, onPreview, onCreate, onDone }: {
  order: WbDeliveryOrderDto;
  onPreview: (gamepass: string) => Promise<{ preview?: WbGamepassPreview }>;
  onCreate: (gamepass: string, robloxUsername: string | undefined, force: boolean) => Promise<{ message: string }>;
  onDone: (message: string) => Promise<void>;
}) {
  const [gamepass, setGamepass] = useState("");
  const [nick, setNick] = useState("");
  const [preview, setPreview] = useState<WbGamepassPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"preview" | "create" | null>(null);
  const [blocked, setBlocked] = useState(false);

  /** Editing the pass invalidates everything read back about the old one — an
   * override must never carry over to a pass the operator has not checked. */
  function editGamepass(value: string) {
    setGamepass(value);
    setPreview(null);
    setError(null);
    setBlocked(false);
  }

  async function check() {
    setBusy("preview");
    setError(null);
    try {
      const body = await onPreview(gamepass.trim());
      setPreview(body.preview ?? null);
      if (body.preview && !nick) setNick(body.preview.robloxUsername);
      haptic.notify("success");
    } catch (e) {
      setPreview(null);
      setError(e instanceof Error ? e.message : "Геймпасс не найден");
      haptic.notify("error");
    } finally {
      setBusy(null);
    }
  }

  async function create(force: boolean) {
    setBusy("create");
    setError(null);
    try {
      const body = await onCreate(gamepass.trim(), nick.trim() || undefined, force);
      setGamepass("");
      setNick("");
      await onDone(body.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Заказ не создан");
      setBlocked(true);
      haptic.notify("error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className={css.buyoutSection}>
      <header><Gamepad2 /><div><strong>Создать заказ на выкуп</strong><small>Код {order.activationCode} не активирован — добавьте геймпасс вручную</small></div></header>
      <div className={css.buyoutRow}>
        <input value={gamepass} onChange={(event) => editGamepass(event.target.value)} placeholder="Ссылка или ID геймпасса" inputMode="url" autoComplete="off" aria-label="Геймпасс" />
        <button type="button" disabled={!gamepass.trim() || Boolean(busy)} onClick={() => void check()}>{busy === "preview" ? <Loader2 className={css.spin} /> : <Search />}</button>
      </div>
      {preview && (
        <div className={css.buyoutFacts}>
          <div><span>Геймпасс</span><strong>{preview.name}</strong></div>
          <div><span>Ник Roblox</span><input value={nick} onChange={(event) => setNick(event.target.value)} autoComplete="off" aria-label="Ник Roblox" /></div>
          <div><span>Цена</span><strong className={preview.priceOk ? css.buyoutOk : css.buyoutBad}>{preview.price.toLocaleString("ru-RU")} R$</strong><small>{preview.expectedPrice ? `ждём ${preview.expectedPrice.toLocaleString("ru-RU")} R$` : "нет номинала"}</small></div>
          <div><span>Продаётся</span><strong className={preview.isForSale ? css.buyoutOk : css.buyoutBad}>{preview.isForSale ? "да" : "нет"}</strong>{preview.duplicate ? <small className={css.buyoutBad}>дубль {preview.duplicate.wbCode}</small> : null}</div>
        </div>
      )}
      {error && <p className={css.buyoutError}><AlertTriangle /> {error}</p>}
      <button type="button" className={css.buyoutGo} disabled={!preview || Boolean(busy)} onClick={() => void create(false)}>
        {busy === "create" ? <Loader2 className={css.spin} /> : <Check />} Создать заказ
      </button>
      {blocked && preview && (
        <button type="button" className={css.buyoutForce} disabled={Boolean(busy)} onClick={() => void create(true)}>
          Всё равно создать — я проверил цену и продавца
        </button>
      )}
    </section>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={css.revealButton}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          haptic.notify("success");
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1_600);
        } catch {
          toast("Буфер обмена недоступен", "error");
        }
      }}
    >
      <Clipboard />{copied ? "Скопировано" : label}
    </button>
  );
}
