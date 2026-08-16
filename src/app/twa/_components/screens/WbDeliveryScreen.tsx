"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  KeyRound,
  Loader2,
  MessageCircle,
  PackageCheck,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Truck,
} from "lucide-react";
import { useVisiblePolling } from "@/hooks/useVisiblePolling";
import type { WbDeliveryAction, WbDeliveryOrderDto, WbDeliveryOrderResponse, WbDeliveryOverview } from "@/types/wb-delivery";
import { haptic } from "../haptics";
import { toast } from "../Toast";
import css from "./WbDeliveryScreen.module.css";

const LABEL: Record<WbDeliveryOrderDto["stage"], string> = {
  attention: "Проверить вручную",
  new: "Новый",
  chat_ready: "Чат открыт",
  waiting_code: "Ждём код",
  code_received: "Код получен",
  gate_ready: "Гейт готов",
  link_sent: "Ссылка отправлена",
  ready_receive: "Можно завершить",
  complete: "Завершён",
  cancelled: "Отменён",
};

function dateTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function money(value: number | null) {
  if (value == null) return "—";
  return `${Math.round(value / 100).toLocaleString("ru-RU")} ₽`;
}

export default function WbDeliveryScreen({ token }: { token: string }) {
  const [data, setData] = useState<WbDeliveryOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<WbDeliveryAction | null>(null);
  const [tab, setTab] = useState<"urgent" | "active" | "done">("urgent");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [manualCode, setManualCode] = useState("");
  const [message, setMessage] = useState("");

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
  useVisiblePolling(pollOverview, 20_000);
  useVisiblePolling(pollSelected, 5_000, Boolean(selectedId));

  async function act(action: WbDeliveryAction, order: WbDeliveryOrderDto | null, extra: Record<string, unknown> = {}) {
    if (["confirm", "deliver", "receive"].includes(action) && order && !order.isTest) {
      const label = action === "receive" ? "завершить реальный заказ кодом покупателя" : action === "deliver" ? "передать реальный заказ в доставку" : "подтвердить сборку реального заказа";
      if (!window.confirm(`${label}?`)) return;
    }
    haptic.impact(action === "receive" ? "heavy" : "medium");
    setBusy(action);
    try {
      const response = await fetch("/api/twa/wb-delivery", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...(order ? { orderId: order.id } : {}), ...extra }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Действие не выполнено");
      if (body.orderId) setSelectedId(body.orderId);
      setManualCode("");
      if (action === "send_message") setMessage("");
      haptic.notify("success");
      toast(body.message, "success");
      await load(true);
    } catch (error) {
      haptic.notify("error");
      toast(error instanceof Error ? error.message : "Действие не выполнено", "error");
    } finally {
      setBusy(null);
    }
  }

  const orders = useMemo(() => {
    const all = data?.orders ?? [];
    if (tab === "done") return all.filter((order) => order.completedAt || order.cancelledAt);
    if (tab === "urgent") return all.filter((order) => ["attention", "code_received", "gate_ready", "ready_receive"].includes(order.stage));
    return all.filter((order) => !order.completedAt && !order.cancelledAt);
  }, [data?.orders, tab]);
  const selected = data?.orders.find((order) => order.id === selectedId) ?? null;

  if (loading) return <div className={css.loading}>{[1,2,3].map((item) => <i key={item} />)}</div>;
  if (!data) return <div className={css.empty}><AlertTriangle /><strong>Контур недоступен</strong><button onClick={() => void load()}>Повторить</button></div>;

  if (selected) {
    return <OrderDetail order={selected} data={data} busy={busy} manualCode={manualCode} message={message} setManualCode={setManualCode} setMessage={setMessage} onBack={() => { haptic.select(); setSelectedId(null); }} onAction={(action, extra) => void act(action, selected, extra)} />;
  }

  return (
    <div className={css.screen}>
      <section className={css.hero}>
        <div className={css.heroTop}><span className={data.environment.workerStatus === "HEALTHY" ? css.okDot : css.warnDot} /><div><strong>{data.environment.workerStatus === "HEALTHY" ? "DBS на связи" : "Нужна проверка"}</strong><small>{data.environment.workerLastSeenAt ? dateTime(data.environment.workerLastSeenAt) : "ещё не запускался"}</small></div><button onClick={() => void act("sync", null)} disabled={Boolean(busy)} aria-label="Синхронизировать"><RefreshCw className={busy === "sync" ? css.spin : ""} /></button></div>
        <div className={css.heroNumbers}><div><strong>{data.metrics.active}</strong><small>в работе</small></div><div><strong>{data.metrics.waitingCode}</strong><small>ждут код</small></div><div className={data.metrics.readyReceive ? css.hotNumber : ""}><strong>{data.metrics.readyReceive}</strong><small>завершить</small></div></div>
        <div className={css.heroSafety}><ShieldCheck /><span>Коды получения зашифрованы · расшифровка только в админке</span></div>
      </section>

      <section className={css.toolbar}>
        <div>{([ ["urgent", "Срочные"], ["active", "В работе"], ["done", "Готово"] ] as const).map(([id,label]) => <button key={id} className={tab === id ? css.tabActive : ""} onClick={() => { haptic.select(); setTab(id); }}>{label}{id === "urgent" && data.metrics.attention + data.metrics.codeReceived + data.metrics.readyReceive > 0 ? <b>{data.metrics.attention + data.metrics.codeReceived + data.metrics.readyReceive}</b> : null}</button>)}</div>
        <button className={css.demoButton} onClick={() => void act("create_demo", null)} disabled={Boolean(busy)}><Sparkles /> Тест</button>
      </section>

      <div className={css.orderList}>
        {orders.map((order) => <button type="button" key={order.id} className={`${css.orderCard} ${css[`stage_${order.stage}`]}`} onClick={() => { haptic.impact("light"); setSelectedId(order.id); }}>
          <div className={css.cardTop}><span>{order.isTest && <Sparkles />} {LABEL[order.stage]}</span><time>{dateTime(order.updatedAt)}</time></div>
          <div className={css.cardMain}><span className={css.cardIcon}>{order.stage === "ready_receive" ? <PackageCheck /> : order.stage === "code_received" ? <KeyRound /> : <Truck />}</span><div><strong>WB #{order.wbOrderId}</strong><p>{order.denomination ? `${order.denomination.toLocaleString("ru-RU")} R$` : "нет номинала"} · {money(order.finalPriceKopecks)}</p></div><ChevronRight /></div>
          <div className={css.cardFooter}><span><MessageCircle /> {order.chatReady ? "чат открыт" : "ждём чат"}</span><span><Clock3 /> {order.deliveryTo ? `до ${dateTime(order.deliveryTo)}` : "без окна"}</span></div>
        </button>)}
        {!orders.length && <div className={css.empty}><Truck /><strong>{tab === "urgent" ? "Срочных заказов нет" : "В этой очереди пусто"}</strong><span>Создайте тестовый DBS-заказ, чтобы пройти весь сценарий.</span><button onClick={() => void act("create_demo", null)}><Sparkles /> Создать тест</button></div>}
      </div>
    </div>
  );
}

