"use client";

import { useCallback, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Clipboard,
  Clock3,
  ExternalLink,
  KeyRound,
  Link2,
  Loader2,
  MessageCircle,
  PackageCheck,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Truck,
  UserRound,
  X,
} from "lucide-react";
import type {
  WbDeliveryAction,
  WbDeliveryOrderDto,
  WbDeliveryOrderResponse,
  WbDeliveryOverview,
} from "@/types/wb-delivery";
import { useVisiblePolling } from "@/hooks/useVisiblePolling";
import css from "./wb-delivery.module.css";

const FILTERS = [
  ["active", "В работе"],
  ["attention", "Внимание"],
  ["ready", "Можно завершить"],
  ["complete", "Готово"],
  ["all", "Все"],
] as const;

const STAGE_LABEL: Record<WbDeliveryOrderDto["stage"], string> = {
  attention: "Нужна проверка",
  new: "Новый заказ",
  chat_ready: "Чат открыт",
  waiting_code: "Ждём код",
  code_received: "Код получен",
  gate_ready: "Гейт готов",
  link_sent: "Ссылка отправлена",
  ready_receive: "Можно завершить",
  complete: "Завершён",
  cancelled: "Отменён",
};

const AUDIT_LABEL: Record<string, string> = {
  DEMO_CREATED: "Создан тестовый заказ",
  ORDER_SYNCED: "Заказ синхронизирован",
  DELIVERY_CODE_REQUESTED: "Запрошен код получения",
  DELIVERY_CODE_CAPTURED: "Код получения принят",
  GATE_CODE_ISSUED: "Выпущен код гейта",
  GATE_LINK_SENT: "Гейт отправлен покупателю",
  WB_CONFIRM_SUCCEEDED: "Сборка подтверждена",
  WB_DELIVER_SUCCEEDED: "Заказ передан в доставку",
  WB_RECEIVE_SUCCEEDED: "Выдача завершена",
  CHAT_MESSAGE_SENT: "Сообщение отправлено",
  GATE_SEND_STARTED: "Началась отправка гейта",
  GATE_MANUALLY_MARKED_SENT: "Гейт отмечен отправленным вручную",
  AUTO_GATE_ISSUED_AND_SENT: "Авто-гейт выпущен и отправлен",
  CHAT_SEND_FAILED: "WB отклонил отправку",
  WB_STATUS_MUTATION_FAILED: "WB отклонил смену статуса",
  DELIVERY_CODE_EXPIRED: "Код получения истёк",
};

function money(value: number | null) {
  if (value == null) return "—";
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB" }).format(value / 100);
}

function dateTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function filterOrder(order: WbDeliveryOrderDto, filter: typeof FILTERS[number][0]) {
  if (filter === "all") return true;
  if (filter === "complete") return order.stage === "complete" || order.stage === "cancelled";
  if (filter === "attention") return order.stage === "attention";
  if (filter === "ready") return order.stage === "ready_receive";
  return !order.completedAt && !order.cancelledAt;
}

/** Both status buttons are gated on what WB itself reports, so an operator who
 * already advanced the order in the seller cabinet needs to see that, not a
 * dead button. */
function statusHint(order: WbDeliveryOrderDto, action: "confirm" | "deliver") {
  if (order.permissions[action]) return undefined;
  if (order.completedAt || order.cancelledAt) return "Заказ уже закрыт.";
  if (order.blockedReason) return order.blockedReason;
  if (action === "confirm") return `WB уже держит заказ в статусе «${order.supplierStatus}» — сборка подтверждена.`;
  return /deliver|receive|sold/i.test(order.supplierStatus)
    ? `WB уже держит заказ в статусе «${order.supplierStatus}».`
    : "Сначала подтвердите сборку — WB принимает «в доставку» только после confirm.";
}

function stageIndex(order: WbDeliveryOrderDto) {
  if (order.stage === "complete") return 5;
  if (["ready_receive", "link_sent"].includes(order.stage)) return 4;
  if (["gate_ready"].includes(order.stage)) return 3;
  if (["code_received"].includes(order.stage)) return 2;
  if (["waiting_code", "chat_ready"].includes(order.stage)) return 1;
  return 0;
}

