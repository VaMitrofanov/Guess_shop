"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronRight,
  CircleAlert,
  Copy,
  MessageCircleQuestion,
  Plus,
  RefreshCw,
  Search,
  Snowflake,
  TriangleAlert,
  Truck,
  Clock3,
} from "lucide-react";
import { C } from "../theme";
import { ageColor, fmtAge } from "../age";
import { haptic } from "../haptics";
import { toast } from "../Toast";
import { copyText } from "../clipboard";
import type { FirstInLine, FirstInLineOrder } from "@/types/first-in-line";
import type { OverviewDiff, OverviewFeedRow } from "@/types/admin-overview";
import type { WbDeliveryQueueSnapshot } from "@/types/wb-delivery";
import type { WbDeliveryFocus } from "./WbDeliveryScreen";

/* ─────────────────────────────────────────────────────────────────────────────
   Главная = касса выкупа.

   Прежний экран открывался числом «Требует действия: 47» — суммой выкупа,
   ссылок, ошибок и неотвеченных отзывов WB. Сложить их можно, решить по ним
   нельзя: это четыре разные работы. Ниже шёл список, где «Запросить N ссылок»
   выглядел кнопкой, хотя ссылку присылает покупатель и обычно не присылает.

   Теперь экран отвечает на один вопрос — что выкупать сейчас и сколько это
   стоит, — и делит очередь по происхождению: ВБ, DBS, прямые. Всё, что не
   ведёт к решению, стало тихой строкой или уехало в свой экран.

   Поиск отсюда уехал в «Заказы» целиком: досье в шторке не умело выкупить
   заказ, а карточка в ленте умеет всё. Здесь осталась строка ввода, которая
   открывает тот самый поиск.
   ───────────────────────────────────────────────────────────────────────── */

type OrdersTab = "BUYOUT" | "AWAITING_LINK" | "STALE_LINK" | "ERROR" | "HELD" | "NEW";

interface Lane {
  id: "WB" | "WB_DBS" | "DIRECT";
  orders: number;
  clean: number;
  gross: number;
  overdue: number;
  oldestAt: string | null;
}

/* Срез доставки — общий тип с сервером и с сайтом: своя копия интерфейса уже
   один раз разошлась с сервером и показывала на главной не то, что в консоли. */
type DbsSnapshot = WbDeliveryQueueSnapshot;

interface DashData {
  today: { orders: number; sum: number; sales: number };
  week: { orders: number; sum: number };
  prevWeek: { orders: number; sum: number };
  codes: { denom: number; count: number }[];
  buyout: { orders: number; clean: number; gross: number; overdue: number; oldestAt: string | null; lanes: Lane[] };
  errors: { count: number; oldestAt: string | null; first: string | null };
  awaitingLink: { total: number; stale: number; remindersDone: number; oldestAt: string | null; staleOldestAt: string | null };
  held: { count: number; codes: string[] };
  /** ⚡ Первым делом: поднятые руками и прямые заказы. */
  firstInLine: FirstInLine | null;
  inbox: { available: boolean; feedbacks: number; questions: number; total: number };
  /** Смена: что случилось с прошлого захода этого админа. `null` — окно не собралось. */
  shift: { since: string; firstVisit: boolean; diff: OverviewDiff; feed: OverviewFeedRow[] } | null;
  dbs: DbsSnapshot | null;
  apiAvailable: boolean;
  tokenPresent?: boolean;
}

/** Полосы очереди: цвет делится с бейджем заказа, чтобы «синий» значил одно и то же. */
const LANE_META: Record<Lane["id"], { label: string; color: string }> = {
  WB:     { label: "Wildberries", color: C.green },
  WB_DBS: { label: "WB DBS",      color: C.blue },
  DIRECT: { label: "Прямые",      color: C.accent },
};

/** Как часто главная обновляется сама, пока экран на виду (решение О4). */
const LIVE_POLL_MS = 30_000;

/** Этап DBS → вкладка очереди доставки, которую открывает тап по нему. */
const STAGE_FOCUS: Record<string, WbDeliveryFocus> = {
  attention: "attention",
  waiting_code: "waitingCode",
  ready_receive: "readyReceive",
  in_bot: "inBot",
};

function robux(value: number) {
  return value.toLocaleString("ru-RU");
}

function rub(value: number) {
  return `${value.toLocaleString("ru-RU")} ₽`;
}

