"use client";

/* ─────────────────────────────────────────────────────────────────────────────
   Универсальный редактор заказа.

   Причина, по которой он появился (03.09.2026, заказ `W78WFDP`): у заказа не
   было геймпасса, а привязать его руками было НЕОТКУДА. На сайте правки не
   существовало вовсе — ни в ленте, ни в досье, ни из поиска: досье честно
   писало «найдите пасс по нику», а поиск по нику ходит в Roblox, и когда
   Roblox отдаёт пустой список (скрытый плейс, региональный сбой, недоступность
   из РФ), работа вставала совсем.

   Отсюда два правила этого окна:

   1. **ID вводится руками и всегда.** Живая проверка цены — подсказка, а не
      разрешение: она может не ответить, и это не повод не дать админу
      дописать то, что он знает. Блокирует сохранение только мусор в поле.
   2. **Одно окно на все поля.** Ник, пасс, номинал, источник и заметка
      сохраняются одним запросом `edit-order` — с одной строкой аудита в
      заметке. Раньше заметку правили отдельно и её забывали.

   Окно открывается из ленты (кнопка в строке и клавиша `I`), из досье, из
   палитры `⌘K` и по адресу `?order=<id>&edit=1` — этой ссылкой правку
   открывает любой экран, включая «Обзор».
   ───────────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { grossOf } from "@/lib/order-presentation";
import { AdminOrder, copyText, gamepassIdOf, num } from "./types";
import styles from "./orders.module.css";

/** Статусы, в которых сервер принимает `edit-order`. */
const EDITABLE = ["PENDING", "AWAITING_GAMEPASS", "ERROR", "REJECTED"];

const SOURCES = [
  { id: "WB", label: "Wildberries — карта с кодом" },
  { id: "WB_DBS", label: "WB DBS — доставка продавцом" },
  { id: "DIRECT", label: "Прямой — оплата напрямую" },
  { id: "AVITO", label: "Авито" },
  { id: "MANUAL", label: "Ручной" },
];

interface GpCheck {
  gamepassId?: string;
  livePrice?: number | null;
  isForSale?: boolean | null;
  expected?: number | null;
  priceMismatch?: boolean;
  sellerMatch?: boolean | null;
  existing?: { wbCode: string; status: string; orderId: string } | null;
  error?: string;
}

/** ID из ссылки или из введённых цифр. Правило то же, что на сервере. */
function parseGamepass(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.match(/game-pass(?:es)?\/(\d+)/i)?.[1] ?? (/^\d{4,}$/.test(trimmed) ? trimmed : null);
}

/** Человеческая часть заметки: машинные строки начинаются с `[МЕТКА]`. */
function humanNote(note: string | null): string {
  return (note ?? "")
    .split("\n")
    .map(line => line.trim())
    .filter(line => line && !line.startsWith("["))
    .join(" · ");
}

/** Машинные строки — их правка не трогает, но видеть их надо. */
function machineNote(note: string | null): string[] {
  return (note ?? "")
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.startsWith("["));
}

