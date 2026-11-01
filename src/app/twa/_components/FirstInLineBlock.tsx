"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { C } from "./theme";
import { ageColor, fmtAge } from "./age";
import { haptic } from "./haptics";
import { toast } from "./Toast";
import { copyText } from "./clipboard";
import type { Tone } from "@/lib/order-presentation";
import type { FirstInLine, FirstInLineOrder } from "@/types/first-in-line";
import {
  FIRST_UNDO_MS,
  firstAgeBasis,
  firstCopyableIds,
  firstCopyToast,
  firstHiddenCount,
  firstMetaLine,
  firstNoteText,
  firstReadiness,
  groupFirstInLine,
  type FirstLive,
} from "@/lib/first-in-line-view";

/* ─────────────────────────────────────────────────────────────────────────────
   ⚡ «Первым делом» в TWA — один компонент на Главную и на «Выкупы».

   Блок жил копией внутри Dashboard, и на экране «Выкупы» его не было вовсе:
   заказ, поднятый на главной, в очереди выглядел как любой другой. Теперь оба
   экрана рисуют этот компонент, а правило (группы, возраст, готовность пасса,
   что копировать) — общее с сайтом: `@/lib/first-in-line-view`.

   «Выкуплено» срабатывает не сразу: FIRST_UNDO_MS строка висит с кнопкой
   «Отменить». Клиенту уходит сообщение, и отменить его уже нельзя, поэтому
   случайное касание обязано быть обратимым. Ушли с экрана во время отсчёта —
   выкуп всё равно засчитывается: админ нажал «Выкуплено», значит купил, и
   потерянная отметка означала бы второй выкуп того же заказа.
   ───────────────────────────────────────────────────────────────────────── */

const TONE: Record<Tone, string> = {
  green: C.green, yellow: C.yellow, orange: C.orange, red: C.red,
  blue: C.blue, ice: C.ice, accent: C.accent, muted: C.textTertiary, pink: C.pink,
};

const robux = (n: number) => n.toLocaleString("ru-RU");