function plural(count: number, one: string, few: string, many: string) {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

export default function Dashboard({
  token,
  onOpenOrders,
  onOpenInbox,
  onOpenDelivery,
  onCreateOrder,
}: {
  token: string;
  onOpenOrders?: (query?: string, tab?: OrdersTab) => void;
  onOpenInbox?: () => void;
  onOpenDelivery?: (focus?: WbDeliveryFocus | null) => void;
  onCreateOrder?: (mode: "manual" | "direct") => void;
}) {
  const [data, setData] = useState<DashData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  /** Когда данные последний раз пришли с сервера — из этого «живая · N с». */
  const [syncedAt, setSyncedAt] = useState(() => Date.now());
  const [liveAge, setLiveAge] = useState(0);
  /* Окно смены держит клиент: сервер ставит отметку присутствия только на
     первой загрузке, а живой опрос присылает окно обратно. Иначе обновление
     раз в 30 секунд схлопывало бы «Пока вас не было» в ноль. */
  const shiftSince = useRef<string | null>(null);

  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const url = shiftSince.current
        ? `/api/twa/dashboard?shiftSince=${encodeURIComponent(shiftSince.current)}`
        : "/api/twa/dashboard";
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      if (response.ok) {
        const next = await response.json() as DashData;
        if (next.shift?.since) shiftSince.current = next.shift.since;
        setData(next);
        setSyncedAt(Date.now());
        setLiveAge(0);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  /* Живое обновление — раз в 30 секунд и только пока экран на виду (решение О4
     от 03.09.2026). Свёрнутое приложение сервер не дёргает. */
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    const tick = window.setInterval(() => {
      setLiveAge(Math.round((Date.now() - syncedAt) / 1000));
      if (document.visibilityState !== "visible") return;
      if (Date.now() - syncedAt < LIVE_POLL_MS) return;
      void loadRef.current(false);
    }, 1000);
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - syncedAt >= LIVE_POLL_MS) void loadRef.current(false);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.clearInterval(tick); document.removeEventListener("visibilitychange", onVisible); };
  }, [syncedAt]);

  /* ── Работа прямо из «Первым делом» ────────────────────────────────────
     Типовой шаг смены — скопировал ID, вставил в донора, вернулся отметить
     «выкуплено». На ноутбуке он уже делается из блока; на телефоне за теми же
     двумя действиями приходилось уходить в «Заказы» и искать там строку,
     которая только что была на экране. */
  const [bought, setBought] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState<Set<string>>(() => new Set());
  const [noteEdit, setNoteEditState] = useState<{ id: string; value: string } | null>(null);
  const [noteSaving, setNoteSaving] = useState<string | null>(null);
  /* Зеркало правки в ref: поле сохраняется по blur, а Esc снимает правку и тем
     же движением убирает поле с экрана — без зеркала «отменил» и «ушёл из
     поля» приходят в одном порядке и Esc всё равно сохранял бы набранное. */
  const noteEditRef = useRef<{ id: string; value: string } | null>(null);
  const setNoteEdit = useCallback((next: { id: string; value: string } | null) => {
    noteEditRef.current = next;
    setNoteEditState(next);
  }, []);

  const post = useCallback(async (payload: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> => {
    try {
      const response = await fetch("/api/twa/orders", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) return { ok: false, error: body?.error ?? `сервер ответил ${response.status}` };
      return { ok: true };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  }, [token]);

  /* ID пассов пачкой и построчно. `flatMap`, а не `map`: у разбитого заказа их
     несколько, и повтор одного пасса не схлопывается — две части на одном
     пассе это две покупки с РАЗНЫХ доноров, и в буфере их должно быть две. */
  const copyFirstIds = useCallback((orders: FirstInLineOrder[], label: string) => {
    const ids = orders.flatMap(order => order.gamepassIds);
    if (ids.length === 0) { haptic.notify("error"); toast(`${label}: пассов ещё нет`, "error"); return; }
    copyText(ids.join("\n"));
    haptic.impact("light");
    // Заказов и ID может быть разное количество — говорим оба числа, иначе
    // «скопировано 3» на двух заказах выглядит ошибкой.
    const skipped = orders.filter(order => order.gamepassIds.length === 0).length;
    toast(
      `⧉ ${label}: ${ids.length} ID`
      + (ids.length !== orders.length ? ` из ${orders.length} заказов` : "")
      + (skipped > 0 ? ` · без пасса: ${skipped}` : ""),
      "success",
    );
  }, []);

  /* Заметка правится прямо в строке. `keepTags` бережёт машинный аудит
     (`[РАЗБИВКА …]`, `[ЦЕНА-СТОП …]`): в узкое поле он не показывается, и без
     флага сохранение стёрло бы то, чего админ не видел. */
  const saveNote = useCallback(async (order: FirstInLineOrder, value: string) => {
    const next = value.trim();
    setNoteEdit(null);
    if (next === (order.note ?? "")) return;
    setNoteSaving(order.id);
    const result = await post({ action: "set-note", orderId: order.id, note: next, keepTags: true });
    setNoteSaving(null);
    if (!result.ok) { haptic.notify("error"); toast(`${order.wbCode}: ${result.error}`, "error"); return; }
    // Правим строку на месте: перезагрузка главной сбросила бы прокрутку.
    setData(prev => (prev?.firstInLine
      ? { ...prev, firstInLine: { ...prev.firstInLine, rows: prev.firstInLine.rows.map(row => (
          row.id === order.id ? { ...row, note: next || null } : row)) } }
      : prev));
    haptic.notify("success");
    toast(next ? `✎ ${order.wbCode}: заметка сохранена` : `✎ ${order.wbCode}: заметка снята`, "success");
  }, [post, setNoteEdit]);

  /* «Выкуплено» здесь — то же необратимое действие, что и в «Заказах»: клиенту
     уходит сообщение, обратного хода нет. Поэтому кнопка отделена щелью от
     безобидного копирования, которое жмут в десять раз чаще. */
  const completeOne = useCallback(async (order: FirstInLineOrder) => {
    setBusy(prev => new Set(prev).add(order.id));
    haptic.impact("medium");
    const result = await post({ action: "complete", orderId: order.id });
    setBusy(prev => { const next = new Set(prev); next.delete(order.id); return next; });
    if (!result.ok) { haptic.notify("error"); toast(`${order.wbCode}: ${result.error}`, "error"); return; }
    setBought(prev => new Set(prev).add(order.id));
    haptic.notify("success");
    toast(`✓ ${order.wbCode} выкуплен · ${robux(order.amount)} R$ клиенту`, "success");
  }, [post]);

  if (loading) return <Skeleton />;
  if (!data) return <ErrorState onRetry={() => void load(true)} />;

  const { buyout, errors, awaitingLink, held, inbox, dbs } = data;
  const totalCodes = data.codes.reduce((sum, code) => sum + code.count, 0);
  const activeLanes = buyout.lanes.filter(lane => lane.orders > 0);
  // Отмеченные выкупленными уходят из блока сразу: живой опрос подтвердит их
  // уход через полминуты, а строка «выкупи меня» всё это время висела бы.
  const firstInLine = (data.firstInLine?.rows ?? []).filter(order => !bought.has(order.id));
  const firstInLineIds = firstInLine.reduce((sum, order) => sum + order.gamepassIds.length, 0);
  // Грязные считаются на ВСЕ такие заказы, а показанных строк может быть
  // меньше — поэтому вычитаем только что выкупленные, а не суммируем видимые.
  const firstInLineGross = (data.firstInLine?.rows ?? [])
    .reduce((sum, order) => (bought.has(order.id) ? sum - order.gross : sum), data.firstInLine?.gross ?? 0);
  // «В боте» — не задача: покупатель уже с кодом идёт по нашей воронке, а
  // доставка WB к этому моменту закрыта (иначе гейт бы не ушёл). Решения
  // требует только незакрытая доставка или ход за нами.
  const dbsNeedsDecision = Boolean(dbs && (dbs.unclosed > 0 || dbs.needsUs > 0));
  const dbsOldest = dbs?.unclosed ? dbs.unclosedOldestAt : dbs?.needsUsOldestAt ?? null;

  function openOrders(tab: OrdersTab) {
    haptic.select();
    onOpenOrders?.(undefined, tab);
  }

  function submitSearch() {
    const value = query.trim();
    if (value.length < 2) return;
    haptic.select();
    onOpenOrders?.(value);
  }

  return (
    <div className="twa-liquid-dashboard twa-fade-in">
      {/* Поиск — вход в единственный поиск приложения, а не второй его движок. */}
      <div className="twa-search-field twa-home-search">
        <Search size={20} />
        <input
          value={query}
          onChange={event => setQuery(event.target.value)}
          onKeyDown={event => { if (event.key === "Enter") submitSearch(); }}
          enterKeyHint="search"
          placeholder="Код, ник, @username, ID геймпасса"
          aria-label="Поиск по заказам"
        />
        {query.trim().length >= 2 && (
          <button type="button" className="twa-home-search-go" onClick={submitSearch}>Найти</button>
        )}
      </div>

      {!data.apiAvailable && (
        <div className="twa-liquid-alert">
          <CircleAlert size={19} />
          <div><strong>WB API недоступен</strong><span>Очереди из БД работают{data.tokenPresent === false ? " · токен WB не задан" : ""}</span></div>
        </div>
      )}

      {/* ── Касса выкупа ─────────────────────────────────────────────────── */}
      <section className="twa-till">
        <header className="twa-till-head">
          <span>К выкупу</span>
          <div>
            <b>{buyout.orders} {plural(buyout.orders, "заказ", "заказа", "заказов")}</b>
            <button
              type="button"
              className="twa-till-refresh twa-press-sm"
              aria-label="Обновить очереди"
              disabled={refreshing}
              onClick={() => { haptic.select(); void load(true); }}
            >
              <RefreshCw size={16} className={refreshing ? "is-spinning" : ""} />
            </button>
          </div>
        </header>

        <button type="button" className="twa-till-figure twa-press-sm" onClick={() => openOrders("BUYOUT")}>
          <strong>{robux(buyout.gross)}<small>R$</small></strong>
          <span>грязными · <b>{robux(buyout.clean)} R$</b> чистыми клиенту</span>
        </button>

        {buyout.orders > 0 && (
          <div className="twa-till-age" style={{ color: ageColor(buyout.oldestAt) }}>
            <Clock3 size={15} />
            <b>старейший {fmtAge(buyout.oldestAt)}</b>
            {buyout.overdue > 0 && <span>· {buyout.overdue} {plural(buyout.overdue, "ждёт", "ждут", "ждут")} дольше 12 ч</span>}
          </div>
        )}

        {activeLanes.length > 0 && (
          <>
            {/* Ширина сегмента — доля робуксов, а не заказов: шесть DBS-заказов
                могут стоить дороже четырнадцати ВБ-шных, и полоса обязана это
                показывать, иначе она врёт ровно там, где на неё смотрят. */}
            <div className="twa-lane-bar" aria-hidden="true">
              {activeLanes.map(lane => (
                <i key={lane.id} style={{ flexGrow: Math.max(lane.gross, 1), background: LANE_META[lane.id].color }} />
              ))}
            </div>

            <div className="twa-lane-rows">
              {activeLanes.map(lane => (
                <button
                  key={lane.id}
                  type="button"
                  className="twa-lane-row twa-press-sm"
                  onClick={() => { haptic.select(); onOpenOrders?.(undefined, "BUYOUT"); }}
                >
                  <i style={{ background: LANE_META[lane.id].color }} />
                  <span className="twa-lane-name">{LANE_META[lane.id].label}</span>
                  <span className="twa-lane-count">{lane.orders}</span>
                  <span className="twa-lane-age" style={{ color: ageColor(lane.oldestAt) }}>{fmtAge(lane.oldestAt)}</span>
                  <b className="twa-lane-sum">{robux(lane.gross)}</b>
                </button>
              ))}
            </div>
          </>
        )}

        {buyout.orders === 0 && <div className="twa-till-empty">Очередь выкупа пуста</div>}
      </section>

      {/* ── ⚡ Первым делом ───────────────────────────────────────────────
          Поднятые кнопкой заказы и прямые. В очереди они и так наверху, но
          наверху же стоит просто самый старый — без отдельного блока «подняли»
          и «прямой» на главной не видно вовсе. Пусто — блока нет. */}
      {firstInLine.length > 0 && (
        <section className="twa-first">
          <div className="twa-first-head">
            <span>⚡ Первым делом</span>
            <em>{robux(firstInLineGross)} R$ грязными</em>
            {/* Выгрузка всей пачки: за ID больше незачем уходить в «Заказы». */}
            <button
              type="button"
              className="twa-first-copy-all twa-press-sm"
              onClick={() => copyFirstIds(firstInLine, "первым делом")}
              aria-label="Скопировать ID геймпассов всей пачки"
            >
              <Copy size={13} />ID · {firstInLineIds}
            </button>
          </div>
          {firstInLine.map(order => (
            <div key={order.id} className={`twa-first-row${busy.has(order.id) ? " is-busy" : ""}`}>
              <button
                type="button"
                className="twa-first-open twa-press-sm"
                onClick={() => { haptic.select(); onOpenOrders?.(order.wbCode); }}
              >
                <span className={`twa-first-why ${order.reason === "pinned" ? "is-pinned" : "is-direct"}`}>
                  {order.reason === "pinned" ? "⚡" : "Прямой"}
                </span>
                <span className="twa-first-main">
                  <strong>{order.wbCode}</strong>
                  <small>{order.robloxUsername ?? "ник не указан"}</small>
                </span>
                <b className="twa-first-sum">{robux(order.gross)}</b>
                <span className="twa-first-age" style={{ color: ageColor(order.since) }}>{fmtAge(order.since)}</span>
              </button>

              {/* Вторая строка — работа по заказу: зачем он тут (заметка) и два
                  действия смены. На телефоне она отдельной строкой, а не в
                  середине первой: там на 390 px не помещается даже ник. */}
              <div className="twa-first-tools">
                {noteEdit?.id === order.id ? (
                  <input
                    autoFocus
                    className="twa-first-note-input"
                    value={noteEdit.value}
                    maxLength={200}
                    placeholder="Почему этот заказ первым…"
                    enterKeyHint="done"
                    onChange={event => setNoteEdit({ id: order.id, value: event.target.value })}
                    onBlur={() => {
                      const edit = noteEditRef.current;
                      if (edit?.id === order.id) void saveNote(order, edit.value);
                    }}
                    onKeyDown={event => {
                      if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
                      // Esc отменяет правку целиком: строка возвращается к тому,
                      // что было, а не сохраняет наполовину набранное.
                      if (event.key === "Escape") { event.preventDefault(); setNoteEdit(null); }
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className={`twa-first-note twa-press-sm${order.note ? "" : " is-empty"}`}
                    onClick={() => { haptic.select(); setNoteEdit({ id: order.id, value: order.note ?? "" }); }}
                  >
                    {noteSaving === order.id ? "сохраняю…" : order.note ?? "+ заметка"}
                  </button>
                )}
                <button
                  type="button"
                  className="twa-first-copy twa-press-sm"
                  onClick={() => copyFirstIds([order], order.wbCode)}
                  disabled={order.gamepassIds.length === 0}
                  aria-label={`Скопировать ID геймпасса заказа ${order.wbCode}`}
                >
                  {/* Число рисуем только у разбитого: у обычного «· 1» — шум. */}
                  <Copy size={13} />ID{order.gamepassIds.length > 1 ? ` · ${order.gamepassIds.length}` : ""}
                </button>
                <button
                  type="button"
                  className="twa-first-tick twa-press-sm"
                  disabled={busy.has(order.id)}
                  aria-label={`Отметить выкупленным заказ ${order.wbCode}`}
                  onClick={() => void completeOne(order)}
                >
                  <Check size={16} />
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      {/* ── Требует решения ──────────────────────────────────────────────── */}
      {(dbsNeedsDecision || errors.count > 0 || inbox.total > 0) ? (
        <>
          <div className="twa-section-label">Требует решения</div>
          <div className="twa-inset-group twa-action-list">
            {/* Незакрытая доставка бьёт всё остальное: там висят деньги WB.
                Если доставка закрыта, но ход за нами (проверка, полученный код,
                готовый гейт) — говорим об этом, а не о доставке. */}
            {dbs && dbsNeedsDecision && (
              /* Ведём в ту очередь, о которой строка и говорит: «наш ход» — в
                 «Закрыть на WB», ожидание покупателя — в «Ждут код». Общий
                 список заставлял искать те же два заказа глазами. */
              <button
                type="button"
                className="twa-inset-row twa-press-sm"
                onClick={() => { haptic.select(); onOpenDelivery?.(dbs.needsUs > 0 ? "readyReceive" : "waitingCode"); }}
              >
                <span className="twa-result-icon is-delivery"><Truck size={21} /></span>
                <div>
                  {/* Заголовок называет того, за кем ход: «закрыть на WB» в
                      момент, когда заказ ждёт код от покупателя, звало нас на
                      работу, которой нет. */}
                  <strong>
                    {dbs.needsUs > 0
                      ? `WB Доставка · ${dbs.needsUs} ${plural(dbs.needsUs, "ждёт", "ждут", "ждут")} нашего хода`
                      : dbs.unclosed > 0
                        ? `WB Доставка · ${dbs.unclosed} ${plural(dbs.unclosed, "ждёт", "ждут", "ждут")} покупателя`
                        : "WB Доставка"}
                  </strong>
                  <small>
                    {dbs.stages
                      .filter(stage => stage.stage !== "in_bot" && stage.stage !== "link_sent")
                      .map(stage => `${stage.label} ${stage.count}`).join(" · ") || "в работе"}
                    {/* Срок WB — не возраст заказа: по нему заказ отменяют. */}
                    {dbs.overdue > 0 && <> · <b style={{ color: C.red }}>{dbs.overdue} просрочено по сроку WB</b></>}
                    {dbs.overdue === 0 && dbs.dueSoon > 0 && <> · <b style={{ color: C.orange }}>{dbs.dueSoon} истекает за 4 ч</b></>}
                    {dbsOldest && <> · старейший <b style={{ color: ageColor(dbsOldest) }}>{fmtAge(dbsOldest)}</b></>}
                  </small>
                </div>
                <ChevronRight size={20} />
              </button>
            )}

            {errors.count > 0 && (
              <button type="button" className="twa-inset-row twa-press-sm" onClick={() => openOrders("ERROR")}>
                <span className="twa-result-icon is-error"><TriangleAlert size={21} /></span>
                <div>
                  <strong>{errors.count} {plural(errors.count, "ошибка выкупа", "ошибки выкупа", "ошибок выкупа")}</strong>
                  <small>{errors.first ?? "разобрать вручную"}{errors.oldestAt && ` · ${fmtAge(errors.oldestAt)}`}</small>
                </div>
                <ChevronRight size={20} />
              </button>
            )}

            {inbox.total > 0 && (
              <button type="button" className="twa-inset-row twa-press-sm" onClick={() => { haptic.select(); onOpenInbox?.(); }}>
                <span className="twa-result-icon is-inbox"><MessageCircleQuestion size={21} /></span>
                <div>
                  <strong>{inbox.total} без ответа</strong>
                  <small>{inbox.feedbacks} {plural(inbox.feedbacks, "отзыв", "отзыва", "отзывов")} · {inbox.questions} {plural(inbox.questions, "вопрос", "вопроса", "вопросов")}</small>
                </div>
                <ChevronRight size={20} />
              </button>
            )}
          </div>

          {/* Этапы DBS отдельной лентой: каждый открывает ровно свою очередь. */}
          {dbs && dbs.stages.length > 0 && (
            <div className="twa-stage-strip twa-no-scrollbar">
              {dbs.stages.map(stage => (
                <button
                  key={stage.stage}
                  type="button"
                  className="twa-stage-chip twa-press-sm"
                  onClick={() => { haptic.select(); onOpenDelivery?.(STAGE_FOCUS[stage.stage] ?? null); }}
                >
                  {stage.label}
                  <b>{stage.count}</b>
                  {stage.oldestAt && <em style={{ color: ageColor(stage.oldestAt) }}>{fmtAge(stage.oldestAt)}</em>}
                </button>
              ))}
            </div>
          )}
        </>
      ) : null}

      {/* ── Тихие строки: видно, что есть, но это не невыполненная задача ─── */}
      <div className="twa-quiet-rows">
        {/* Код у покупателя, доставка закрыта, он идёт по нашей воронке.
            Это ход покупателя, а не наш — в «Требует решения» ему не место. */}
        {dbs && dbs.inBot > 0 && (
          <button type="button" className="twa-quiet-row twa-press-sm" onClick={() => { haptic.select(); onOpenDelivery?.("inBot"); }}>
            <Truck size={16} />
            <span>
              {dbs.inBot} в боте · код выдан, доставка закрыта
              {dbs.funnel.readyBuyout > 0 && ` · ${dbs.funnel.readyBuyout} уже в очереди выкупа`}
            </span>
            <ChevronRight size={17} />
          </button>
        )}

        {/* Гейт ушёл, код не открыт: сам такой заказ не сдвинется никогда —
            напоминания бота кончились. Внутри «в боте» это было незаметно. */}
        {dbs && dbs.funnel.notActivated > 0 && (
          <button type="button" className="twa-quiet-row is-loud twa-press-sm" onClick={() => { haptic.select(); onOpenDelivery?.("notActivated"); }}>
            <CircleAlert size={16} />
            <span>
              <b>{dbs.funnel.notActivated} {plural(dbs.funnel.notActivated, "код не открыт", "кода не открыты", "кодов не открыты")}</b> покупателями
              <small>
                {dbs.funnel.notActivatedNudged > 0 && `напоминания кончились у ${dbs.funnel.notActivatedNudged}`}
                {dbs.funnel.notActivatedOldestAt && ` · старейшему ${fmtAge(dbs.funnel.notActivatedOldestAt)}`}
              </small>
            </span>
            <ChevronRight size={17} />
          </button>
        )}

        {awaitingLink.stale > 0 && (
          <button type="button" className="twa-quiet-row is-loud twa-press-sm" onClick={() => openOrders("STALE_LINK")}>
            <Clock3 size={16} />
            <span>
              <b>{awaitingLink.stale} {plural(awaitingLink.stale, "висяк", "висяка", "висяков")}</b> без ссылки дольше двух недель
              <small>напоминания бота кончились · старейшему {fmtAge(awaitingLink.staleOldestAt)}</small>
            </span>
            <ChevronRight size={17} />
          </button>
        )}

        {/* Когда висяки вынесены наверх, здесь остаётся живая часть очереди:
            повторять «из них N висяков» второй строкой подряд незачем. */}
        {awaitingLink.total > 0 && (
          <button type="button" className="twa-quiet-row twa-press-sm" onClick={() => openOrders("AWAITING_LINK")}>
            <Clock3 size={16} />
            <span>
              {awaitingLink.stale > 0
                ? `Ещё ${awaitingLink.total - awaitingLink.stale} ждут ссылку · вся очередь ${awaitingLink.total}`
                : `${awaitingLink.total} ждут ссылку · старейшая ${fmtAge(awaitingLink.oldestAt)}`}
            </span>
            <ChevronRight size={17} />
          </button>
        )}

        {held.count > 0 && (
          <button type="button" className="twa-quiet-row is-ice twa-press-sm" onClick={() => openOrders("HELD")}>
            <Snowflake size={16} />
            {/* Кодов приходит не больше четырёх — строка на телефоне всё равно
                не покажет больше. Хвост называем числом, а не молча режем. */}
            <span>
              {held.count} {plural(held.count, "заказ заморожен", "заказа заморожены", "заказов заморожены")} · {held.codes.join(", ")}
              {held.count > held.codes.length && ` и ещё ${held.count - held.codes.length}`}
            </span>
            <ChevronRight size={17} />
          </button>
        )}
      </div>

      {/* ── Пока вас не было ──────────────────────────────────────────────
          Тот же блок, что на сайте, в формате телефона: две вкладки вместо
          трёх (нити на 390 px читаются хуже ленты) и никаких таблиц. Окно —
          от прошлого захода ЭТОГО админа, общее с сайтом: заход с ноутбука и
          с телефона — одна смена одного человека. */}
      {data.shift && <ShiftBlock shift={data.shift} dbs={dbs} stale={awaitingLink.stale} liveAge={liveAge} />}

      <button type="button" className="twa-primary-row twa-press" onClick={() => { haptic.select(); onCreateOrder?.("manual"); }}>
        <Plus size={19} /> Новый заказ
      </button>

      <div className="twa-home-footer">
        Неделя · {rub(data.week.sum)} · {data.week.orders} {plural(data.week.orders, "заказ", "заказа", "заказов")} · {totalCodes} WB-{plural(totalCodes, "код", "кода", "кодов")} на складе
      </div>
    </div>
  );
}

/** «13 ч 51 мин» — сколько админа не было. */
function awayLabel(sinceIso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(sinceIso).getTime()) / 60_000));
  if (mins < 60) return `${mins} мин`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return mins % 60 === 0 ? `${hours} ч` : `${hours} ч ${mins % 60} мин`;
  const days = Math.floor(hours / 24);
  return `${days} ${plural(days, "день", "дня", "дней")}`;
}

function hhmm(iso: string) {
  return new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

/** Кто сделал ход: значок и цвет те же, что в ленте на сайте. */
const ACTOR: Record<OverviewFeedRow["actor"], { mark: string; color: string }> = {
  us:    { mark: "М",  color: C.green },
  buyer: { mark: "П",  color: C.blue },
  bot:   { mark: "Б",  color: C.accent },
  wb:    { mark: "WB", color: C.yellow },
};

/* ── «Пока вас не было» на телефоне ───────────────────────────────────────
   Главная TWA отвечала только на «что выкупать сейчас». Второй вопрос смены —
   «что случилось, пока меня не было» — жил только на сайте, и админ с телефона
   его не видел вовсе. Здесь тот же диф и та же лента, но в формате телефона:
   итог тремя числами, очаги застрявшего строками и лента с временем. */
function ShiftBlock({
  shift, dbs, stale, liveAge,
}: {
  shift: NonNullable<DashData["shift"]>;
  dbs: DbsSnapshot | null;
  stale: number;
  liveAge: number;
}) {
  const [tab, setTab] = useState<"sum" | "feed">("sum");
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const { diff, feed } = shift;
  const queueDelta = diff.queueBefore - diff.queueNow;

  const stuck: { key: string; icon: string; text: string; hint: string }[] = [];
  if (dbs && dbs.unclosed > 0) {
    stuck.push({
      key: "dbs",
      icon: "⏰",
      text: `${dbs.unclosed} ${plural(dbs.unclosed, "заказ WB ждёт", "заказа WB ждут", "заказов WB ждут")} закрытия доставки`,
      hint: dbs.overdue > 0 ? `${dbs.overdue} просрочено по сроку WB` : "ход за покупателем — ждём код",
    });
  }
  if (dbs && dbs.funnel.notActivated > 0) {
    stuck.push({
      key: "gate",
      icon: "📮",
      text: `${dbs.funnel.notActivated} ${plural(dbs.funnel.notActivated, "код не открыт", "кода не открыты", "кодов не открыты")}`,
      hint: dbs.funnel.notActivatedOldestAt ? `старейшему ${fmtAge(dbs.funnel.notActivatedOldestAt)}` : "напоминания кончились",
    });
  }
  if (stale > 0) {
    stuck.push({
      key: "stale",
      icon: "🧷",
      text: `${stale} ${plural(stale, "висяк", "висяка", "висяков")} без ссылки`,
      hint: "дольше двух недель · бот отмолчал",
    });
  }

  return (
    <section className="twa-shift">
      <div className="twa-shift-head">
        <span>Пока вас не было</span>
        <em>{shift.firstVisit ? "первый заход · сутки" : awayLabel(diff.since)}</em>
        <b className="twa-shift-live">● {liveAge < 60 ? `${liveAge} с` : `${Math.floor(liveAge / 60)} мин`}</b>
      </div>

      <div className="twa-shift-tabs">
        <button type="button" className={tab === "sum" ? "is-on" : ""} onClick={() => { haptic.select(); setTab("sum"); }}>Сводка</button>
        <button type="button" className={tab === "feed" ? "is-on" : ""} onClick={() => { haptic.select(); setTab("feed"); }}>Лента</button>
      </div>

      {tab === "sum" ? (
        <>
          <div className="twa-shift-tiles">
            <div>
              <span>Очередь</span>
              <strong>
                {robux(diff.queueBefore)} → {robux(diff.queueNow)}
                {queueDelta !== 0 && (
                  <i style={{ color: queueDelta > 0 ? C.green : C.orange }}>
                    {queueDelta > 0 ? `−${queueDelta}` : `+${-queueDelta}`}
                  </i>
                )}
              </strong>
            </div>
            <div>
              <span>Ушло с доноров</span>
              <strong>{robux(diff.doneGross)}<small>R$</small></strong>
            </div>
            <div>
              <span>Пришло</span>
              <strong>{robux(diff.paymentsRubles)}<small>₽</small></strong>
            </div>
          </div>

          {diff.done > 0 && (
            <div className="twa-shift-row">
              <i style={{ color: C.green }}>✓</i>
              <span>
                <b>{diff.done} {plural(diff.done, "заказ выкуплен", "заказа выкуплено", "заказов выкуплено")}</b> · {robux(diff.doneClean)} R$ клиентам
                <small>{diff.doneCodes.slice(0, 4).join(" · ")}{diff.doneCodes.length > 4 ? ` и ещё ${diff.doneCodes.length - 4}` : ""}</small>
              </span>
              {diff.doneFirstAt && diff.doneLastAt && <time>{hhmm(diff.doneFirstAt)}→{hhmm(diff.doneLastAt)}</time>}
            </div>
          )}

          {diff.arrived > 0 && (
            <div className="twa-shift-row">
              <i style={{ color: C.blue }}>+</i>
              <span>
                <b>{diff.arrived} {plural(diff.arrived, "заказ", "заказа", "заказов")}</b> пришло
                <small>
                  {[diff.arrivedDbs > 0 ? `DBS ${diff.arrivedDbs}` : null, diff.arrivedDirect > 0 ? `прямых ${diff.arrivedDirect}` : null]
                    .filter(Boolean).join(" · ") || "в работе"}
                  {diff.queued > 0 && ` · в очередь встали ${diff.queued}`}
                </small>
              </span>
            </div>
          )}

          {diff.funnelEvents > 0 && (
            <div className="twa-shift-row">
              <i style={{ color: C.textTertiary }}>⚙</i>
              <span>
                <b>{[
                  diff.funnelNicks > 0 ? `${diff.funnelNicks} ${plural(diff.funnelNicks, "ник", "ника", "ников")}` : null,
                  diff.funnelPasses > 0 ? `${diff.funnelPasses} ${plural(diff.funnelPasses, "пасс", "пасса", "пассов")}` : null,
                ].filter(Boolean).join(" и ")}</b> прислали покупатели
                <small>воронка прошла сама</small>
              </span>
            </div>
          )}

          {stuck.length > 0 && (
            <>
              <div className="twa-shift-key">Не сдвинулось · {stuck.length}</div>
              {stuck.map(item => (
                <div className="twa-shift-row is-alert" key={item.key}>
                  <i>{item.icon}</i>
                  <span><b>{item.text}</b><small>{item.hint}</small></span>
                </div>
              ))}
            </>
          )}

          {diff.errors === 0 && diff.wbCancelled === 0 && (
            <div className="twa-shift-row">
              <i style={{ color: C.green }}>✓</i>
              <span>Ошибок выкупа нет · отмен WB нет</span>
            </div>
          )}
        </>
      ) : (
        <div className="twa-shift-feed">
          {feed.length === 0 && <div className="twa-shift-empty">За окно не случилось ничего</div>}
          {feed.map(row => {
            const actor = ACTOR[row.actor];
            if (row.group) {
              const open = openGroup === row.id;
              return (
                <div key={row.id}>
                  <button type="button" className="twa-shift-fold twa-press-sm" onClick={() => { haptic.select(); setOpenGroup(open ? null : row.id); }}>
                    <span>{open ? "▾" : "▸"}</span>
                    <b>{row.text}</b>
                    <time>{hhmm(row.group.items[row.group.items.length - 1].at)}→{hhmm(row.group.items[0].at)}</time>
                  </button>
                  {open && (
                    <div className="twa-shift-group">
                      {row.group.items.map(item => (
                        <span key={`${row.id}:${item.code}:${item.at}`}><b>{hhmm(item.at)}</b> {item.code}</span>
                      ))}
                    </div>
                  )}
                </div>
              );
            }
            return (
              <div className="twa-shift-event" key={row.id}>
                <time>{hhmm(row.at)}</time>
                <i style={{ background: `${actor.color}26`, color: actor.color }}>{actor.mark}</i>
                <span>
                  {row.code && <b>{row.code}</b>} {row.text}
                  {row.sub && <small>{row.sub}</small>}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function Skeleton() {
  return <div className="twa-liquid-dashboard">{[49, 210, 150, 96].map((height, index) => <div key={index} className="twa-liquid-skeleton" style={{ height, opacity: 0.82 - index * 0.1 }} />)}</div>;
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="twa-liquid-error">
      <CircleAlert size={30} />
      <strong>Не удалось загрузить главную</strong>
      <span>Проверьте соединение и попробуйте снова</span>
      <button type="button" className="twa-primary-row" onClick={onRetry}>Повторить</button>
    </div>
  );
}