function OrderDetail({ order, data, busy, manualCode, message, setManualCode, setMessage, onBack, onAction }: {
  order: WbDeliveryOrderDto;
  data: WbDeliveryOverview;
  busy: WbDeliveryAction | null;
  manualCode: string;
  message: string;
  setManualCode: (value: string) => void;
  setMessage: (value: string) => void;
  onBack: () => void;
  onAction: (action: WbDeliveryAction, extra?: Record<string, unknown>) => void;
}) {
  const next = order.permissions.requestCode
    ? { action: "request_code" as const, icon: <MessageCircle />, title: "Запросить код доставки", text: "Покупатель получит инструкцию в чат WB", button: "Отправить инструкцию" }
    : order.permissions.remindCode
      ? { action: "remind_code" as const, icon: <Clock3 />, title: "Ждём код покупателя", text: "Запрос уже отправлен, код подхватится сам", button: "Напомнить о коде" }
    : order.permissions.simulateBuyerCode
      ? { action: "simulate_buyer_code" as const, icon: <Sparkles />, title: "Ответ тестового покупателя", text: "Сымитируем безопасное получение 6 цифр", button: "Покупатель прислал код" }
      : order.permissions.issueGate
        ? { action: "issue_gate" as const, icon: <KeyRound />, title: "Выпустить WB-гейт", text: `Персональный код на ${order.denomination} R$`, button: "Выпустить код" }
        : order.permissions.sendGate
          ? { action: "send_gate" as const, icon: <Send />, title: "Отправить гейт", text: "Ссылка и код уйдут в чат покупателя", button: "Отправить покупателю" }
          : order.permissions.receive
            ? { action: "receive" as const, icon: <PackageCheck />, title: "Завершить выдачу", text: "Код уйдёт в WB один раз и будет удалён", button: "Завершить заказ" }
            : null;
  return <div className={css.detailScreen}>
    <button type="button" className={css.back} onClick={onBack}><ChevronLeft /> Очередь</button>
    <section className={css.detailHero}>
      <div><span className={`${css.detailStage} ${css[`stage_${order.stage}`]}`}>{order.isTest && <Sparkles />} {LABEL[order.stage]}</span><h2>WB #{order.wbOrderId}</h2><p>{order.denomination ?? "—"} R$ · {money(order.finalPriceKopecks)} · {order.vendorCode ?? `nmID ${order.nmId}`}</p></div>
      <div className={css.detailStatus}><span>WB</span><strong>{order.supplierStatus}</strong><small>{order.wbStatus}</small></div>
    </section>
    <div className={css.mobileFlags}><span className={data.environment.cryptoReady ? css.flagOn : css.flagOff}>шифрование</span><span className={data.environment.chatSendEnabled ? css.flagOn : css.flagOff}>чат {data.environment.chatSendEnabled ? "on" : "off"}</span><span className={data.environment.mutationsEnabled ? css.flagOn : css.flagOff}>WB {data.environment.mutationsEnabled ? "on" : "off"}</span></div>
    {order.lastErrorCode && <div className={css.mobileError}><AlertTriangle /><div><strong>Остановитесь и сверьте WB</strong><span>{order.lastErrorCode}</span></div></div>}
    {order.unserved && <div className={css.mobileError}><AlertTriangle /><div><strong>Покупатель не получил код</strong><span>{order.blockedReason}</span></div></div>}
    {!order.unserved && !order.lastErrorCode && order.blockedReason && <div className={css.mobileError}><AlertTriangle /><div><strong>Действия недоступны</strong><span>{order.blockedReason}</span></div></div>}
    {next && <section className={`${css.nextCard} ${next.action === "receive" ? css.nextDanger : ""}`}><span>{next.icon}</span><div><strong>{next.title}</strong><p>{next.text}</p><button disabled={Boolean(busy)} onClick={() => onAction(next.action)}>{busy === next.action ? <Loader2 className={css.spin} /> : <ChevronRight />}{next.button}</button></div></section>}
    {order.stage === "complete" && !order.unserved && <div className={css.completeCard}><CheckCircle2 /><div><strong>Заказ завершён</strong><span>Код получения удалён, цифровая выдача продолжается по обычному сценарию.</span></div></div>}
    <section className={css.infoGrid}><div><span>Код получения</span><strong>{order.deliveryCode.valid ? (order.deliveryCode.value ?? "Получен") : order.deliveryCode.consumedAt ? "Удалён" : "Не получен"}</strong><small>{order.deliveryCode.expiresAt ? `до ${dateTime(order.deliveryCode.expiresAt)}` : "без секрета"}</small></div><div><span>Код гейта</span><strong>{order.activationCode ?? "Не выпущен"}</strong><small>{order.gateState}</small></div><div><span>Roblox-этап</span><strong>{order.fulfillment?.status ?? "Не начат"}</strong><small>{order.fulfillment?.robloxUsername ?? "нет ника"}</small></div><div><span>Доставка</span><strong>{order.deliveryTo ? dateTime(order.deliveryTo) : "Нет окна"}</strong><small>DBS courier</small></div></section>
    <section className={css.statusActions}><button disabled={!order.permissions.confirm || Boolean(busy)} onClick={() => onAction("confirm")}><Check /> Сборка</button><button disabled={!order.permissions.deliver || Boolean(busy)} onClick={() => onAction("deliver")}><Truck /> В доставку</button>{order.permissions.markGateSent && <button disabled={Boolean(busy)} onClick={() => window.confirm("Ссылка и код действительно отправлены вручную в кабинете WB?") && onAction("mark_gate_sent")}><Send /> Гейт отправлен вручную</button>}</section>
    <section className={css.mobileManual}><div><strong>Резервный ввод 5–7 цифр</strong><small>Код отобразится после сохранения</small></div><div><input value={manualCode} onChange={(event) => setManualCode(event.target.value.replace(/\D/g, "").slice(0,7))} inputMode="numeric" autoComplete="off" maxLength={7} placeholder="123456" /><button disabled={!order.permissions.saveDeliveryCode || manualCode.length < 5 || Boolean(busy)} onClick={() => onAction("save_delivery_code", { code: manualCode })}>Сохранить</button></div></section>
    <section className={css.mobileChat}><header><div><MessageCircle /><span><strong>Чат покупателя</strong><small>{order.chatReady ? "автообновление каждые 5 с" : "ждём чат · автообновление включено"}</small></span></div><b>{order.chat.length}</b></header><div className={css.mobileMessages}>{[...order.chat].reverse().map((event) => <div key={event.id} className={event.direction === "seller" ? css.mobileOut : css.mobileIn}><p>{event.text || "Событие чата"}</p><span>{event.containsDeliveryCode && <ShieldCheck />} {dateTime(event.sentAt)}</span></div>)}</div><div className={css.mobileComposer}><textarea value={message} onChange={(event) => setMessage(event.target.value)} rows={2} placeholder="Сообщение покупателю…" /><button disabled={!order.permissions.sendMessage || !message.trim() || Boolean(busy)} onClick={() => onAction("send_message", { message })}><Send /></button></div></section>
    <section className={css.mobileAudit}><strong>Хронология</strong>{order.audit.slice(0,8).map((event) => <div key={event.id}><span><Check /></span><p>{event.type}<small>{dateTime(event.createdAt)}</small></p></div>)}</section>
  </div>;
}
