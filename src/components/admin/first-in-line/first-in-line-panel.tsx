"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { ageTone, fmtAge, type Tone } from "@/lib/order-presentation";
import type { FirstInLine, FirstInLineOrder } from "@/types/first-in-line";
import {
  FIRST_UNDO_MS,
  firstAgeBasis,
  firstCopyableIds,
  firstCopyToast,
  firstGroupTotal,
  firstMetaLine,
  firstNoteText,
  firstReadiness,
  firstRushHeat,
  firstRushLine,
  firstVisibleGroups,
  FIRST_GROUPS,
  type FirstFilter,
  type FirstGroupId,
  type FirstLive,
} from "@/lib/first-in-line-view";
import { cn } from "@/lib/utils";
import styles from "./first-in-line.module.css";

/* ─────────────────────────────────────────────────────────────────────────────
   ⚡ «Первым делом» на сайте — один компонент на «Обзор» и на «Выкупить».

   Зеркало `FirstInLineBlock` из TWA: правило общее (`@/lib/first-in-line-view`),
   различается только раскладка. Группы «Не дошло» → «Подняты вручную» →
   «Прямые», полоса причины слева, готовность пасса под строкой, «Выкуплено» с
   отменой в течение FIRST_UNDO_MS. Ушли со страницы во время отсчёта — выкуп
   засчитывается: потерянная отметка означала бы второй выкуп того же заказа.

   С 01.11.2026: группа «📣 Торопят», 🛑 полоса просьб об отмене и счётчики-
   фильтры в шапке («Все» — по три строки на группу).
   ───────────────────────────────────────────────────────────────────────── */

const TONE_CLASS: Record<Tone, string> = {
  green: styles.toneGreen, yellow: styles.toneYellow, orange: styles.toneOrange, red: styles.toneRed,
  blue: styles.toneBlue, ice: styles.toneIce, accent: styles.toneAccent, muted: styles.toneMuted, pink: styles.tonePink, purple: styles.tonePurple,
};
const STRIPE_CLASS: Record<FirstInLineOrder["reason"], string> = {
  rebuy: styles.rowRebuy, rush: styles.rowRush, pinned: styles.rowPinned, direct: styles.rowDirect,
};
const CNT_CLASS: Record<FirstGroupId, string> = {
  rebuy: styles.cntRebuy, rush: styles.cntRush, pinned: styles.cntPinned, direct: styles.cntDirect,
};
const GROUP_CLASS: Partial<Record<FirstGroupId, string>> = { rebuy: styles.groupRebuy, rush: styles.groupRush };

const num = (n: number) => n.toLocaleString("ru-RU");

