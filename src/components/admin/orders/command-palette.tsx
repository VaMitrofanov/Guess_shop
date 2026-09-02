"use client";

/* ─────────────────────────────────────────────────────────────────────────────
   ⌘K — единственный поиск админки и она же командная строка.

   Раньше на каждой странице стояла своя форма поиска с перезагрузкой. Здесь
   один вход: код ВБ, ник Roblox, @username, ID геймпасса и номер заказа WB
   ищутся тем же запросом, что и лента, а рядом лежат действия над заказом,
   на котором стоит курсор. Ровно те действия, что доступны в интерфейсе —
   второго набора прав палитра не заводит.
   ───────────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fmtAge, grossOf } from "@/lib/order-presentation";
import { AdminOrder, SLICE_META, gamepassIdsOf, num } from "./types";
import styles from "./orders.module.css";

type Command = "export" | "complete" | "hold" | "copy-id" | "help";

interface Row {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

export default function CommandPalette({
  slice, cursorOrder, onClose, onOpenOrder, onSlice, onCommand,
}: {
  slice: string;
  cursorOrder: AdminOrder | null;
  onClose: () => void;
  onOpenOrder: (id: string) => void;
  onSlice: (slice: string) => void;
  onCommand: (command: Command) => void | Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [found, setFound] = useState<AdminOrder[]>([]);
  const [searching, setSearching] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    const term = value.trim();
    if (term.length < 2) { setFound([]); return; }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const params = new URLSearchParams({ status: "ALL", q: term, limit: "8", page: "1", skipCounts: "1", lite: "1" });
          const res = await fetch(`/api/admin/orders?${params}`, { cache: "no-store" });
          if (!res.ok) return;
          const data = await res.json();
          if (!cancelled) setFound(data.orders ?? []);
        } finally {
          if (!cancelled) setSearching(false);
        }
      })();
    }, 220);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [value]);

  const rows = useMemo<Row[]>(() => {
    const list: Row[] = [];

    for (const order of found) {
      list.push({
        id: `order-${order.id}`,
        label: `${order.wbCode} · ${order.robloxUsername ?? order.probableNick ?? "без ника"}`,
        hint: `${num(grossOf(order.amount))} R$ · ${order.status} · ${fmtAge(order.createdAt)}`,
        run: () => onOpenOrder(order.id),
      });
    }

    if (cursorOrder) {
      const ids = gamepassIdsOf(cursorOrder);
      list.push({ id: "cmd-complete", label: `✓ Отметить выкупленным ${cursorOrder.wbCode}`, hint: "⌘↵", run: () => void onCommand("complete") });
      if (ids.length > 0) list.push({ id: "cmd-copy", label: `⧉ Скопировать ID геймпасса ${cursorOrder.wbCode}`, hint: "C", run: () => void onCommand("copy-id") });
      list.push({ id: "cmd-hold", label: cursorOrder.heldAt ? `❄ Разморозить ${cursorOrder.wbCode}` : `❄ Заморозить ${cursorOrder.wbCode}`, hint: "F", run: () => void onCommand("hold") });
    }

    list.push({ id: "cmd-export", label: "↓ Выгрузить ID геймпассов среза", hint: slice, run: () => void onCommand("export") });
    for (const item of SLICE_META) {
      list.push({ id: `slice-${item.key}`, label: `↪ Срез «${item.label}»`, hint: item.hint, run: () => onSlice(item.key) });
    }
    list.push({ id: "cmd-help", label: "Шпаргалка по клавиатуре", hint: "?", run: () => void onCommand("help") });

    const term = value.trim().toLowerCase();
    return term.length < 2
      ? list
      : list.filter(row => row.id.startsWith("order-") || row.label.toLowerCase().includes(term));
  }, [found, cursorOrder, slice, value, onOpenOrder, onSlice, onCommand]);

  useEffect(() => { setActive(0); }, [rows.length]);

  const onKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
    if (event.key === "ArrowDown") { event.preventDefault(); setActive(index => Math.min(rows.length - 1, index + 1)); return; }
    if (event.key === "ArrowUp") { event.preventDefault(); setActive(index => Math.max(0, index - 1)); return; }
    if (event.key === "Enter") { event.preventDefault(); rows[active]?.run(); }
  }, [rows, active, onClose]);

  const orderRows = rows.filter(row => row.id.startsWith("order-"));
  const commandRows = rows.filter(row => !row.id.startsWith("order-"));

  return (
    <div className={styles.paletteBackdrop} onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <div className={styles.palette} role="dialog" aria-modal="true" aria-label="Поиск и команды">
        <div className={styles.paletteInput}>
          <span aria-hidden="true">🔍</span>
          <input
            ref={inputRef}
            value={value}
            onChange={event => setValue(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Код ВБ, ник Roblox, @username, ID пасса, номер заказа WB"
            aria-label="Поиск заказа или команды"
          />
          {searching && <span className={styles.hint}>ищем…</span>}
        </div>

        <div className={styles.paletteList}>
          {orderRows.length > 0 && <div className={styles.paletteGroup}>Заказы</div>}
          {orderRows.map((row, index) => (
            <button
              key={row.id}
              type="button"
              className={`${styles.paletteRow} ${active === index ? styles.paletteRowOn : ""}`}
              onMouseEnter={() => setActive(index)}
              onClick={row.run}
            >
              {row.label}
              {row.hint && <em>{row.hint}</em>}
            </button>
          ))}

          {commandRows.length > 0 && <div className={styles.paletteGroup}>Действия и переходы</div>}
          {commandRows.map((row, index) => {
            const globalIndex = orderRows.length + index;
            return (
              <button
                key={row.id}
                type="button"
                className={`${styles.paletteRow} ${active === globalIndex ? styles.paletteRowOn : ""}`}
                onMouseEnter={() => setActive(globalIndex)}
                onClick={row.run}
              >
                {row.label}
                {row.hint && <em>{row.hint}</em>}
              </button>
            );
          })}

          {rows.length === 0 && <div className={styles.empty}>Ничего не нашлось</div>}
        </div>

        <div className={styles.paletteFoot}>
          <span><b>↑↓</b> выбор</span>
          <span><b>↵</b> открыть</span>
          <span><b>esc</b> закрыть</span>
        </div>
      </div>
    </div>
  );
}
