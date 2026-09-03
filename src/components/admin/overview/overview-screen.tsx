"use client";

import { useCallback, useMemo, useState } from "react";
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
import type { AdminOverview, OverviewQueueOrder } from "@/types/admin-overview";
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

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch(`/api/admin/overview?since=${encodeURIComponent(since)}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Сервер ответил ${res.status}`);
      setData(await res.json() as AdminOverview);
      setBought(new Set());
    } catch (error) {
      showToast((error as Error).message, true);
    } finally {
      setRefreshing(false);
    }
  }, [since, showToast]);

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
  const oldest = queue.slice(0, OLDEST_SHOWN);
  const buyout = data.slices.slices.BUYOUT;
  const errors = data.slices.slices.ERROR;
  const link = data.slices.slices.AWAITING_LINK;
  const dbs = data.dbs;
  const heroTone = TONE_CLASS[ageTone(buyout.age.oldestAt)];
  // Ход за нами и незакрытая доставка — две разные работы, но обе наши.
  const dbsPending = dbs ? (dbs.needsUs > 0 ? dbs.needsUs : dbs.unclosed) : 0;
  const dbsOldest = dbs ? (dbs.needsUs > 0 ? dbs.needsUsOldestAt : dbs.unclosedOldestAt) : null;
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
            <span className={styles.note}><b>{num(data.firstInLine!.gross)}</b> R$ грязными</span>
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
              {/* Незакрытая доставка — тоже наш ход, просто другой: «наш ход 0»
                  рядом с «2 не закрыты на WB» читалось как «всё в порядке». */}
              <strong>WB Доставка · {dbs.needsUs > 0 ? "наш ход" : "закрыть на WB"}</strong>
              <b>{dbsPending}</b>
            </header>
            <div className={styles.laneMeta}>
              {dbs.needsUs > 0 && dbs.unclosed > 0 && (
                <span className={styles.toneRed}><b>{dbs.unclosed}</b> не закрыты на WB</span>
              )}
              {dbsOldest && (
                <span>старейший <b className={TONE_CLASS[ageTone(dbsOldest)]}>{fmtAge(dbsOldest)}</b></span>
              )}
            </div>
            <div className={styles.laneRows}>
              {dbs.stages
                .filter(stage => stage.stage !== "in_bot" && stage.stage !== "link_sent")
                .slice(0, 4)
                .map(stage => (
                  <div className={styles.laneRow} key={stage.stage}>
                    <span>{stage.label}</span>
                    <b>{stage.count}</b>
                  </div>
                ))}
            </div>
            <footer className={styles.laneFoot}>
              <Link className={cn(styles.btn, styles.btnSm)} href="/admin/wildberries/delivery">Открыть доставку</Link>
              <span className={styles.note}>в боте {dbs.inBot}</span>
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
      <DiffPanel diff={data.diff} firstVisit={firstVisit} />

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

function DiffPanel({ diff, firstVisit }: { diff: AdminOverview["diff"]; firstVisit: boolean }) {
  const rows: { key: string; value: string; tone?: Tone; title: string; hint?: string }[] = [];

  if (diff.arrived > 0) {
    const parts = [
      diff.arrivedDbs > 0 ? `DBS ${diff.arrivedDbs}` : null,
      diff.arrivedDirect > 0 ? `прямых ${diff.arrivedDirect}` : null,
    ].filter(Boolean);
    rows.push({
      key: "arrived",
      value: `+${diff.arrived}`,
      tone: "green",
      title: `${plural(diff.arrived, "заказ пришёл", "заказа пришло", "заказов пришло")}`,
      hint: parts.length > 0 ? `из них ${parts.join(" · ")}` : undefined,
    });
  }
  if (diff.done > 0) {
    rows.push({
      key: "done",
      value: String(diff.done),
      tone: "green",
      title: `выкуплено · ${num(diff.doneClean)} R$ клиентам`,
    });
  }
  if (diff.queued > 0) {
    rows.push({
      key: "queued",
      value: `+${diff.queued}`,
      tone: "blue",
      title: "встали в очередь выкупа",
      hint: diff.queuedCodes.join(" · "),
    });
  }
  if (diff.errors > 0) {
    rows.push({ key: "errors", value: String(diff.errors), tone: "red", title: "ушли в ошибку выкупа" });
  }
  if (diff.wbCancelled > 0) {
    rows.push({ key: "cancel", value: String(diff.wbCancelled), tone: "red", title: "отменил Wildberries" });
  }
  if (diff.rejected > 0) {
    rows.push({ key: "rejected", value: String(diff.rejected), tone: "orange", title: "отклонено" });
  }
  if (diff.paymentsConfirmed > 0) {
    rows.push({
      key: "pay",
      value: String(diff.paymentsConfirmed),
      tone: "green",
      title: `оплат подтверждено · ${num(diff.paymentsRubles)} ₽`,
    });
  }
  if (diff.funnelEvents > 0) {
    rows.push({
      key: "funnel",
      value: String(diff.funnelEvents),
      tone: "muted",
      title: "ников и геймпассов принято от покупателей",
      hint: "воронка бота идёт сама — вмешательство не нужно",
    });
  }

  return (
    <section className={styles.diff} aria-label="Что изменилось">
      <header className={styles.diffHead}>
        <strong>Пока вас не было</strong>
        <span>
          {firstVisit ? "первый заход · показываем сутки" : `с прошлого захода · ${awayLabel(diff.since)}`}
        </span>
      </header>
      {rows.length === 0 ? (
        <div className={styles.diffEmpty}>Ничего не изменилось</div>
      ) : (
        rows.map(row => (
          <div className={styles.diffRow} key={row.key}>
            <span className={cn(styles.d, TONE_CLASS[row.tone ?? "muted"])}>{row.value}</span>
            <span className={styles.t}>
              <strong>{row.title}</strong>
              {row.hint && <small>{row.hint}</small>}
            </span>
          </div>
        ))
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