async function post(payload: Record<string, unknown>, keepalive = false): Promise<{ ok: boolean; error?: string; data?: { results?: Record<string, FirstLive> } }> {
  try {
    const res = await fetch("/api/admin/orders", {
      method: "POST",
      keepalive,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data?.error ?? `Сервер ответил ${res.status}` };
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

export default function FirstInLinePanel({
  initial, refreshSignal, onOpenOrder, queueHref, onChanged, onToast,
}: {
  /** Данные пришли со страницей («Обзор»). Без них панель грузит себя сама. */
  initial?: FirstInLine | null;
  /** Меняется — панель перечитывает себя (действие в ленте «Выкупить»). */
  refreshSignal?: unknown;
  /** Клик по коду. Нет обработчика — ведём в «Заказы» с открытым досье. */
  onOpenOrder?: (order: FirstInLineOrder) => void;
  /** «Вся очередь →». Нет адреса — строка «ещё N ниже в очереди». */
  queueHref?: string;
  onChanged?: () => void;
  onToast: (text: string, error?: boolean) => void;
}) {
  const [data, setData] = useState<FirstInLine | null>(initial ?? null);
  const [seenInitial, setSeenInitial] = useState(initial);
  if (initial !== seenInitial) {
    setSeenInitial(initial);
    if (initial !== undefined) setData(initial ?? null);
  }
  const [live, setLive] = useState<Record<string, FirstLive | null>>({});
  const [bought, setBought] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<Record<string, number>>({});
  const [now, setNow] = useState(() => Date.now());
  const [noteEdit, setNoteEdit] = useState<{ id: string; value: string } | null>(null);
  const [noteSaving, setNoteSaving] = useState<string | null>(null);
  const [filter, setFilter] = useState<FirstFilter>("all");
  const timers = useRef(new Map<string, { timer: number; order: FirstInLineOrder }>());

  useEffect(() => {
    if (initial !== undefined) return;
    let cancelled = false;
    fetch("/api/admin/first-in-line", { cache: "no-store" })
      .then(res => (res.ok ? res.json() : null))
      .then(body => { if (!cancelled && body) setData(body); })
      .catch(() => { /* панель необязательна: страница работает и без неё */ });
    return () => { cancelled = true; };
  }, [initial, refreshSignal]);

  const rows = data?.rows ?? [];
  const rowKey = rows.map(row => row.id).join(",");
  useEffect(() => {
    const need = rows.filter(row => row.gamepassIds.length > 0 && !(row.id in live)).map(row => row.id);
    if (need.length === 0) return;
    let cancelled = false;
    post({ action: "gp-live-check", orderIds: need }).then(result => {
      if (cancelled) return;
      setLive(prev => {
        const next = { ...prev };
        for (const id of need) next[id] = result.data?.results?.[id] ?? null;
        return next;
      });
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowKey]);

  const commit = useCallback(async (order: FirstInLineOrder) => {
    timers.current.delete(order.id);
    setPending(prev => { const next = { ...prev }; delete next[order.id]; return next; });
    setBusy(prev => new Set(prev).add(order.id));
    const result = await post({ action: "complete", orderId: order.id });
    setBusy(prev => { const next = new Set(prev); next.delete(order.id); return next; });
    if (!result.ok) { onToast(`${order.wbCode}: ${result.error}`, true); return; }
    setBought(prev => new Set(prev).add(order.id));
    onToast(`✓ ${order.wbCode} выкуплен · ${num(order.amount)} R$ клиенту`);
    onChanged?.();
  }, [onToast, onChanged]);

  const startComplete = useCallback((order: FirstInLineOrder) => {
    if (timers.current.has(order.id)) return;
    const timer = window.setTimeout(() => void commit(order), FIRST_UNDO_MS);
    timers.current.set(order.id, { timer, order });
    setPending(prev => ({ ...prev, [order.id]: Date.now() + FIRST_UNDO_MS }));
  }, [commit]);

  const undoComplete = useCallback((order: FirstInLineOrder) => {
    const entry = timers.current.get(order.id);
    if (entry) window.clearTimeout(entry.timer);
    timers.current.delete(order.id);
    setPending(prev => { const next = { ...prev }; delete next[order.id]; return next; });
    onToast(`${order.wbCode}: выкуп отменён, клиенту ничего не ушло`);
  }, [onToast]);

  const anyPending = Object.keys(pending).length > 0;
  useEffect(() => {
    if (!anyPending) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [anyPending]);

  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const { timer, order } of map.values()) {
        window.clearTimeout(timer);
        void post({ action: "complete", orderId: order.id }, true);
      }
      map.clear();
    };
  }, []);

  const copyIds = useCallback((orders: FirstInLineOrder[], label: string) => {
    const result = firstCopyableIds(orders, live);
    if (result.ids.length === 0) { onToast(firstCopyToast(label, result), true); return; }
    navigator.clipboard?.writeText(result.ids.join("\n")).catch(() => {});
    onToast(firstCopyToast(label, result));
  }, [live, onToast]);

  const saveNote = useCallback(async (order: FirstInLineOrder, value: string) => {
    const next = value.trim();
    setNoteEdit(null);
    if (next === (order.note ?? "")) return;
    setNoteSaving(order.id);
    const result = await post({ action: "set-note", orderId: order.id, note: next, keepTags: true });
    setNoteSaving(null);
    if (!result.ok) { onToast(`${order.wbCode}: ${result.error}`, true); return; }
    setData(prev => (prev ? { ...prev, rows: prev.rows.map(row => (row.id === order.id ? { ...row, note: next || null } : row)) } : prev));
    onToast(next ? `✎ ${order.wbCode}: заметка сохранена` : `✎ ${order.wbCode}: заметка снята`);
  }, [onToast]);

  if (!data) return null;
  const visible = rows.filter(row => !bought.has(row.id));
  if (visible.length === 0) return null;

  const gross = rows.reduce((sum, row) => (bought.has(row.id) ? sum - row.gross : sum), data.gross);
  const groups = firstVisibleGroups(visible, filter, data);
  const pack = filter === "all" ? visible : groups.flatMap(entry => entry.rows);
  const allIds = firstCopyableIds(pack, live).ids.length;
  const stops = data.stops ?? [];
  const pick = (next: FirstFilter) => setFilter(prev => (prev === next ? "all" : next));

  return (
    <section className={styles.first} aria-label="Выкупать первым делом">
      <div className={styles.head}>
        <span className={styles.title}>Первым делом</span>
        <span className={styles.counts} role="tablist" aria-label="Фильтр «Первым делом»">
          <button type="button" role="tab" aria-selected={filter === "all"}
            className={cn(styles.cnt, styles.cntAll, filter === "all" && styles.cntOn)} onClick={() => pick("all")}>
            Все {data.total}
          </button>
          {FIRST_GROUPS.map(group => {
            const n = firstGroupTotal(data, group.id);
            return (
              <button key={group.id} type="button" role="tab" aria-selected={filter === group.id} disabled={n === 0}
                title={`${group.title}: ${group.hint}`}
                className={cn(styles.cnt, n > 0 ? CNT_CLASS[group.id] : styles.cntOff, filter === group.id && styles.cntOn)}
                onClick={() => pick(group.id)}>
                {group.icon} {group.title.toLowerCase()} {n}
              </button>
            );
          })}
        </span>
        <span className={styles.spacer} />
        <span className={styles.sum}><b>{num(gross)}</b> R$ грязными</span>
        <button type="button" className={styles.copyAll} disabled={allIds === 0}
          onClick={() => copyIds(pack, "первым делом")} title="Скопировать ID геймпассов всей пачки (кроме снятых с продажи)">
          ⧉ ID · {allIds}
        </button>
      </div>

      {stops.length > 0 && filter === "all" && (
        <div className={styles.stop} role="note">
          <div className={styles.stopHead}>🛑 Просят отмену — не выкупать <b>{data.stopTotal ?? stops.length}</b>
            <small>заморожены автоматически: отменить заказ или разморозить в досье</small>
          </div>
          {stops.map(stop => (
            <Link key={stop.id} className={styles.stopRow} href={`/admin/orders?slice=HELD&order=${stop.id}`}>
              <strong>{stop.wbCode}</strong>
              <span>{stop.quote ? `«${stop.quote}»` : "просит вернуть деньги"}</span>
              <em>❄ {num(stop.amount)} R$</em>
            </Link>
          ))}
        </div>
      )}

      {groups.map(({ group, rows: groupRows, hidden }) => (
        <div key={group.id} className={cn(styles.group, GROUP_CLASS[group.id])}>
          <div className={cn(styles.gh, TONE_CLASS[group.tone])}>
            <span>{group.icon} {group.title}</span>
            <b>{firstGroupTotal(data, group.id) || groupRows.length}</b>
            <small>{group.hint}</small>
            {groups.length > 1 && (
              <button type="button" className={styles.ghCopy} onClick={() => copyIds(groupRows, group.title.toLowerCase())}>⧉ ID</button>
            )}
          </div>
          {groupRows.map(order => {
            const ready = firstReadiness(order, order.gamepassIds.length > 0 ? (order.id in live ? live[order.id] : undefined) : undefined);
            const meta = firstMetaLine(order);
            const note = firstNoteText(order);
            const basis = firstAgeBasis(order);
            const deadline = pending[order.id];
            const left = deadline ? Math.max(1, Math.ceil((deadline - now) / 1000)) : 0;
            return (
              <div key={order.id} className={cn(styles.row, STRIPE_CLASS[order.reason], busy.has(order.id) && styles.rowBusy)}>
                <div className={styles.who}>
                  {onOpenOrder ? (
                    <button type="button" className={styles.code} onClick={() => onOpenOrder(order)}>{order.wbCode}</button>
                  ) : (
                    <Link className={styles.code} href={`/admin/orders?slice=BUYOUT&order=${order.id}`}>{order.wbCode}</Link>
                  )}
                  <span className={styles.nick} title={order.robloxUsername ?? undefined}>{order.robloxUsername ?? "ник не указан"}</span>
                </div>
                <div className={styles.facts}>
                  {order.rush && (
                    <span className={cn(styles.heat, styles.tonePurple)} title={firstRushLine(order.rush, now)}>
                      <i aria-hidden="true">{"●".repeat(firstRushHeat(order.rush.count))}{"○".repeat(3 - firstRushHeat(order.rush.count))}</i>
                      {firstRushLine(order.rush, now).replace(/^📣 /, "")}
                    </span>
                  )}
                  {ready && <span className={TONE_CLASS[ready.tone]}>{ready.text}</span>}
                  {meta && <span>{meta}</span>}
                </div>
                {deadline ? (
                  <div className={styles.undoBox}>
                    <span>✓ Выкупаю {order.wbCode} через {left} с…</span>
                    <button type="button" className={styles.undo} onClick={() => undoComplete(order)}>Отменить</button>
                  </div>
                ) : noteEdit?.id === order.id ? (
                  <input
                    autoFocus
                    className={styles.noteInput}
                    value={noteEdit.value}
                    maxLength={200}
                    placeholder="Почему этот заказ первым…"
                    onChange={event => setNoteEdit({ id: order.id, value: event.target.value })}
                    onBlur={() => void saveNote(order, noteEdit.value)}
                    onKeyDown={event => {
                      if (event.key === "Enter") { event.preventDefault(); void saveNote(order, noteEdit.value); }
                      if (event.key === "Escape") { event.preventDefault(); setNoteEdit(null); }
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className={cn(styles.note, note.empty && styles.noteEmpty, order.reason === "rebuy" && !order.note && styles.noteRebuy, note.quote && styles.noteQuote)}
                    onClick={() => setNoteEdit({ id: order.id, value: order.note ?? "" })}
                    title={note.empty ? "Добавить заметку" : note.quote ? `${note.text} — нажмите, чтобы добавить заметку` : note.text}
                  >
                    {noteSaving === order.id ? "сохраняю…" : note.text}
                  </button>
                )}
                <span className={styles.amount} title={`${num(order.gross)} грязными → ${num(order.amount)} R$ клиенту`}>{num(order.gross)} R$</span>
                <span className={cn(styles.age, TONE_CLASS[ageTone(basis)])}
                  title={order.reason === "rebuy" ? "Ждёт с создания заказа" : "В очереди"}>{fmtAge(basis)}</span>
                <button
                  type="button"
                  className={styles.copy}
                  onClick={() => copyIds([order], order.wbCode)}
                  disabled={order.gamepassIds.length === 0 || !!deadline}
                  aria-label={`Скопировать ID геймпасса заказа ${order.wbCode}`}
                >
                  ⧉ ID{order.gamepassIds.length > 1 ? ` · ${order.gamepassIds.length}` : ""}
                </button>
                <button
                  type="button"
                  className={styles.tick}
                  disabled={busy.has(order.id) || !!deadline}
                  title={`Выкуплено · ${order.wbCode} · ${FIRST_UNDO_MS / 1000} с на отмену, потом клиенту уйдёт сообщение`}
                  aria-label={`Отметить выкупленным заказ ${order.wbCode}`}
                  onClick={() => startComplete(order)}
                >
                  <Check size={15} aria-hidden="true" />
                </button>
              </div>
            );
          })}
          {hidden > 0 && (filter === "all" ? (
            <button type="button" className={cn(styles.groupMore, TONE_CLASS[group.tone])} onClick={() => pick(group.id)}>
              Ещё {hidden} · {group.title.toLowerCase()} →
            </button>
          ) : (
            <div className={cn(styles.groupMore, styles.moreStatic)}>Ещё {hidden} — в общей очереди</div>
          ))}
        </div>
      ))}

      {queueHref && (
        <Link className={styles.more} href={queueHref}>
          Вся очередь{data.queueTotal ? ` · ${num(data.queueTotal)}` : ""} →
        </Link>
      )}
    </section>
  );
}
