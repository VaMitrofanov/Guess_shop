"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Check,
  ChevronRight,
  ClipboardCopy,
  Clock3,
  Plus,
  RefreshCw,
  Snowflake,
  TriangleAlert,
  Truck,
} from "lucide-react";
import { fmtAge, ageTone, type Tone } from "@/lib/order-presentation";
import type { AdminOverview, OverviewFeedRow, OverviewQueueOrder } from "@/types/admin-overview";
import type { FirstInLineOrder } from "@/types/first-in-line";
import styles from "./overview.module.css";
import { cn } from "@/lib/utils";

/* ─────────────────────────────────────────────────────────────────────────────
   «Обзор» = начало смены (этап Г2).

   Порядок экрана — это порядок вопросов, а не важность сущностей:

   1. сколько робуксов надо потратить прямо сейчас (и что горит);
   2. чем набить выкупные аккаунты — с кнопкой выкупа прямо здесь;
   3. какие ещё есть дорожки работы;
   4. что случилось, пока меня не было;
   5. всё ли тихо в фоне;
   6. и только потом — витрина.

   Витринные метрики не удалены, они уехали вниз одной строкой: «Чистый оборот»
   первым числом отвечал не на тот вопрос (эквайринг сайта — это доли процента
   оборота, который идёт через WB).
   ───────────────────────────────────────────────────────────────────────── */

const TONE_CLASS: Record<Tone, string> = {
  green: styles.toneGreen,
  yellow: styles.toneYellow,
  orange: styles.toneOrange,
  red: styles.toneRed,
  blue: styles.toneBlue,
  ice: styles.toneIce,
  accent: styles.toneAccent,
  muted: styles.toneMuted,
};

const LANE_LABEL: Record<OverviewQueueOrder["lane"], string> = {
  WB: "Wildberries",
  WB_DBS: "WB DBS",
  DIRECT: "Прямые",
};

const num = (value: number) => value.toLocaleString("ru-RU");

/** Как часто обновляется живая лента, пока вкладка на экране (решение О4). */
const LIVE_POLL_MS = 30_000;

/** Сколько старейших заказов показывать в дорожке выкупа.
 *
 *  Три — не круглое число, а высота: дорожки стоят в один ряд, и пятью строками
 *  «Выкуп» вытягивал соседей на две сотни пикселей пустоты. Разбор очереди
 *  живёт в «Заказах», здесь — начало смены. */
const OLDEST_SHOWN = 3;