export default function WbDeliveryClient({ initialData }: { initialData: WbDeliveryOverview }) {
  const [data, setData] = useState(initialData);
  const [selectedId, setSelectedId] = useState(initialData.orders[0]?.id ?? "");
  const [filter, setFilter] = useState<typeof FILTERS[number][0]>("active");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<WbDeliveryAction | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [manualCode, setManualCode] = useState("");
  const [message, setMessage] = useState("");

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setBusy("sync");
    try {
      const response = await fetch("/api/admin/wb-delivery", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Не удалось обновить очередь");
      setData(body);
      setSelectedId((current) => body.orders.some((order: WbDeliveryOrderDto) => order.id === current) ? current : body.orders[0]?.id ?? "");
    } catch (error) {
      if (!silent) setNotice({ tone: "error", text: error instanceof Error ? error.message : "Ошибка обновления" });
    } finally {
      if (!silent) setBusy(null);
    }
  }, []);

  const refreshSelected = useCallback(async (orderId: string) => {
    try {
      const response = await fetch(`/api/admin/wb-delivery?orderId=${encodeURIComponent(orderId)}`, { cache: "no-store" });
      if (response.status === 404) {
        await refresh(true);
        return;
      }
      const body = await response.json() as WbDeliveryOrderResponse & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Не удалось обновить чат");
      setData((current) => {
        const index = current.orders.findIndex((order) => order.id === body.order.id);
        if (index < 0) return current;
        const orders = [...current.orders];
        orders[index] = body.order;
        return { ...current, generatedAt: body.generatedAt, orders };
      });
    } catch {
      // Silent polling retries on the next cycle and immediately after focus returns.
    }
  }, [refresh]);

  const pollOverview = useCallback(() => refresh(true), [refresh]);
  const pollSelected = useCallback(async () => {
    if (selectedId) await refreshSelected(selectedId);
  }, [refreshSelected, selectedId]);
  useVisiblePolling(pollOverview, 20_000);
  useVisiblePolling(pollSelected, 5_000, Boolean(selectedId));

  async function act(action: WbDeliveryAction, extra: Record<string, unknown> = {}) {
    const order = data.orders.find((item) => item.id === selectedId);
    if (["confirm", "deliver", "receive"].includes(action) && order && !order.isTest) {
      const label = action === "receive" ? "завершить выдачу кодом покупателя" : action === "deliver" ? "перевести заказ в доставку" : "подтвердить сборку";
      if (!window.confirm(`Подтвердите действие с реальным заказом WB: ${label}?`)) return;
    }
    setBusy(action);
    setNotice(null);
    try {
      const response = await fetch("/api/admin/wb-delivery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...(action !== "sync" && action !== "create_demo" ? { orderId: selectedId } : {}), ...extra }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Действие не выполнено");
      if (body.orderId) setSelectedId(body.orderId);
      setManualCode("");
      if (action === "send_message") setMessage("");
      setNotice({ tone: "ok", text: body.message });
      await refresh(true);
    } catch (error) {
      setNotice({ tone: "error", text: error instanceof Error ? error.message : "Действие не выполнено" });
    } finally {
      setBusy(null);
    }
  }

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return data.orders.filter((order) => filterOrder(order, filter)).filter((order) => !needle || [
      order.wbOrderId,
      order.vendorCode,
      String(order.nmId),
      String(order.denomination ?? ""),
      order.activationCode,
    ].some((value) => value?.toLowerCase().includes(needle)));
  }, [data.orders, filter, query]);
  const selected = data.orders.find((order) => order.id === selectedId) ?? visible[0] ?? null;
  const step = selected ? stageIndex(selected) : 0;

  return (
    <div className={css.workspace}>
      <section className={css.commandBar}>
        <div className={css.liveState}>
          <span className={data.environment.workerStatus === "HEALTHY" ? css.liveDot : css.warnDot} />
          <div><strong>{data.environment.workerStatus === "HEALTHY" ? "Контур на связи" : "Контур требует проверки"}</strong><small>{data.environment.workerLastSeenAt ? `Последний цикл ${dateTime(data.environment.workerLastSeenAt)}` : "Синхронизация ещё не запускалась"}</small></div>
        </div>
        <div className={css.commandActions}>
          <a href="https://seller.wildberries.ru/" target="_blank" rel="noreferrer" className={css.ghostButton}>Кабинет WB <ExternalLink /></a>
          <button type="button" className={css.ghostButton} disabled={Boolean(busy)} onClick={() => void act("create_demo")}><Sparkles /> Тестовый заказ</button>
          <button type="button" className={css.syncButton} disabled={Boolean(busy)} onClick={() => void act("sync")}><RefreshCw className={busy === "sync" ? css.spin : ""} /> Синхронизировать</button>
        </div>
      </section>

      <section className={css.metrics}>
        <article><span><Truck /></span><div><strong>{data.metrics.active}</strong><small>активных DBS</small></div></article>
        <article><span><MessageCircle /></span><div><strong>{data.metrics.waitingCode}</strong><small>ждут код покупателя</small></div></article>
        <article><span><KeyRound /></span><div><strong>{data.metrics.codeReceived}</strong><small>код уже получен</small></div></article>
        <article className={data.metrics.readyReceive ? css.readyMetric : ""}><span><PackageCheck /></span><div><strong>{data.metrics.readyReceive}</strong><small>можно завершить</small></div></article>
      </section>

      <section className={css.safetyStrip}>
        <ShieldCheck />
        <div><strong>Код получения защищён</strong><span>Он не показывается в интерфейсе, логах или истории чата и удаляется сразу после успешного завершения.</span></div>
        <div className={css.flagStack}>
          <span className={data.environment.cryptoReady ? css.flagOk : css.flagOff}>Шифрование</span>
          <span className={data.environment.chatSendEnabled ? css.flagOk : css.flagOff}>Чат {data.environment.chatSendEnabled ? "ON" : "OFF"}</span>
          <span className={data.environment.mutationsEnabled ? css.flagOk : css.flagOff}>Статусы {data.environment.mutationsEnabled ? "ON" : "OFF"}</span>
        </div>
      </section>

      {(!data.environment.chatSendEnabled || !data.environment.mutationsEnabled) && (
        <div className={css.errorBanner}>
          <AlertTriangle />
          <div>
            <strong>Внешние действия WB выключены</strong>
            <span>
              {!data.environment.chatSendEnabled && "Сообщения покупателю не уйдут (WB_CHAT_SEND_ENABLED=false). "}
              {!data.environment.mutationsEnabled && "Сборка, доставка и завершение заказа недоступны (WB_DBS_MUTATIONS_ENABLED=false). "}
              Флаги живут в Coolify на Web и TG; тестовые заказы работают в обход них.
            </span>
          </div>
        </div>
      )}

      {notice && <div className={`${css.notice} ${notice.tone === "ok" ? css.noticeOk : css.noticeError}`}><span>{notice.tone === "ok" ? <Check /> : <AlertTriangle />}</span>{notice.text}<button onClick={() => setNotice(null)} aria-label="Закрыть"><X /></button></div>}

      <section className={css.mainGrid}>
        <aside className={css.queue}>
          <div className={css.queueHead}>
            <div><strong>Очередь</strong><span>{visible.length} заказов</span></div>
            <label><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ID, артикул, код" /></label>
          </div>
          <div className={css.filters}>
            {FILTERS.map(([id, label]) => <button key={id} className={filter === id ? css.activeFilter : ""} onClick={() => setFilter(id)}>{label}</button>)}
          </div>
          <div className={css.orderList}>
            {visible.map((order) => (
              <button key={order.id} type="button" className={`${css.orderCard} ${selected?.id === order.id ? css.orderCardActive : ""}`} onClick={() => setSelectedId(order.id)}>
                <div className={css.orderTop}><span className={`${css.stagePill} ${css[`stage_${order.stage}`]}`}>{order.isTest && <Sparkles />} {STAGE_LABEL[order.stage]}</span><time>{dateTime(order.updatedAt)}</time></div>
                <strong>WB #{order.wbOrderId}</strong>
                <p>{order.denomination ? `${order.denomination.toLocaleString("ru-RU")} R$` : "Номинал не настроен"} · {money(order.finalPriceKopecks)}</p>
                <div className={css.orderMeta}><span><MessageCircle /> {order.chatReady ? "чат" : "нет чата"}</span><span><Clock3 /> {order.deliveryTo ? dateTime(order.deliveryTo) : "окно не пришло"}</span><ChevronRight /></div>
              </button>
            ))}
            {!visible.length && <div className={css.emptyQueue}><CircleDot /><strong>Здесь пока пусто</strong><span>Смените фильтр или создайте тестовый заказ.</span></div>}
          </div>
        </aside>

        {selected ? (
          <main className={css.detail}>
            <header className={css.detailHeader}>
              <div><span className={`${css.stagePill} ${css[`stage_${selected.stage}`]}`}>{STAGE_LABEL[selected.stage]}</span><h2>Заказ #{selected.wbOrderId}</h2><p>{selected.vendorCode ?? `nmID ${selected.nmId}`} · {selected.denomination ? `${selected.denomination} R$` : "номинал не найден"} · {money(selected.finalPriceKopecks)}</p></div>
              <div className={css.headerBadges}>{selected.isTest && <span><Sparkles /> Тест без WB</span>}<span><Truck /> DBS courier</span></div>
            </header>

            <div className={css.rail} aria-label="Этапы заказа">
              {["Заказ", "Запрос кода", "Код получен", "Гейт", "Выдача", "Готово"].map((label, index) => <div key={label} className={index <= step ? css.railDone : ""}><span>{index < step ? <Check /> : index + 1}</span><small>{label}</small></div>)}
            </div>

            {selected.lastErrorCode && <div className={css.errorBanner}><AlertTriangle /><div><strong>Операция остановлена</strong><span>{selected.lastErrorCode}. Сначала синхронизируйте заказ и проверьте фактический статус в кабинете WB.</span></div></div>}
            {!selected.lastErrorCode && selected.blockedReason && <div className={css.holdCard}><AlertTriangle /><div><strong>Действия по заказу недоступны</strong><span>{selected.blockedReason}</span></div></div>}

            <div className={css.detailColumns}>
              <section className={css.controlPanel}>
                <div className={css.sectionTitle}><div><span>Командный центр</span><strong>Следующее действие</strong></div><span className={css.secureTag}><ShieldCheck /> без показа кода</span></div>

                <div className={css.nextAction}>
                  {selected.permissions.requestCode && <ActionCard icon={<MessageCircle />} title="Запросить код доставки" text="Покупатель получит инструкцию, где найти 5–6 цифр рядом с QR-кодом." button="Отправить инструкцию" busy={busy === "request_code"} onClick={() => void act("request_code")} />}
                  {selected.permissions.remindCode && <ActionCard icon={<Clock3 />} title="Запрос уже отправлен" text="Ждём код от покупателя — он подхватится автоматически. Можно напомнить тем же текстом." button="Напомнить о коде" busy={busy === "remind_code"} onClick={() => void act("remind_code")} />}
                  {selected.permissions.simulateBuyerCode && <ActionCard icon={<Sparkles />} title="Имитировать ответ покупателя" text="Система создаст и тут же зашифрует тестовый код. Внешних вызовов не будет." button="Покупатель прислал код" busy={busy === "simulate_buyer_code"} onClick={() => void act("simulate_buyer_code")} />}
                  {selected.permissions.issueGate && <ActionCard icon={<KeyRound />} title="Выпустить персональный WB-гейт" text={`Номинал ${selected.denomination} R$ и связь с заказом будут зафиксированы навсегда.`} button="Выпустить код" busy={busy === "issue_gate"} onClick={() => void act("issue_gate")} />}
                  {selected.permissions.sendGate && <ActionCard icon={<Send />} title="Отправить ссылку и код" text="Покупатель получит готовую ссылку на гейт и свой 7-значный код." button="Отправить покупателю" busy={busy === "send_gate"} onClick={() => void act("send_gate")} />}
                  {selected.permissions.receive && <ActionCard icon={<PackageCheck />} title="Завершить выдачу на WB" text="Зашифрованный код будет отправлен в WB один раз и сразу удалён после успеха." button="Завершить заказ" danger busy={busy === "receive"} onClick={() => void act("receive")} />}
                  {selected.stage === "complete" && <div className={css.doneCard}><CheckCircle2 /><div><strong>Заказ полностью завершён</strong><span>WB подтвердил выдачу, секретный код очищен.</span></div></div>}
                  {selected.stage === "attention" && <div className={css.holdCard}><AlertTriangle /><div><strong>Нужна ручная сверка</strong><span>Не повторяйте последнее действие вслепую. Нажмите «Синхронизировать» и сверьте кабинет WB.</span></div></div>}
                </div>

                <div className={css.statusCards}>
                  <div><span>Код доставки</span><strong className={selected.deliveryCode.valid ? css.goodText : ""}>{selected.deliveryCode.valid ? "Получен · скрыт" : selected.deliveryCode.consumedAt ? "Использован · удалён" : "Не получен"}</strong><small>{selected.deliveryCode.expiresAt ? `действует до ${dateTime(selected.deliveryCode.expiresAt)}` : "в базе нет открытого секрета"}</small></div>
                  <div><span>Персональный гейт</span><strong>{selected.activationCode ?? "Не выпущен"}</strong>{selected.gateUrl ? <button onClick={() => void navigator.clipboard.writeText(selected.gateUrl!)}><Clipboard /> Копировать ссылку</button> : <small>появится после кода доставки</small>}</div>
                  <div><span>Статусы WB</span><strong>{selected.supplierStatus} · {selected.wbStatus}</strong><small>обновляются из Marketplace API</small></div>
                  <div><span>Внутреннее исполнение</span><strong>{selected.fulfillment?.status ?? "Ещё не активирован"}</strong><small>{selected.fulfillment?.robloxUsername ?? "покупатель ещё не дошёл до Roblox"}</small></div>
                </div>

                <div className={css.manualBlock}>
                  <div><strong>Резервный ввод кода</strong><span>Если событие чата задержалось, введите 5–6 цифр вручную. После отправки поле очищается.</span></div>
                  <div><input inputMode="numeric" autoComplete="off" maxLength={6} value={manualCode} onChange={(event) => setManualCode(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="5–6 цифр" aria-label="Код доставки WB" /><button disabled={!selected.permissions.saveDeliveryCode || manualCode.length < 5 || Boolean(busy)} onClick={() => void act("save_delivery_code", { code: manualCode })}>Сохранить безопасно</button></div>
                </div>

                <div className={css.providerActions}>
                  <button title={statusHint(selected, "confirm")} disabled={!selected.permissions.confirm || Boolean(busy)} onClick={() => void act("confirm")}><Check /> Подтвердить сборку</button>
                  <button title={statusHint(selected, "deliver")} disabled={!selected.permissions.deliver || Boolean(busy)} onClick={() => void act("deliver")}><Truck /> Передать в доставку</button>
                  {selected.permissions.markGateSent
                    ? <button disabled={Boolean(busy)} onClick={() => window.confirm("Вы действительно отправили покупателю ссылку и код вручную в кабинете WB?") && void act("mark_gate_sent")}><Send /> Отметить отправленным</button>
                    : <a href={selected.gateUrl ?? "#"} target="_blank" aria-disabled={!selected.gateUrl}><Link2 /> Проверить гейт <ArrowUpRight /></a>}
                </div>
              </section>

              <aside className={css.chatPanel}>
                <div className={css.chatHead}><div><span><UserRound /></span><div><strong>Чат покупателя</strong><small>{selected.chatReady ? "автообновление каждые 5 с" : "покупатель ещё не открыл чат"}</small></div></div><span className={selected.chatReady ? css.online : css.offline}>{selected.chatReady ? "AUTO 5с" : "ожидание"}</span></div>
                <div className={css.messages}>
                  {[...selected.chat].reverse().map((event) => <div key={event.id} className={`${css.message} ${event.direction === "seller" ? css.messageOut : event.direction === "system" ? css.messageSystem : css.messageIn}`}><p>{event.text || "Служебное событие"}</p><span>{event.containsDeliveryCode && <><ShieldCheck /> код скрыт · </>}{dateTime(event.sentAt)}</span></div>)}
                  {!selected.chat.length && <div className={css.noMessages}><MessageCircle /><span>Сообщений пока нет</span></div>}
                </div>
                <div className={css.composer}><textarea rows={3} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Написать покупателю…" /><div><small>До 1 000 символов</small><button disabled={!selected.permissions.sendMessage || !message.trim() || Boolean(busy)} onClick={() => void act("send_message", { message })}>{busy === "send_message" ? <Loader2 className={css.spin} /> : <Send />} Отправить</button></div></div>
                <div className={css.auditTrail}><strong>История процесса</strong>{selected.audit.slice(0, 8).map((event) => <div key={event.id}><span><Check /></span><p>{AUDIT_LABEL[event.type] ?? event.type}<small>{dateTime(event.createdAt)} · {event.actor}</small></p></div>)}</div>
              </aside>
            </div>
          </main>
        ) : <div className={css.noSelection}><Truck /><strong>Выберите заказ</strong><span>Здесь появятся чат, этапы и безопасные действия.</span></div>}
      </section>
    </div>
  );
}

function ActionCard({ icon, title, text, button, onClick, busy, danger = false }: { icon: React.ReactNode; title: string; text: string; button: string; onClick: () => void; busy: boolean; danger?: boolean }) {
  return <div className={`${css.actionCard} ${danger ? css.actionDanger : ""}`}><span>{icon}</span><div><strong>{title}</strong><p>{text}</p><button disabled={busy} onClick={onClick}>{busy ? <Loader2 className={css.spin} /> : <ChevronRight />}{button}</button></div></div>;
}