export default function FirstInLineBlock({
  token, initial, refreshSignal, onOpenOrder, onOpenQueue, onChanged,
}: {
  token: string;
  /** Данные уже пришли с экраном (Главная). Без них блок грузит себя сам. */
  initial?: FirstInLine | null;
  /** Меняется — блок перечитывает себя (действие в ленте «Выкупов»). */
  refreshSignal?: unknown;
  onOpenOrder?: (wbCode: string) => void;
  /** «Вся очередь →». Нет обработчика — показываем просто число. */
  onOpenQueue?: () => void;
  /** Заказ закрыт из блока — экрану пора перечитать своё. */
  onChanged?: () => void;
}) {
  const [data, setData] = useState<FirstInLine | null>(initial ?? null);
  const [live, setLive] = useState<Record<string, FirstLive | null>>({});
  const [bought, setBought] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<Record<string, number>>({});
  const [now, setNow] = useState(() => Date.now());
  const [noteEdit, setNoteEdit] = useState<{ id: string; value: string } | null>(null);
  const [noteSaving, setNoteSaving] = useState<string | null>(null);
  const timers = useRef(new Map<string, { timer: number; order: FirstInLineOrder }>());
  /* Зеркало правки в ref: поле сохраняется по blur, а Esc снимает правку тем же
     движением — без зеркала Esc всё равно сохранял бы набранное. */
  const noteEditRef = useRef<{ id: string; value: string } | null>(null);
  const editNote = useCallback((next: { id: string; value: string } | null) => {
    noteEditRef.current = next;
    setNoteEdit(next);
  }, []);

  // Главная присылает свежие данные живым опросом — подхватываем их.
  const [seenInitial, setSeenInitial] = useState(initial);
  if (initial !== seenInitial) {
    setSeenInitial(initial);
    if (initial !== undefined) setData(initial ?? null);
  }

  useEffect(() => {
    if (initial !== undefined) return;
    let cancelled = false;
    fetch("/api/twa/first-in-line", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" })
      .then(res => (res.ok ? res.json() : null))
      .then(body => { if (!cancelled && body) setData(body); })
      .catch(() => { /* блок необязателен: экран работает и без него */ });
    return () => { cancelled = true; };
  }, [initial, token, refreshSignal]);

  /* Готовность пассов: та же проверка, что у карточек заказов. Проверяем то,
     чего ещё не проверяли; не ответил Roblox — `null`, строка просто без флага. */
  const rows = data?.rows ?? [];
  const rowKey = rows.map(row => row.id).join(",");
  useEffect(() => {
    const need = rows.filter(row => row.gamepassIds.length > 0 && !(row.id in live)).map(row => row.id);
    if (need.length === 0) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/twa/orders", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ action: "gp-live-check", orderIds: need }),
        });
        const body = res.ok ? await res.json().catch(() => null) : null;
        if (cancelled) return;
        setLive(prev => {
          const next = { ...prev };
          for (const id of need) next[id] = body?.results?.[id] ?? null;
          return next;
        });
      } catch {
        if (!cancelled) setLive(prev => Object.fromEntries([...Object.entries(prev), ...need.map(id => [id, null])]));
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowKey, token]);

  const post = useCallback(async (payload: Record<string, unknown>, keepalive = false) => {
    try {
      const res = await fetch("/api/twa/orders", {
        method: "POST",
        keepalive,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      return res.ok ? { ok: true as const } : { ok: false as const, error: body?.error ?? `сервер ответил ${res.status}` };
    } catch (error) {
      return { ok: false as const, error: (error as Error).message };
    }
  }, [token]);

  const commit = useCallback(async (order: FirstInLineOrder) => {
    timers.current.delete(order.id);
    setPending(prev => { const next = { ...prev }; delete next[order.id]; return next; });
    setBusy(prev => new Set(prev).add(order.id));
    const result = await post({ action: "complete", orderId: order.id });
    setBusy(prev => { const next = new Set(prev); next.delete(order.id); return next; });
    if (!result.ok) { haptic.notify("error"); toast(`${order.wbCode}: ${result.error}`, "error"); return; }
    setBought(prev => new Set(prev).add(order.id));
    haptic.notify("success");
    toast(`✓ ${order.wbCode} выкуплен · ${robux(order.amount)} R$ клиенту`, "success");
    onChanged?.();
  }, [post, onChanged]);

  const startComplete = useCallback((order: FirstInLineOrder) => {
    if (timers.current.has(order.id)) return;
    haptic.impact("medium");
    const timer = window.setTimeout(() => void commit(order), FIRST_UNDO_MS);
    timers.current.set(order.id, { timer, order });
    setPending(prev => ({ ...prev, [order.id]: Date.now() + FIRST_UNDO_MS }));
  }, [commit]);

  const undoComplete = useCallback((order: FirstInLineOrder) => {
    const entry = timers.current.get(order.id);
    if (entry) window.clearTimeout(entry.timer);
    timers.current.delete(order.id);
    setPending(prev => { const next = { ...prev }; delete next[order.id]; return next; });
    haptic.select();
    toast(`${order.wbCode}: выкуп отменён, клиенту ничего не ушло`);
  }, []);

  // Отсчёт на кнопке «Отменить».
  const anyPending = Object.keys(pending).length > 0;
  useEffect(() => {
    if (!anyPending) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [anyPending]);

  // Ушли с экрана во время отсчёта — засчитываем выкуп (см. шапку файла).
  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const { timer, order } of map.values()) {
        window.clearTimeout(timer);
        void post({ action: "complete", orderId: order.id }, true);
      }
      map.clear();
    };
  }, [post]);

  const copyIds = useCallback((orders: FirstInLineOrder[], label: string) => {
    const result = firstCopyableIds(orders, live);
    if (result.ids.length === 0) { haptic.notify("error"); toast(firstCopyToast(label, result), "error"); return; }
    copyText(result.ids.join("\n"));
    haptic.impact("light");
    toast(firstCopyToast(label, result), "success");
  }, [live]);

  /* Заметка правится прямо в строке. `keepTags` бережёт машинный аудит
     (`[РАЗБИВКА …]`, `[ПЕРЕВЫКУП …]`): в узкое поле он не показывается. */
  const saveNote = useCallback(async (order: FirstInLineOrder, value: string) => {
    const next = value.trim();
    editNote(null);
    if (next === (order.note ?? "")) return;
    setNoteSaving(order.id);
    const result = await post({ action: "set-note", orderId: order.id, note: next, keepTags: true });
    setNoteSaving(null);
    if (!result.ok) { haptic.notify("error"); toast(`${order.wbCode}: ${result.error}`, "error"); return; }
    setData(prev => (prev ? { ...prev, rows: prev.rows.map(row => (row.id === order.id ? { ...row, note: next || null } : row)) } : prev));
    haptic.notify("success");
    toast(next ? `✎ ${order.wbCode}: заметка сохранена` : `✎ ${order.wbCode}: заметка снята`, "success");
  }, [post, editNote]);

  if (!data) return null;
  const visible = rows.filter(row => !bought.has(row.id));
  if (visible.length === 0) return null;

  // Грязные — на ВСЕ такие заказы (строк может быть меньше), минус выкупленные.
  const gross = rows.reduce((sum, row) => (bought.has(row.id) ? sum - row.gross : sum), data.gross);
  const hidden = firstHiddenCount(data);
  const groups = groupFirstInLine(visible);
  const allIds = firstCopyableIds(visible, live).ids.length;
  const counts = [
    { tone: "pink" as Tone, label: "🔁 не дошло", n: data.rebuy ?? 0 },
    { tone: "yellow" as Tone, label: "⚡ подняты", n: data.pinned },
    { tone: "blue" as Tone, label: "💳 прямых", n: data.direct },
  ];

  return (
    <section className="twa-first">
      <div className="twa-first-head">
        <span>Первым делом</span>
        <em>{robux(gross)} R$ грязными</em>
        <button
          type="button"
          className="twa-first-copy-all twa-press-sm"
          onClick={() => copyIds(visible, "первым делом")}
          disabled={allIds === 0}
          aria-label="Скопировать ID геймпассов всей пачки"
        >
          <Copy size={13} />ID · {allIds}
        </button>
      </div>
      <div className="twa-first-counts">
        {counts.map(c => (
          <span key={c.label} className={`twa-first-cnt${c.n === 0 ? " is-off" : ""}`} style={c.n ? { color: TONE[c.tone], background: `${TONE[c.tone]}24` } : undefined}>
            {c.label} {c.n}
          </span>
        ))}
      </div>

      {groups.map(({ group, rows: groupRows }) => (
        <div key={group.id} className={`twa-first-group is-${group.id}`}>
          <div className="twa-first-gh" style={{ color: TONE[group.tone] }}>
            <span>{group.icon} {group.title}</span>
            <b>{groupRows.length}</b>
            <small>{group.hint}</small>
            {groups.length > 1 && (
              <button type="button" className="twa-first-gh-copy twa-press-sm" onClick={() => copyIds(groupRows, group.title.toLowerCase())}
                aria-label={`Скопировать ID группы «${group.title}»`}>
                <Copy size={12} />ID
              </button>
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
              <div key={order.id} className={`twa-first-row is-${order.reason}${busy.has(order.id) ? " is-busy" : ""}`}
                style={{ ["--stripe" as string]: TONE[group.tone] }}>
                <button type="button" className="twa-first-open twa-press-sm" onClick={() => { haptic.select(); onOpenOrder?.(order.wbCode); }}>
                  <span className="twa-first-main">
                    <strong>{order.wbCode}</strong>
                    <small>{order.robloxUsername ?? "ник не указан"}</small>
                  </span>
                  <b className="twa-first-sum">{robux(order.gross)}</b>
                  <span className="twa-first-age" style={{ color: ageColor(basis) }}>{fmtAge(basis)}</span>
                </button>
                {(ready || meta) && (
                  <div className="twa-first-meta">
                    {ready && <span style={{ color: TONE[ready.tone] }}>{ready.text}</span>}
                    {meta && <span>{meta}</span>}
                  </div>
                )}
                {deadline ? (
                  <div className="twa-first-tools">
                    <span className="twa-first-undo-text">✓ Выкупаю {order.wbCode} через {left} с…</span>
                    <button type="button" className="twa-first-undo twa-press-sm" onClick={() => undoComplete(order)}>Отменить</button>
                  </div>
                ) : (
                  <div className="twa-first-tools">
                    {noteEdit?.id === order.id ? (
                      <input
                        autoFocus
                        className="twa-first-note-input"
                        value={noteEdit.value}
                        maxLength={200}
                        placeholder="Почему этот заказ первым…"
                        enterKeyHint="done"
                        onChange={event => editNote({ id: order.id, value: event.target.value })}
                        onBlur={() => {
                          const edit = noteEditRef.current;
                          if (edit?.id === order.id) void saveNote(order, edit.value);
                        }}
                        onKeyDown={event => {
                          if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
                          if (event.key === "Escape") { event.preventDefault(); editNote(null); }
                        }}
                      />
                    ) : (
                      <button
                        type="button"
                        className={`twa-first-note twa-press-sm${note.empty ? " is-empty" : ""}${order.reason === "rebuy" && !order.note ? " is-rebuy" : ""}`}
                        onClick={() => { haptic.select(); editNote({ id: order.id, value: order.note ?? "" }); }}
                      >
                        {noteSaving === order.id ? "сохраняю…" : note.text}
                      </button>
                    )}
                    <button
                      type="button"
                      className="twa-first-copy twa-press-sm"
                      onClick={() => copyIds([order], order.wbCode)}
                      disabled={order.gamepassIds.length === 0}
                      aria-label={`Скопировать ID геймпасса заказа ${order.wbCode}`}
                    >
                      <Copy size={13} />ID{order.gamepassIds.length > 1 ? ` · ${order.gamepassIds.length}` : ""}
                    </button>
                    <button
                      type="button"
                      className="twa-first-tick twa-press-sm"
                      disabled={busy.has(order.id)}
                      aria-label={`Отметить выкупленным заказ ${order.wbCode}`}
                      onClick={() => startComplete(order)}
                    >
                      <Check size={16} />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}

      {(hidden > 0 || onOpenQueue) && (
        onOpenQueue ? (
          <button type="button" className="twa-first-more twa-press-sm" onClick={() => { haptic.select(); onOpenQueue(); }}>
            {hidden > 0 ? `Ещё ${hidden} первым делом · ` : ""}Вся очередь{data.queueTotal ? ` · ${robux(data.queueTotal)}` : ""} →
          </button>
        ) : (
          <div className="twa-first-more is-static">Ещё {hidden} первым делом — ниже в очереди</div>
        )
      )}
    </section>
  );
}