function plural(count: number, one: string, few: string, many: string) {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
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

/** «через 54 мин» / «2 д 19 ч назад» — срок WB словами. */
function dueLabel(iso: string): string {
  const diff = Date.parse(iso) - Date.now();
  const mins = Math.round(Math.abs(diff) / 60_000);
  const body = mins < 60
    ? `${mins} мин`
    : mins < 1440
      ? `${Math.floor(mins / 60)} ч${mins % 60 ? ` ${mins % 60} мин` : ""}`
      : `${Math.floor(mins / 1440)} ${plural(Math.floor(mins / 1440), "день", "дня", "дней")}`;
  return diff >= 0 ? `через ${body}` : `${body} назад`;
}

function moscowNow(iso: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

async function post(payload: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch("/api/admin/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data?.error ?? `Сервер ответил ${res.status}` };
    return { ok: true };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

function copyText(text: string) {
  navigator.clipboard?.writeText(text).catch(() => {});
}

export default function OverviewScreen({
  initial,
  since,
  adminName,
  firstVisit,
}: {
  initial: AdminOverview;
  since: string;
  adminName: string;
  firstVisit: boolean;
}) {
  const [data, setData] = useState<AdminOverview>(initial);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  /** Выкупленные в этой сессии — исчезают из нарезки сразу, не дожидаясь
   *  обновления: иначе строка остаётся кликабельной и её жмут второй раз. */
  const [bought, setBought] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const showToast = useCallback((text: string, error = false) => {
    setToast({ text, error });
    window.setTimeout(() => setToast(null), 4200);
  }, []);

  /** Когда данные последний раз пришли с сервера — из этого «живая · N с». */
  const [syncedAt, setSyncedAt] = useState(() => Date.now());
  const [liveAge, setLiveAge] = useState(0);

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const res = await fetch(`/api/admin/overview?since=${encodeURIComponent(since)}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Сервер ответил ${res.status}`);
      setData(await res.json() as AdminOverview);
      setSyncedAt(Date.now());
      setLiveAge(0);
      if (!silent) setBought(new Set());
    } catch (error) {
      // Тихий круг молчит: сеть моргнула — экран просто останется прежним, а
      // «живая · N с» сама покажет, что данные стареют.
      if (!silent) showToast((error as Error).message, true);
    } finally {
      if (!silent) setRefreshing(false);
    }
  }, [since, showToast]);

  /* Живой опрос — решение О4 от 03.09.2026: раз в 30 секунд и ТОЛЬКО пока
     вкладка на экране. Фоновая вкладка не должна дёргать сервер: админов трое,
     и три забытых вкладки — это три бессмысленных запроса в минуту круглые
     сутки. Окно дифа при этом не двигается: его держит отметка присутствия,
     которая ставится на загрузке страницы, а не на этом запросе. */
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    const tick = window.setInterval(() => {
      setLiveAge(Math.round((Date.now() - syncedAt) / 1000));
      if (document.visibilityState !== "visible") return;
      if (Date.now() - syncedAt < LIVE_POLL_MS) return;
      void refreshRef.current(true);
    }, 1000);
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - syncedAt >= LIVE_POLL_MS) void refreshRef.current(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [syncedAt]);

  const queue = useMemo(
    () => data.queue.filter(order => !bought.has(order.id)),
    [data.queue, bought],
  );

  // Структурный минимум вместо `OverviewQueueOrder`: то же действие вызывает и
  // блок «Первым делом», а у его строк своя форма.
  const complete = useCallback(async (order: { id: string; wbCode: string }) => {
    setBusy(prev => new Set(prev).add(order.id));
    const result = await post({ action: "complete", orderId: order.id });
    setBusy(prev => { const next = new Set(prev); next.delete(order.id); return next; });
    if (!result.ok) {
      showToast(`${order.wbCode}: ${result.error}`, true);
      return false;
    }
    setBought(prev => new Set(prev).add(order.id));
    return true;
  }, [showToast]);

  const completeOne = useCallback(async (order: { id: string; wbCode: string; amount: number }) => {
    if (await complete(order)) {
      showToast(`✓ ${order.wbCode} выкуплен · ${num(order.amount)} R$ клиенту`);
    }
  }, [complete, showToast]);

  /** ID геймпассов старейших — то, что кладут в скрипт выкупа. */
  const copyOldestIds = useCallback((orders: OverviewQueueOrder[]) => {
    const ids = orders.map(order => order.gamepassId).filter(Boolean);
    if (ids.length === 0) { showToast("У этих заказов нет ID геймпассов", true); return; }
    copyText(ids.join("\n"));
    showToast(`⧉ ID в буфере: ${ids.length}`);
  }, [showToast]);

  /* Заметка прямо в блоке: «почему этот заказ тут». Раньше ради строчки текста
     надо было уходить в досье, а середина строки при этом пустовала.
     `keepTags` на сервере бережёт машинный аудит заметки — узкое поле правит
     только человеческую часть. */
  const [noteEdit, setNoteEdit] = useState<{ id: string; value: string } | null>(null);
  const [noteSaving, setNoteSaving] = useState<string | null>(null);

  const saveNote = useCallback(async (order: FirstInLineOrder, value: string) => {
    const next = value.trim();
    setNoteEdit(null);
    if (next === (order.note ?? "")) return;
    setNoteSaving(order.id);
    const result = await post({ action: "set-note", orderId: order.id, note: next, keepTags: true });
    setNoteSaving(null);
    if (!result.ok) { showToast(`${order.wbCode}: ${result.error}`, true); return; }
    // Правим строку на месте: перезагрузка обзора сбросила бы фокус и прокрутку.
    setData(prev => (prev.firstInLine
      ? { ...prev, firstInLine: { ...prev.firstInLine, rows: prev.firstInLine.rows.map(row => (
          row.id === order.id ? { ...row, note: next || null } : row)) } }
      : prev));
    showToast(next ? `✎ ${order.wbCode}: заметка сохранена` : `✎ ${order.wbCode}: заметка снята`);
  }, [showToast]);

  /* Напоминание про код доставки прямо с обзора (решение О7 от 03.09.2026).
     Кнопка отправляет покупателю сообщение в чат WB, поэтому она спрашивает
     подтверждение и показывает, что именно уйдёт. Потолок — три обращения в
     сутки на заказ — стоит на сервере, а не здесь: с телефона и из консоли
     доставки жмут ту же кнопку. */
  const [remindAsk, setRemindAsk] = useState<string | null>(null);

  const remindCode = useCallback(async (row: { id: string; wbOrderId: string }) => {
    setRemindAsk(null);
    setBusy(prev => new Set(prev).add(row.id));
    try {
      const res = await fetch("/api/admin/wb-delivery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "remind_code", orderId: row.id }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) { showToast(`WB #${row.wbOrderId}: ${payload?.error ?? `сервер ответил ${res.status}`}`, true); return; }
      showToast(`🔔 WB #${row.wbOrderId}: ${payload?.message ?? "напомнили про код"}`);
      void refresh();
    } catch (error) {
      showToast((error as Error).message, true);
    } finally {
      setBusy(prev => { const next = new Set(prev); next.delete(row.id); return next; });
    }
  }, [refresh, showToast]);

  /* ID пассов из «Первым делом» — то, что вставляют в донора.
     У разбитого заказа их несколько (все невыкупленные части), поэтому это
     `flatMap`, а не `map`: одна строка списка может дать две покупки. */
  const copyFirstIds = useCallback((orders: FirstInLineOrder[], label: string) => {
    const ids = orders.flatMap(order => order.gamepassIds);
    if (ids.length === 0) { showToast(`${label}: пассов ещё нет`, true); return; }
    copyText(ids.join("\n"));
    // Заказов и ID может быть разное количество — говорим оба числа, иначе
    // «скопировано 3» на двух заказах выглядит ошибкой.
    const skipped = orders.filter(order => order.gamepassIds.length === 0).length;
    showToast(
      `⧉ ${label}: ${ids.length} ID` +
      (ids.length !== orders.length ? ` из ${orders.length} заказов` : "") +
      (skipped > 0 ? ` · без пасса: ${skipped}` : ""),
    );
  }, [showToast]);

  const firstInLine = (data.firstInLine?.rows ?? []).filter(order => !bought.has(order.id));
  // Грязные считаются на ВСЕ такие заказы, а показанных строк может быть
  // меньше — поэтому вычитаем только что выкупленные, а не суммируем видимые:
  // иначе шапка продолжала просить деньги за строку, которая уже ушла.
  const firstInLineGross = (data.firstInLine?.rows ?? [])
    .reduce((sum, order) => (bought.has(order.id) ? sum - order.gross : sum), data.firstInLine?.gross ?? 0);
  const oldest = queue.slice(0, OLDEST_SHOWN);
  const buyout = data.slices.slices.BUYOUT;
  const errors = data.slices.slices.ERROR;
  const link = data.slices.slices.AWAITING_LINK;
  const dbs = data.dbs;
  const heroTone = TONE_CLASS[ageTone(buyout.age.oldestAt)];
  // Ход за нами и незакрытая доставка — две разные работы, но обе наши.
  const dbsPending = dbs ? (dbs.needsUs > 0 ? dbs.needsUs : dbs.unclosed) : 0;
  const dbsOldest = dbs ? (dbs.needsUs > 0 ? dbs.needsUsOldestAt : dbs.unclosedOldestAt) : null;
  /* Кто должен следующий ход. «Закрыть на WB» пишем только когда закрывать
     действительно нам: у незакрытой доставки, которая ждёт код покупателя, ход
     не наш, и звать в неё работой — врать. */
  const dbsMoveLabel = !dbs || dbsPending === 0
    ? "всё закрыто"
    : dbs.needsUs > 0
      ? "наш ход"
      : dbs.sections.find(section => section.id === "buyer")?.count
        ? "ход за покупателем"
        : "закрыть на WB";
  /* Пульс синка: 6 минут — тот же порог, что у тихой строки экрана. */
  const syncStale = !dbs?.sync || dbs.sync.ageSeconds > 360 || dbs.sync.status !== "HEALTHY";
  const hot = buyout.age.overdue > 0;

  return (
    <div className={styles.screen}>
      <div className={styles.head}>
        <h1>Обзор</h1>
        <span aria-hidden="true">·</span>
        <b>{moscowNow(data.now)} МСК</b>
        <span>·</span>
        <span>смена: {adminName}</span>
        <span className={styles.spacer} />
        <button
          type="button"
          className={cn(styles.refresh, refreshing && styles.spinning)}
          onClick={() => void refresh()}
          disabled={refreshing}
        >
          <RefreshCw size={14} aria-hidden="true" /> Обновить
        </button>
      </div>

      {/* ── 1. Ответ: сколько робуксов тратим прямо сейчас ─────────────────── */}
      <section className={styles.hero} aria-label="Очередь выкупа">
        <div className={styles.heroFig}>
          <strong className={styles.num}>
            {num(buyout.gross)}<small>R$ грязными</small>
          </strong>
          <span>спишется с выкупных аккаунтов · <b>{num(buyout.clean)} R$</b> уйдёт клиентам</span>
        </div>

        <div className={styles.heroRule} aria-hidden="true" />

        <div className={styles.heroSide}>
          <div className={styles.heroCount}>
            {num(buyout.orders)}<small>{plural(buyout.orders, "заказ", "заказа", "заказов")} в очереди</small>
          </div>
          {buyout.orders > 0 && (
            <div className={cn(styles.ageChip, hot && styles.ageChipHot, heroTone)}>
              <Clock3 size={15} aria-hidden="true" />
              старейший {fmtAge(buyout.age.oldestAt)}
              {buyout.age.oldestCode && <small>· {buyout.age.oldestCode}</small>}
              {buyout.age.overdue > 0 && <small>· {buyout.age.overdue} просрочено</small>}
            </div>
          )}
        </div>

        <div className={styles.heroActs}>
          <Link className={cn(styles.btn, styles.btnPrimary)} href="/admin/orders?slice=BUYOUT">
            Разобрать очередь <ArrowUpRight size={15} aria-hidden="true" />
          </Link>
          <Link className={styles.btn} href="/admin/buyout"><Plus size={15} aria-hidden="true" /> Выкуп</Link>
        </div>
      </section>

      {/* ── 1.5. ⚡ Первым делом ────────────────────────────────────────────
          Два случая, которые выкупаются не по возрасту: поднятые руками и
          прямые (за них клиент заплатил лично и ждёт лично). В общей очереди
          они стоят наверху, но там же стоит и просто самый старый — без
          отдельной полосы «подняли» и «прямой» неотличимы от «давно висит».
          Пусто — блока нет вовсе: чинить в нём нечего. */}
      {firstInLine.length > 0 && (
        <section className={styles.first} aria-label="Выкупать первым делом">
          <div className={styles.firstHead}>
            ⚡ Первым делом
            <span className={styles.note}>
              {data.firstInLine!.pinned > 0 && <>подняты вручную: <b>{data.firstInLine!.pinned}</b></>}
              {data.firstInLine!.pinned > 0 && data.firstInLine!.direct > 0 && " · "}
              {data.firstInLine!.direct > 0 && <>прямых: <b>{data.firstInLine!.direct}</b></>}
            </span>
            <span className={styles.spacer} />
            <span className={styles.note}><b>{num(firstInLineGross)}</b> R$ грязными</span>
            {/* Выгрузка всей пачки: типовой шаг — скопировал ID, вставил в
                донора, вернулся отмечать. Ради него незачем уходить в «Заказы». */}
            <button
              type="button"
              className={styles.firstCopyAll}
              onClick={() => copyFirstIds(firstInLine, "первым делом")}
              title="Скопировать ID геймпассов всей пачки"
            >
              ⧉ ID · {firstInLine.reduce((sum, order) => sum + order.gamepassIds.length, 0)}
            </button>
          </div>
          <div className={styles.firstRows}>
            {firstInLine.map(order => (
              <div
                className={cn(styles.firstRow, busy.has(order.id) && styles.firstRowBusy)}
                key={order.id}
              >
                <span className={cn(
                  styles.firstWhy,
                  order.reason === "pinned" ? styles.firstWhyPinned : styles.firstWhyDirect,
                )}>
                  {order.reason === "pinned" ? "⚡ поднят" : "Прямой"}
                </span>
                <Link className={styles.code} href={`/admin/orders?slice=BUYOUT&order=${order.id}`}>
                  {order.wbCode}
                </Link>
                <span className={styles.nick} title={order.robloxUsername ?? undefined}>
                  {order.robloxUsername ?? "Ник не указан"}
                </span>
                {/* Заметка занимает середину строки — раньше там была пустота.
                    Поле однострочное: сюда пишут «доплата», «спор на WB»,
                    «обещал к вечеру», а не историю заказа. */}
                {noteEdit?.id === order.id ? (
                  <input
                    autoFocus
                    className={styles.firstNoteInput}
                    value={noteEdit.value}
                    maxLength={200}
                    placeholder="Почему этот заказ первым…"
                    onChange={event => setNoteEdit({ id: order.id, value: event.target.value })}
                    onBlur={() => void saveNote(order, noteEdit.value)}
                    onKeyDown={event => {
                      if (event.key === "Enter") { event.preventDefault(); void saveNote(order, noteEdit.value); }
                      // Esc отменяет правку целиком: строка возвращается к тому,
                      // что было, а не сохраняет наполовину набранное.
                      if (event.key === "Escape") { event.preventDefault(); setNoteEdit(null); }
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className={cn(styles.firstNote, !order.note && styles.firstNoteEmpty)}
                    onClick={() => setNoteEdit({ id: order.id, value: order.note ?? "" })}
                    title={order.note ?? "Добавить заметку"}
                  >
                    {noteSaving === order.id ? "сохраняю…" : order.note ?? "+ заметка"}
                  </button>
                )}
                <span className={styles.amount} title={`${num(order.gross)} грязными → ${num(order.amount)} R$ клиенту`}>
                  {num(order.gross)} R$
                </span>
                <span className={cn(styles.age, TONE_CLASS[ageTone(order.since)])}>{fmtAge(order.since)}</span>
                <button
                  type="button"
                  className={styles.firstCopy}
                  onClick={() => copyFirstIds([order], order.wbCode)}
                  disabled={order.gamepassIds.length === 0}
                  title={order.gamepassIds.length > 1
                    ? `Скопировать ${order.gamepassIds.length} ID частей · ${order.wbCode}`
                    : `Скопировать ID геймпасса · ${order.wbCode}`}
                  aria-label={`Скопировать ID геймпасса заказа ${order.wbCode}`}
                >
                  {/* Число рисуем только у разбитого: у обычного «⧉ 1» — шум. */}
                  ⧉ ID{order.gamepassIds.length > 1 ? ` · ${order.gamepassIds.length}` : ""}
                </button>
                {/* «Выкуплено» отделено щелью и рамкой намеренно: оно
                    необратимо и шлёт клиенту сообщение, а соседняя кнопка —
                    безобидное копирование, которое жмут в десять раз чаще. */}
                <button
                  type="button"
                  className={cn(styles.tick, styles.firstTick)}
                  title={`Выкуплено · ${order.wbCode} · клиенту уйдёт сообщение`}
                  aria-label={`Отметить выкупленным заказ ${order.wbCode}`}
                  onClick={() => void completeOne(order)}
                >
                  <Check size={15} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── 2. Дорожки работы ──────────────────────────────────────────────── */}
      <div className={styles.sectionHead}><h2>Дорожки</h2></div>
      <div className={styles.lanes}>
        <article className={cn(styles.lane, hot && styles.laneHot)}>
          <header className={cn(styles.laneHead, styles.toneBlue)}>
            <i aria-hidden="true" />
            <strong>Выкуп</strong>
            <b>{buyout.orders}</b>
          </header>
          <div className={styles.laneMeta}>
            <span><b>{num(buyout.gross)}</b> R$ грязными</span>
            {buyout.age.overdue > 0 && (
              <span className={styles.toneRed}><b>{buyout.age.overdue}</b> старше порога</span>
            )}
          </div>
          <div className={styles.laneRows}>
            {buyout.lanes.filter(lane => lane.orders > 0).map(lane => (
              <div className={styles.laneRow} key={lane.id}>
                <span>{LANE_LABEL[lane.id]}</span>
                <b>{lane.orders} · {num(lane.gross)} R$</b>
              </div>
            ))}
          </div>

          {/* Старейшие — прямо здесь, вместе с «Выкуплено»: типовая смена
              начинается с них, и ради трёх нажатий незачем уходить в ленту.
              Одиночный выкуп подтверждения не просит — цена ошибки один заказ;
              пачками с обзора не выкупают, для этого есть «Заказы». */}
          {oldest.length > 0 && (
            <div className={styles.oldest}>
              {oldest.map(order => (
                <div
                  className={cn(styles.oldestRow, busy.has(order.id) && styles.oldestRowBusy)}
                  key={order.id}
                >
                  <Link className={styles.code} href={`/admin/orders?slice=BUYOUT&order=${order.id}`}>
                    {/* ⚡ Поднятый руками стоит первым и здесь — без метки его
                        не отличить от просто самого старого. */}
                    {order.priority && <i className={styles.prio} title="Выкупать первым">⚡</i>}
                    {order.wbCode}
                  </Link>
                  <span className={styles.nick} title={order.robloxUsername ?? undefined}>
                    {order.robloxUsername ?? "Ник не указан"}
                  </span>
                  <span className={styles.amount} title={`${num(order.gross)} грязными → ${num(order.amount)} R$ клиенту`}>
                    {num(order.amount)}
                  </span>
                  <span className={cn(styles.age, TONE_CLASS[ageTone(order.since)])}>{fmtAge(order.since)}</span>
                  <button
                    type="button"
                    className={styles.tick}
                    title={`Выкуплено · ${order.wbCode}`}
                    aria-label={`Отметить выкупленным заказ ${order.wbCode}`}
                    onClick={() => void completeOne(order)}
                  >
                    <Check size={14} aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <footer className={styles.laneFoot}>
            <Link className={cn(styles.btn, styles.btnSm)} href="/admin/orders?slice=BUYOUT">Открыть очередь</Link>
            {oldest.length > 0 && (
              <button type="button" className={cn(styles.btn, styles.btnSm)} onClick={() => copyOldestIds(oldest)}>
                <ClipboardCopy size={13} aria-hidden="true" /> ID
              </button>
            )}
            {/* Считаем от ВСЕЙ очереди, а не от загруженной головы: голова —
                десять строк, и «ещё 7» при девятнадцати заказах было бы ложью. */}
            {data.queueTotal - bought.size > oldest.length && (
              <span className={styles.note}>ещё {data.queueTotal - bought.size - oldest.length}</span>
            )}
          </footer>
        </article>

        {dbs && (
          <article className={cn(styles.lane, dbsPending > 0 && styles.laneHot)}>
            <header className={cn(styles.laneHead, dbsPending > 0 ? styles.toneOrange : styles.toneMuted)}>
              <i aria-hidden="true" />
              {/* Заголовок называет того, за кем ход, а не работу вообще: до
                  03.09 он писал «закрыть на WB · 2» ровно тогда, когда закрыть
                  их было нельзя — оба заказа ждали код от покупателя. */}
              <strong>WB Доставка · {dbsMoveLabel}</strong>
              <b>{dbsPending}</b>
            </header>

            <div className={styles.laneMeta}>
              {dbs.needsUs > 0 && dbs.unclosed > 0 && (
                <span className={styles.toneRed}><b>{dbs.unclosed}</b> не закрыты на WB</span>
              )}
              {/* Срок WB — не наш возраст заказа: по нему WB отменяет заказ и
                  снижает рейтинг, и решение принимается именно по нему. */}
              {dbs.overdue > 0 && (
                <span className={styles.toneRed}><b>{dbs.overdue}</b> просрочено по сроку WB</span>
              )}
              {dbs.overdue === 0 && dbs.dueSoon > 0 && (
                <span className={styles.toneOrange}><b>{dbs.dueSoon}</b> истекает в ближайшие 4 ч</span>
              )}
              {dbs.overdue === 0 && dbs.dueSoon === 0 && dbs.nextDueAt && (
                <span>ближайший срок <b>{dueLabel(dbs.nextDueAt)}</b></span>
              )}
              {dbsOldest && (
                <span>старейший <b className={TONE_CLASS[ageTone(dbsOldest)]}>{fmtAge(dbsOldest)}</b></span>
              )}
            </div>

            {/* Поимённо: до трёх заказов, где ход не за ботом. Числа «Ждём код 2»
                не говорили ни кто это, ни сколько раз мы уже спрашивали. */}
            {dbs.named.length > 0 && (
              <div className={styles.dbsNamed}>
                {dbs.named.map(row => {
                  const overdue = row.deliveryTo ? Date.parse(row.deliveryTo) < Date.now() : false;
                  return (
                    <div className={cn(styles.dbsRow, overdue && styles.dbsRowHot)} key={row.id}>
                      <div className={styles.dbsRowTop}>
                        <Link className={styles.code} href={`/admin/wildberries/delivery?order=${row.id}`}>
                          {row.wbOrderId}
                        </Link>
                        <span className={styles.note}>{row.buyerName ?? "имя не пришло"}</span>
                        <span className={styles.spacer} />
                        <span className={cn(styles.note, styles.dbsStage)}>{row.stageLabel}</span>
                      </div>
                      <div className={styles.dbsRowWhy}>
                        {row.deliveryTo && (
                          <b className={overdue ? styles.toneRed : styles.toneOrange}>
                            {overdue ? `срок WB истёк ${dueLabel(row.deliveryTo)}` : `срок WB ${dueLabel(row.deliveryTo)}`}
                          </b>
                        )}
                        <small>
                          {row.asked > 0
                            ? `код просили ${row.asked} ${plural(row.asked, "раз", "раза", "раз")}${row.lastAskAt ? `, последний ${fmtAge(row.lastAskAt)} назад` : ""} · автонапоминаний нет`
                            : "код ещё не просили"}
                        </small>
                      </div>
                      {row.canRemind && (
                        remindAsk === row.id ? (
                          <div className={styles.dbsAsk}>
                            <span>Отправить в чат WB просьбу прислать код доставки?</span>
                            <button
                              type="button"
                              className={cn(styles.btn, styles.btnSm, styles.btnPrimary)}
                              disabled={busy.has(row.id)}
                              onClick={() => void remindCode(row)}
                            >
                              Отправить
                            </button>
                            <button type="button" className={cn(styles.btn, styles.btnSm)} onClick={() => setRemindAsk(null)}>
                              Отмена
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className={cn(styles.btn, styles.btnSm, styles.dbsRemind)}
                            onClick={() => setRemindAsk(row.id)}
                          >
                            🔔 Напомнить
                          </button>
                        )
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* «в боте N» — три разные вещи в одном числе: читают инструкцию,
                стоят в очереди выкупа и НЕ открыли код вовсе. Третье — не
                процесс, а потери, и в тихой строке ему было не место. */}
            {dbs.inBot > 0 && (
              <>
                <div className={styles.dbsSplit} aria-hidden="true">
                  {dbs.funnel.instruction > 0 && <i style={{ flexGrow: dbs.funnel.instruction, background: "var(--o-blue)" }} />}
                  {dbs.funnel.nickGiven > 0 && <i style={{ flexGrow: dbs.funnel.nickGiven, background: "var(--o-ice)" }} />}
                  {dbs.funnel.readyBuyout > 0 && <i style={{ flexGrow: dbs.funnel.readyBuyout, background: "var(--o-green)" }} />}
                  {dbs.funnel.notActivated > 0 && <i style={{ flexGrow: dbs.funnel.notActivated, background: "var(--o-red)" }} />}
                </div>
                <div className={styles.dbsLegend}>
                  {dbs.funnel.instruction > 0 && <span><i style={{ background: "var(--o-blue)" }} />читают инструкцию <b>{dbs.funnel.instruction}</b></span>}
                  {dbs.funnel.nickGiven > 0 && <span><i style={{ background: "var(--o-ice)" }} />ждём геймпасс <b>{dbs.funnel.nickGiven}</b></span>}
                  {dbs.funnel.readyBuyout > 0 && <span><i style={{ background: "var(--o-green)" }} />в очереди выкупа <b>{dbs.funnel.readyBuyout}</b></span>}
                  {dbs.funnel.notActivated > 0 && <span><i style={{ background: "var(--o-red)" }} />код не открыт <b>{dbs.funnel.notActivated}</b></span>}
                </div>
              </>
            )}

            {dbs.funnel.notActivated > 0 && (
              <Link className={cn(styles.laneRow, styles.dbsLost)} href="/admin/wildberries/delivery?focus=notActivated">
                <span>
                  {dbs.funnel.notActivated} {plural(dbs.funnel.notActivated, "код не открыт", "кода не открыты", "кодов не открыты")}
                  {dbs.funnel.notActivatedOldestAt && ` · старейшему ${fmtAge(dbs.funnel.notActivatedOldestAt)}`}
                </span>
                <b>{dbs.funnel.notActivatedNudged > 0 ? `напоминания кончились у ${dbs.funnel.notActivatedNudged}` : "разобрать"}</b>
              </Link>
            )}

            <footer className={styles.laneFoot}>
              <Link className={cn(styles.btn, styles.btnSm)} href="/admin/wildberries/delivery">Открыть доставку</Link>
              {dbs.closedToday.count > 0 && (
                <span className={styles.note}>
                  за сутки закрыто {dbs.closedToday.count}
                  {dbs.closedToday.avgMinutes != null && ` · обычно ${dbs.closedToday.avgMinutes} мин`}
                </span>
              )}
              {/* Пульс синка: все числа дорожки — снимок воркера, и молчащий
                  воркер рисует спокойную дорожку вместо вчерашнего дня. */}
              <span className={cn(styles.dbsSync, syncStale && styles.dbsSyncStale)} title="Пульс воркера wb-dbs-sync">
                <i />
                {dbs.sync
                  ? syncStale ? `синк молчит ${Math.floor(dbs.sync.ageSeconds / 60)} мин` : `синк ${dbs.sync.ageSeconds} с`
                  : "синк не отвечал"}
              </span>
            </footer>
          </article>
        )}

        <article className={styles.lane}>
          <header className={cn(styles.laneHead, styles.toneAccent)}>
            <i aria-hidden="true" />
            <strong>Дожать</strong>
            <b>{link.stale}</b>
          </header>
          <div className={styles.laneMeta}>
            <span>{plural(link.stale, "висяк", "висяка", "висяков")} без ссылки дольше двух недель</span>
            {link.silent > 0 && <span>бот отмолчал <b>{link.silent}</b></span>}
          </div>
          <div className={styles.laneRows}>
            <div className={styles.laneRow}>
              <span>Старейший</span>
              <b className={TONE_CLASS[ageTone(link.age.oldestAt)]}>{fmtAge(link.age.oldestAt)}</b>
            </div>
            <div className={styles.laneRow}>
              <span>Живая часть очереди</span>
              <b>{Math.max(0, link.orders - link.stale)}</b>
            </div>
          </div>
          <footer className={styles.laneFoot}>
            <Link className={cn(styles.btn, styles.btnSm)} href="/admin/orders?slice=STALE_LINK">Открыть висяки</Link>
          </footer>
        </article>

        {errors.orders > 0 && (
          <article className={cn(styles.lane, styles.laneHot)}>
            <header className={cn(styles.laneHead, styles.toneRed)}>
              <i aria-hidden="true" />
              <strong>Починить</strong>
              <b>{errors.orders}</b>
            </header>
            <div className={styles.laneMeta}>
              <span>старейшая <b className={TONE_CLASS[ageTone(errors.age.oldestAt)]}>{fmtAge(errors.age.oldestAt)}</b></span>
            </div>
            <div className={styles.laneRows}>
              {errors.reasons.map(reason => (
                <div className={styles.laneRow} key={reason.id}>
                  <span>{reason.label}</span>
                  <b>{reason.count}</b>
                </div>
              ))}
            </div>
            <footer className={styles.laneFoot}>
              <Link className={cn(styles.btn, styles.btnSm)} href="/admin/orders?slice=ERROR">Открыть ошибки</Link>
            </footer>
          </article>
        )}
      </div>

      {/* Пустые дорожки не показывают ноль крупно — они сжимаются в строку. */}
      {(errors.orders === 0 || data.held.count > 0) && (
        <div className={styles.calmRow}>
          {errors.orders === 0 && <><Check size={15} className={styles.toneGreen} aria-hidden="true" /> Ошибок выкупа нет</>}
          {errors.orders === 0 && data.held.count > 0 && <span>·</span>}
          {data.held.count > 0 ? (
            <Link className={styles.showLink} href="/admin/orders?slice=HELD">
              <Snowflake size={14} aria-hidden="true" /> заморожено {data.held.count} · {data.held.codes.join(", ")}
            </Link>
          ) : (
            <span>· заморозки нет</span>
          )}
        </div>
      )}

      {/* ── 3. Пока вас не было ────────────────────────────────────────────── */}
      <DiffPanel data={data} firstVisit={firstVisit} liveAgeSeconds={liveAge} onRefresh={() => void refresh()} />

      {/* ── 4. Тихая строка ────────────────────────────────────────────────── */}
      <HealthStrip health={data.health} />

      {/* ── 5. Витрина ─────────────────────────────────────────────────────── */}
      <Showcase showcase={data.showcase} />

      {toast && (
        <div className={cn(styles.toast, toast.error && styles.toastError)} role="status">
          {toast.text}
        </div>
      )}
    </div>
  );
}

/* ── Пока вас не было ─────────────────────────────────────────────────────── */

type DiffTab = "sum" | "feed" | "threads";

/** Кто сделал ход — значок и цвет одинаковы во всех вкладках блока. */
const ACTOR_META: Record<OverviewFeedRow["actor"], { mark: string; cls: string; title: string }> = {
  us:    { mark: "М", cls: styles.actorUs,    title: "мы" },
  buyer: { mark: "П", cls: styles.actorBuyer, title: "покупатель" },
  bot:   { mark: "Б", cls: styles.actorBot,   title: "бот" },
  wb:    { mark: "WB", cls: styles.actorWb,   title: "Wildberries" },
};

function hhmm(iso: string) {
  return new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

/** «42 мин» / «1 ч 11 мин» — длительность нити. */
function spanLabel(fromIso: string, toIso: string) {
  const mins = Math.max(0, Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 60_000));
  if (mins < 60) return `${mins} мин`;
  const hours = Math.floor(mins / 60);
  return mins % 60 === 0 ? `${hours} ч` : `${hours} ч ${mins % 60} мин`;
}

/* ── Пока вас не было ─────────────────────────────────────────────────────
   Блок отвечал на «что случилось» пятью строками 13-м кеглем. Смена начинается
   с двух других вопросов, и оба он молчал: **полегчало ли** (очередь была 19,
   стала 11) и **что застряло** — застрявшее событий не порождает и потому в
   дифе невидимо. Плюс ни одного времени: десять выкупов пачкой за 42 минуты и
   десять за ночь выглядели одинаково.

   Отсюда три вкладки: сводка (итог смены), лента (когда именно) и нити (что
   происходило с конкретным заказом). Лента живая — опрос идёт, пока вкладка
   браузера открыта; окно дифа при этом не двигается, его держит отметка
   присутствия на сервере. */
function DiffPanel({
  data, firstVisit, liveAgeSeconds, onRefresh,
}: {
  data: AdminOverview;
  firstVisit: boolean;
  liveAgeSeconds: number;
  onRefresh: () => void;
}) {
  const [tab, setTab] = useState<DiffTab>("sum");
  const [openGroup, setOpenGroup] = useState<string | null>(null);

  const diff = data.diff;
  const feed = data.feed ?? [];
  const dbs = data.dbs;
  const link = data.slices.slices.AWAITING_LINK;

  /* Нити: те же события, сгруппированные по заказу. Одна нить — это история
     «что с ним происходило», и она отвечает на вопрос, которого нет ни у
     сводки, ни у ленты: сколько заказ шёл от шага к шагу. */
  const threads = useMemo(() => {
    const byCode = new Map<string, OverviewFeedRow[]>();
    for (const row of feed) {
      if (row.group) {
        for (const item of row.group.items) {
          const list = byCode.get(item.code) ?? [];
          list.push({ ...row, id: `${row.id}:${item.code}`, at: item.at, text: "выкуплен", code: item.code, group: null });
          byCode.set(item.code, list);
        }
        continue;
      }
      if (!row.code) continue;
      const list = byCode.get(row.code) ?? [];
      list.push(row);
      byCode.set(row.code, list);
    }
    return [...byCode.entries()]
      .map(([code, rows]) => {
        const sorted = [...rows].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
        return { code, rows: sorted, orderId: sorted.find(row => row.orderId)?.orderId ?? null };
      })
      .filter(thread => thread.rows.length > 1)
      .sort((a, b) => Date.parse(b.rows[b.rows.length - 1].at) - Date.parse(a.rows[a.rows.length - 1].at))
      .slice(0, 8);
  }, [feed]);

  const queueDelta = diff.queueBefore - diff.queueNow;
  const stuck = [
    dbs && dbs.unclosed > 0
      ? {
        key: "dbs",
        icon: "⏰",
        title: `${dbs.unclosed} ${plural(dbs.unclosed, "заказ WB ждёт", "заказа WB ждут", "заказов WB ждут")} закрытия доставки`,
        hint: dbs.overdue > 0
          ? `${dbs.overdue} ${plural(dbs.overdue, "просрочен", "просрочены", "просрочены")} по сроку WB · автонапоминаний на код нет`
          : "ход за покупателем — ждём код получения",
        href: "/admin/wildberries/delivery",
        label: "Доставка →",
      }
      : null,
    dbs && dbs.funnel.notActivated > 0
      ? {
        key: "gate",
        icon: "📮",
        title: `${dbs.funnel.notActivated} ${plural(dbs.funnel.notActivated, "код не открыт", "кода не открыты", "кодов не открыты")} покупателями`,
        hint: [
          dbs.funnel.notActivatedNudged > 0 ? `напоминания кончились у ${dbs.funnel.notActivatedNudged}` : null,
          dbs.funnel.notActivatedOldestAt ? `старейшему ${fmtAge(dbs.funnel.notActivatedOldestAt)}` : null,
        ].filter(Boolean).join(" · "),
        href: "/admin/wildberries/delivery?focus=notActivated",
        label: "Разобрать",
      }
      : null,
    link.stale > 0
      ? {
        key: "stale",
        icon: "🧷",
        title: `${link.stale} ${plural(link.stale, "висяк", "висяка", "висяков")} без ссылки дольше двух недель`,
        hint: `из ${link.orders} ждущих ссылку · бот молчит после трёх напоминаний`,
        href: "/admin/orders?slice=STALE_LINK",
        label: "Висяки →",
      }
      : null,
  ].filter(Boolean) as { key: string; icon: string; title: string; hint: string; href: string; label: string }[];

  const calm = [
    diff.errors === 0 ? "ошибок выкупа нет" : null,
    diff.wbCancelled === 0 ? "отмен WB нет" : null,
    diff.rejected === 0 ? "отказов нет" : null,
  ].filter(Boolean).join(" · ");

  return (
    <section className={styles.diff} aria-label="Что изменилось">
      <header className={styles.diffHead}>
        <strong>Пока вас не было</strong>
        <span className={styles.diffWindow}>
          {firstVisit
            ? "первый заход · показываем сутки"
            : `${awayLabel(diff.since)} · с ${hhmm(diff.since)} до ${hhmm(data.now)} МСК`}
        </span>
        <span className={styles.spacer} />
        {/* Лента живая ровно пока вкладка на экране: фоновая вкладка не должна
            дёргать сервер, а вернувшийся админ обязан увидеть свежее. */}
        <button type="button" className={styles.diffLive} onClick={onRefresh} title="Обновить сейчас">
          <i /> живая · {liveAgeSeconds < 60 ? `${liveAgeSeconds} с` : `${Math.floor(liveAgeSeconds / 60)} мин`}
        </button>
        <div className={styles.diffTabs} role="tablist" aria-label="Вид блока">
          <button type="button" role="tab" aria-selected={tab === "sum"} onClick={() => setTab("sum")}>Сводка</button>
          <button type="button" role="tab" aria-selected={tab === "feed"} onClick={() => setTab("feed")}>Лента</button>
          <button type="button" role="tab" aria-selected={tab === "threads"} onClick={() => setTab("threads")}>По заказам</button>
        </div>
      </header>

      {tab === "sum" && (
        <>
          <div className={styles.diffTiles}>
            <div className={styles.diffTile}>
              <span>Очередь выкупа</span>
              <strong>
                {num(diff.queueBefore)} <em>→</em> {num(diff.queueNow)}
                {queueDelta !== 0 && (
                  <b className={queueDelta > 0 ? styles.toneGreen : styles.toneOrange}>
                    {queueDelta > 0 ? `−${queueDelta}` : `+${-queueDelta}`}
                  </b>
                )}
              </strong>
              <small>
                осталось <b>{num(data.slices.slices.BUYOUT.gross)} R$</b> грязными
                {data.slices.slices.BUYOUT.age.oldestAt && <> · старейшему <b>{fmtAge(data.slices.slices.BUYOUT.age.oldestAt)}</b></>}
              </small>
            </div>
            <div className={styles.diffTile}>
              <span>Ушло с доноров</span>
              <strong>{num(diff.doneGross)} <em>R$</em></strong>
              <small>
                {diff.done > 0
                  ? <>клиентам зачислено <b>{num(diff.doneClean)} R$</b> · {diff.done} {plural(diff.done, "заказ", "заказа", "заказов")}</>
                  : "за окно не выкупали"}
              </small>
            </div>
            <div className={styles.diffTile}>
              <span>Пришло денег</span>
              <strong>{num(diff.paymentsRubles)} <em>₽</em></strong>
              <small>
                {diff.paymentsConfirmed > 0
                  ? <>{diff.paymentsConfirmed} {plural(diff.paymentsConfirmed, "оплата", "оплаты", "оплат")} подтверждено</>
                  : "оплат не было"}
              </small>
            </div>
          </div>

          <div className={styles.diffGroups}>
            {diff.done > 0 && (
              <>
                <div className={styles.diffGroupKey}>Сделано</div>
                <div className={styles.diffLine}>
                  <i className={styles.toneGreen}>✓</i>
                  <span>
                    <b>{diff.done} {plural(diff.done, "заказ выкуплен", "заказа выкуплено", "заказов выкуплено")}</b> · {num(diff.doneClean)} R$ клиентам
                    <small>{diff.doneCodes.slice(0, 6).join(" · ")}{diff.doneCodes.length > 6 ? ` и ещё ${diff.doneCodes.length - 6}` : ""}</small>
                  </span>
                  {diff.doneFirstAt && diff.doneLastAt && (
                    <time>{hhmm(diff.doneFirstAt)} → {hhmm(diff.doneLastAt)}</time>
                  )}
                  <button
                    type="button"
                    className={cn(styles.btn, styles.btnSm)}
                    onClick={() => copyText(diff.doneCodes.join("\n"))}
                  >
                    ⧉ коды
                  </button>
                </div>
              </>
            )}

            {diff.arrived > 0 && (
              <>
                <div className={styles.diffGroupKey}>Пришло</div>
                <div className={styles.diffLine}>
                  <i className={styles.toneBlue}>+</i>
                  <span>
                    <b>{diff.arrived} {plural(diff.arrived, "заказ", "заказа", "заказов")}</b>
                    {diff.arrivedDbs > 0 && ` · DBS ${diff.arrivedDbs}`}
                    {diff.arrivedDirect > 0 && ` · прямых ${diff.arrivedDirect}`}
                    {diff.queued > 0 && <small>в очередь встали {diff.queued}: {diff.queuedCodes.join(" · ")}</small>}
                  </span>
                </div>
              </>
            )}

            {(diff.funnelEvents > 0 || diff.paymentsConfirmed > 0) && (
              <>
                <div className={styles.diffGroupKey}>Само, без нас</div>
                <div className={styles.diffLine}>
                  <i className={styles.toneMuted}>⚙</i>
                  <span>
                    {[
                      diff.funnelNicks > 0 ? `${diff.funnelNicks} ${plural(diff.funnelNicks, "ник", "ника", "ников")}` : null,
                      diff.funnelPasses > 0 ? `${diff.funnelPasses} ${plural(diff.funnelPasses, "геймпасс", "геймпасса", "геймпассов")}` : null,
                    ].filter(Boolean).join(" и ") || "воронка"}
                    {" "}прислали покупатели
                    <small>вмешательства не потребовалось</small>
                  </span>
                </div>
              </>
            )}

            {stuck.length > 0 && (
              <>
                <div className={cn(styles.diffGroupKey, styles.toneRed)}>
                  Не сдвинулось · {stuck.length} {plural(stuck.length, "очаг", "очага", "очагов")}
                </div>
                {stuck.map(item => (
                  <div className={cn(styles.diffLine, styles.diffLineAlert)} key={item.key}>
                    <i>{item.icon}</i>
                    <span><b>{item.title}</b>{item.hint && <small>{item.hint}</small>}</span>
                    <Link className={cn(styles.btn, styles.btnSm)} href={item.href}>{item.label}</Link>
                  </div>
                ))}
              </>
            )}

            {calm && (
              <>
                <div className={styles.diffGroupKey}>Тихо</div>
                <div className={styles.diffLine}>
                  <i className={styles.toneGreen}>✓</i>
                  <span>
                    {calm}
                    {data.held.count === 0 ? " · заморозок нет" : ` · заморожено ${data.held.count}`}
                  </span>
                </div>
              </>
            )}
          </div>
        </>
      )}

      {tab === "feed" && (
        <div className={styles.feed}>
          {feed.length === 0 && <div className={styles.diffEmpty}>За окно не случилось ничего</div>}
          {feed.map(row => {
            const actor = ACTOR_META[row.actor];
            if (row.group) {
              const open = openGroup === row.id;
              return (
                <div key={row.id}>
                  <button
                    type="button"
                    className={styles.feedFold}
                    aria-expanded={open}
                    onClick={() => setOpenGroup(open ? null : row.id)}
                  >
                    <span className={cn(styles.feedChev, open && styles.feedChevOpen)}>▸</span>
                    <span><b>{row.text}</b></span>
                    <time>
                      {hhmm(row.group.items[row.group.items.length - 1].at)} → {hhmm(row.group.items[0].at)}
                    </time>
                  </button>
                  {open && (
                    <div className={styles.feedGroupBody}>
                      {row.group.items.map(item => (
                        <span key={`${row.id}:${item.code}:${item.at}`}><b>{hhmm(item.at)}</b> {item.code}</span>
                      ))}
                    </div>
                  )}
                </div>
              );
            }
            return (
              <div className={styles.feedRow} key={row.id}>
                <time>{hhmm(row.at)}</time>
                <span className={cn(styles.actor, actor.cls)} title={actor.title}>{actor.mark}</span>
                <span>
                  {row.code && (
                    row.orderId
                      ? <Link className={styles.code} href={`/admin/orders?order=${row.orderId}`}>{row.code}</Link>
                      : <span className={styles.code}>{row.code}</span>
                  )}
                  {" "}{row.text}
                  {row.sub && <small>{row.sub}</small>}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {tab === "threads" && (
        <div className={styles.threads}>
          {threads.length === 0 && <div className={styles.diffEmpty}>Пока ни у одного заказа не набралось истории за окно</div>}
          {threads.map(thread => (
            <div className={styles.thread} key={thread.code}>
              <div className={styles.threadHead}>
                {thread.orderId
                  ? <Link className={styles.code} href={`/admin/orders?order=${thread.orderId}`}>{thread.code}</Link>
                  : <span className={styles.code}>{thread.code}</span>}
                <span className={styles.note}>{thread.rows.length} {plural(thread.rows.length, "шаг", "шага", "шагов")}</span>
                <span className={styles.spacer} />
                <span className={styles.note}>
                  {spanLabel(thread.rows[0].at, thread.rows[thread.rows.length - 1].at)}
                </span>
              </div>
              <div className={styles.threadSteps}>
                {thread.rows.map(row => (
                  <span className={styles.threadStep} key={row.id}>
                    {row.text}<em>{hhmm(row.at)}</em>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ── Тихая строка ─────────────────────────────────────────────────────────── */

function HealthStrip({ health }: { health: AdminOverview["health"] }) {
  const stale = health.heartbeats.filter(beat => beat.ageSeconds > 360 || beat.status !== "HEALTHY");
  const summary = health.calm
    ? `Тихо · ${health.heartbeats.length} ${plural(health.heartbeats.length, "сервис", "сервиса", "сервисов")} на связи · ${num(health.codesTotal)} кодов на складе`
    : [
        stale.length > 0 ? `Heartbeat: ${stale.length} ${plural(stale.length, "сервис молчит", "сервиса молчат", "сервисов молчат")}` : null,
        health.outboxDead > 0 ? `dead-letter ${health.outboxDead}` : null,
        health.codesLow.length > 0 ? `кончается номинал ${health.codesLow.map(row => row.denom).join(", ")}` : null,
        health.acquiring === "off" ? "эквайринг выключен" : null,
      ].filter(Boolean).join(" · ");

  return (
    <details className={cn(styles.strip, !health.calm && styles.stripWarn)} open={!health.calm}>
      <summary>
        {health.calm
          ? <Check size={15} className={styles.toneGreen} aria-hidden="true" />
          : <TriangleAlert size={15} className={styles.toneOrange} aria-hidden="true" />}
        <span>{summary}</span>
        <span className={styles.spacer} />
        <ChevronRight size={16} className={styles.chev} aria-hidden="true" />
      </summary>
      <div className={styles.stripBody}>
        {health.heartbeats.map(beat => (
          <span key={beat.service}>
            <b>{beat.service}</b>{" "}
            {beat.ageSeconds < 90 ? "только что" : `${Math.floor(beat.ageSeconds / 60)} мин назад`}
          </span>
        ))}
        <span>Outbox: <b>{health.outboxPending}</b> в очереди · <b>{health.outboxDead}</b> dead-letter</span>
        <span>Коды: <b>{num(health.codesTotal)}</b> — {health.codes.map(row => `${row.denom}×${row.count}`).join(" · ")}</span>
        <span>Эквайринг: <b>{health.acquiring}</b></span>
      </div>
    </details>
  );
}

/* ── Витрина ──────────────────────────────────────────────────────────────── */

const SOURCE_LABEL: Record<string, string> = {
  WB: "Wildberries", WB_DBS: "WB DBS", DIRECT: "Прямые", SITE: "Сайт", AVITO: "Авито", MANUAL: "Ручные",
};

function Showcase({ showcase }: { showcase: AdminOverview["showcase"] }) {
  const daily = showcase.daily;
  const max = Math.max(1, ...daily.map(day => day.robux));
  const width = 600;
  const height = 64;
  const step = daily.length > 1 ? width / (daily.length - 1) : 0;
  const points = daily.map((day, index) => ({
    x: 10 + index * step,
    y: height - 8 - (day.robux / max) * (height - 20),
  }));
  const line = points.map(point => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" L ");
  const last = points[points.length - 1];
  const peak = daily.reduce((best, day) => (day.robux > best.robux ? day : best), daily[0] ?? { robux: 0, date: "" });

  return (
    <section className={styles.showcase} aria-label="Витрина">
      {daily.length > 1 && (
        <>
          <svg
            width="230"
            height="42"
            viewBox={`0 0 ${width + 20} ${height + 6}`}
            role="img"
            aria-label={`Робуксы по дням за две недели, пик ${num(peak.robux)} R$`}
          >
            <path
              d={`M ${line} L ${last.x.toFixed(1)},${height - 4} L 10,${height - 4} Z`}
              fill="rgba(167,139,250,.16)"
            />
            <path d={`M ${line}`} fill="none" stroke="#a78bfa" strokeWidth="2.6" strokeLinejoin="round" />
            <line x1="10" y1={height - 4} x2={(10 + (daily.length - 1) * step).toFixed(1)} y2={height - 4} stroke="rgba(255,255,255,.12)" strokeWidth="1" />
            <circle cx={last.x.toFixed(1)} cy={last.y.toFixed(1)} r="5" fill="#a78bfa" />
          </svg>
          <span className={styles.sparkNote}>R$ в день · две недели<br />пик <b>{num(peak.robux)}</b></span>
        </>
      )}
      <span>30 дней · <b>{num(showcase.orders30d)}</b> заказов · <b>{num(showcase.robux30d)}</b> R$</span>
      <span>
        {showcase.sources.slice(0, 4).map(source => `${SOURCE_LABEL[source.source] ?? source.source} ${source.orders}`).join(" · ")}
      </span>
      <span>Эквайринг <b>{num(Math.round(showcase.netKopecks30d / 100))} ₽</b> нетто</span>
      <span>Профили <b>{num(showcase.users)}</b> <b className={styles.toneGreen}>+{showcase.users30d}</b></span>
      <span className={styles.spacer} />
      <Link className={styles.showLink} href="/admin/economics">Экономика <ChevronRight size={13} aria-hidden="true" /></Link>
    </section>
  );
}