export default function OrderEditor({
  order, onClose, onSaved, onToast,
}: {
  order: AdminOrder;
  onClose: () => void;
  /** Правка применена: лента и счётчики перечитываются. */
  onSaved: (result: { changes: string[]; notified: string | null }) => void;
  onToast: (text: string, error?: boolean) => void;
}) {
  const editable = EDITABLE.includes(order.status) && !order.heldAt;

  const [nick, setNick] = useState(order.robloxUsername ?? "");
  const [gamepass, setGamepass] = useState(gamepassIdOf(order) ?? "");
  const [amount, setAmount] = useState(String(order.amount));
  const [source, setSource] = useState(order.orderSource);
  const [note, setNote] = useState(humanNote(order.adminNote));
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);
  const [check, setCheck] = useState<GpCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const checkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const machine = useMemo(() => machineNote(order.adminNote), [order.adminNote]);
  const gpId = parseGamepass(gamepass);
  const gpDirty = gamepass.trim() !== (gamepassIdOf(order) ?? "");
  const malformed = gamepass.trim().length > 0 && !gpId;
  const parts = order.splitGamepasses ?? [];

  const changed = useMemo(() => {
    const list: string[] = [];
    if (nick.trim() !== (order.robloxUsername ?? "")) list.push("ник");
    if (gpDirty) list.push(gpId ? "геймпасс" : "геймпасс снят");
    if (!order.isDirectOrder && Number(amount) !== order.amount) list.push("номинал");
    if (source !== order.orderSource) list.push("источник");
    if (note.trim() !== humanNote(order.adminNote)) list.push("заметка");
    return list;
  }, [nick, gamepass, gpId, gpDirty, amount, source, note, order]);

  /* Живая проверка пасса — только подсказка. Ходит на тот же `manual-validate`,
     что и лист заказа в TWA, поэтому правила цены и занятости здесь ровно те
     же, что при создании. Ошибка сети или молчание Roblox сохранение не
     блокируют: ради этого окно и сделано. */
  useEffect(() => {
    if (!gpId || !gpDirty) { setCheck(null); return; }
    if (checkTimer.current) clearTimeout(checkTimer.current);
    checkTimer.current = setTimeout(async () => {
      setChecking(true);
      try {
        const res = await fetch("/api/admin/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "manual-validate",
            gamepassUrl: gpId,
            amount: Number(amount) || order.amount,
            robloxUsername: nick.trim(),
          }),
        });
        const data = await res.json().catch(() => ({}));
        setCheck(res.ok ? (data.gamepass ?? null) : null);
      } catch {
        setCheck(null); // Roblox молчит — это не ошибка ввода
      } finally {
        setChecking(false);
      }
    }, 450);
    return () => { if (checkTimer.current) clearTimeout(checkTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gpId, gpDirty, amount, nick]);

  const save = useCallback(async (force = false) => {
    if (!editable || changed.length === 0 || malformed) return;
    setSaving(true);
    setConflict(null);
    try {
      const res = await fetch("/api/admin/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "edit-order",
          orderId: order.id,
          robloxUsername: nick.trim(),
          gamepassUrl: gamepass.trim(),
          ...(order.isDirectOrder ? {} : { amount: Number(amount) || order.amount }),
          orderSource: source,
          note: note.trim(),
          ...(force ? { force: true } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // 409 по дублю пасса — развилка, а не тупик: решает человек.
        if (res.status === 409 && data?.existing?.wbCode) { setConflict(data.error); return; }
        onToast(data?.error ?? `Сервер ответил ${res.status}`, true);
        return;
      }
      onSaved({ changes: data?.changes ?? changed, notified: data?.notified ?? null });
    } catch (error) {
      onToast((error as Error).message, true);
    } finally {
      setSaving(false);
    }
  }, [editable, changed, malformed, order, nick, gamepass, amount, source, note, onSaved, onToast]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); void save(false); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, save]);

  const expected = grossOf(Number(amount) || order.amount);
  /** Пасса не было, а теперь есть — заказ уедет в очередь, клиенту уйдёт пуш. */
  const willQueue = !gamepassIdOf(order) && !!gpId && order.status === "AWAITING_GAMEPASS";
  const willUnqueue = !!gamepassIdOf(order) && !gpId && gpDirty;

  return (
    <div className={styles.paletteBackdrop} onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <div className={styles.ask} role="dialog" aria-modal="true" aria-label={`Правка заказа ${order.wbCode}`} style={{ maxWidth: 560 }}>
        <h3>
          Правка заказа <span style={{ fontFamily: "ui-monospace, Menlo, monospace" }}>{order.wbCode}</span>
        </h3>
        <p>
          {order.isDirectOrder ? "Прямой заказ · номинал привязан к оплате" : `Номинал ${num(order.amount)} R$ · пасс по номиналу ${num(expected)} R$`}
          {" · "}{order.status}
        </p>

        {!editable && (
          <p style={{ color: "#ffc0ba" }}>
            {order.heldAt
              ? "❄️ Заказ заморожен — сначала разморозьте: правка мимо заморозки была бы чёрным ходом."
              : `В статусе ${order.status} сервер правку не принимает. Доступно: ${EDITABLE.join(", ")}.`}
          </p>
        )}

        <div style={{ display: "grid", gap: 10, opacity: editable ? 1 : 0.5, pointerEvents: editable ? "auto" : "none" }}>
          <label style={{ display: "grid", gap: 5 }}>
            <span className={styles.kvKey}>Ник Roblox</span>
            <input value={nick} onChange={event => setNick(event.target.value)} placeholder="кому зачисляем" />
            {/* Вероятный ник — то, что покупатель вводил сам. Один тап вместо
                перепечатывания из заметки. */}
            {order.probableNick && order.probableNick !== nick.trim() && (
              <span className={styles.hint}>
                покупатель вводил <b>{order.probableNick}</b>
                <button type="button" className={styles.btn} style={{ marginLeft: 8, padding: "2px 8px" }} onClick={() => setNick(order.probableNick ?? "")}>
                  подставить
                </button>
              </span>
            )}
          </label>

          <label style={{ display: "grid", gap: 5 }}>
            <span className={styles.kvKey}>Геймпасс — ID или ссылка</span>
            <input
              autoFocus
              value={gamepass}
              onChange={event => setGamepass(event.target.value)}
              placeholder="1613331528 или roblox.com/game-pass/1613331528"
              style={{ fontFamily: "ui-monospace, Menlo, monospace" }}
            />
            {malformed && <span style={{ color: "#ffc0ba", fontSize: 13 }}>Нужны цифры ID или ссылка roblox.com/game-pass/…</span>}
            {gpId && (
              <span className={styles.hint}>
                {checking ? "проверяю на Roblox…"
                  : check?.livePrice != null
                    ? <>
                        цена <b>{num(check.livePrice)} R$</b>
                        {check.priceMismatch ? <span style={{ color: "var(--o-orange)" }}> ≠ ожидаемой {num(expected)} R$</span> : " — сходится с номиналом"}
                        {check.isForSale === false && <span style={{ color: "var(--o-red)" }}> · снят с продажи</span>}
                        {check.sellerMatch === false && <span style={{ color: "var(--o-orange)" }}> · пасс не этого ника</span>}
                      </>
                    : <>Roblox не ответил про этот пасс — сохранить всё равно можно, цену проверит выкуп</>}
                {" · "}
                <a href={`https://www.roblox.com/game-pass/${gpId}`} target="_blank" rel="noreferrer" style={{ color: "#b9aaff" }}>открыть ↗</a>
                {" · "}
                <button type="button" className={styles.btn} style={{ padding: "2px 8px" }} onClick={() => { copyText(gpId); onToast(`⧉ ${gpId}`); }}>⧉ ID</button>
              </span>
            )}
            {check?.existing && check.existing.orderId !== order.id && (
              <span style={{ color: "var(--o-orange)", fontSize: 13 }}>
                На этот пасс уже есть заказ {check.existing.wbCode} ({check.existing.status})
              </span>
            )}
            {parts.length > 0 && (
              <span className={styles.hint}>
                Заказ разбит на {parts.length} — поле правит текущую часть. Полная разбивка живёт в «🧩 Разбить выкуп».
              </span>
            )}
          </label>

          {!order.isDirectOrder && (
            <label style={{ display: "grid", gap: 5 }}>
              <span className={styles.kvKey}>Номинал, R$ чистыми клиенту</span>
              <input value={amount} onChange={event => setAmount(event.target.value.replace(/\D/g, ""))} inputMode="numeric" />
            </label>
          )}

          <label style={{ display: "grid", gap: 5 }}>
            <span className={styles.kvKey}>Источник</span>
            <select value={source} onChange={event => setSource(event.target.value)}>
              {SOURCES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>

          <label style={{ display: "grid", gap: 5 }}>
            <span className={styles.kvKey}>Заметка — зачем правим, что не так</span>
            <textarea value={note} onChange={event => setNote(event.target.value)} rows={2} placeholder="Пасс привязан руками: поиск по нику пустой" />
            {machine.length > 0 && (
              <span className={styles.hint}>
                Машинный аудит сохраняется: {machine.length} {machine.length === 1 ? "строка" : "строк"} — {machine[machine.length - 1].slice(0, 70)}
              </span>
            )}
          </label>
        </div>

        {(willQueue || willUnqueue) && (
          <p className={styles.hint} style={{ marginTop: 12, color: willQueue ? "var(--o-green)" : "var(--o-orange)" }}>
            {willQueue
              ? "После сохранения заказ уйдёт в очередь выкупа, и клиенту уйдёт уведомление «геймпасс принят»."
              : "Пасс снимается — заказ вернётся в «Ждут ссылку» и из очереди выкупа уйдёт."}
          </p>
        )}

        {conflict && (
          <p style={{ marginTop: 12, color: "#ffc0ba" }}>
            {conflict}
            <button type="button" className={styles.btn} style={{ marginLeft: 10 }} onClick={() => void save(true)} disabled={saving}>
              Всё равно привязать
            </button>
          </p>
        )}

        <div className={styles.askActions}>
          <button type="button" className={styles.btn} onClick={onClose}>Отмена <kbd>Esc</kbd></button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={() => void save(false)}
            disabled={!editable || saving || changed.length === 0 || malformed}
          >
            {saving ? "Сохраняю…" : changed.length > 0 ? `Сохранить · ${changed.join(", ")}` : "Нет изменений"} <kbd>⌘↵</kbd>
          </button>
        </div>
      </div>
    </div>
  );
}
