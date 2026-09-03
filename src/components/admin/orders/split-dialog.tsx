"use client";

/* ─────────────────────────────────────────────────────────────────────────────
   Разбиение выкупа на сайте.

   На телефоне это один список со счётчиками — больше туда не влезает. Здесь
   места хватает на две колонки, и это меняет саму работу: слева витрина
   покупателя, справа СОБРАННЫЙ заказ в том порядке, в котором его выкупать.
   Держать в голове «что уже набрано» не нужно — оно нарисовано рядом.

   Что даёт десктоп сверх телефона:
   • «Набрать под заказ» — точный размен номинала (`planSplitFor`). Руками это
     неочевидно: на витрине 1000/2000/802/499 заказ на 1301 закрывается только
     парой 802+499, а заказ на 2000 — двумя частями по 1000 на ОДНОМ пассе;
   • степперы «− N +» вместо тапа по строке: мышь попадает точно;
   • правая колонка с порядком выкупа и удалением конкретной части, а не
     последней;
   • клавиатура: 1…9 добавляют пасс, ⌫ снимает последнюю часть, ⌘↵ сохраняет.

   Один и тот же пасс можно взять несколько раз — это главный смысл экрана.
   Повторы выкупаются с РАЗНЫХ доноров, иначе Roblox ответит AlreadyOwned; об
   этом предупреждает плашка, и то же уходит в заметку заказа.
   ───────────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MAX_SPLIT_PARTS, planSplitFor } from "@/lib/order-gamepass-split";
import { AdminOrder, num } from "./types";
import styles from "./orders.module.css";

interface Candidate {
  gamepassId: string;
  name: string;
  price: number;
  amount: number;
  busyWith: string | null;
}

export default function SplitDialog({
  order, onClose, onChanged, onToast,
}: {
  order: AdminOrder;
  onClose: () => void;
  onChanged: () => void;
  onToast: (text: string, error?: boolean) => void;
}) {
  const parts = useMemo(() => order.splitGamepasses ?? [], [order.splitGamepasses]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [nick, setNick] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  /** Упорядоченный мультимножество ID: порядок = порядок выкупа. */
  const [chosen, setChosen] = useState<string[]>(() => parts.map(part => String(part.gamepassId)));

  /** Хотя бы одна часть выкуплена — состав трогать нельзя, робуксы списаны. */
  const hasPurchased = parts.some(part => part.purchasedAt);

  const post = useCallback(async (body: Record<string, unknown>) => {
    const res = await fetch("/api/admin/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId: order.id, ...body }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error ?? `Сервер ответил ${res.status}`);
    return data;
  }, [order.id]);

  // `onToast` прилетает новой функцией на каждый рендер родителя, поэтому в
  // зависимости она не годится: эффект перезапрашивал бы витрину бесконечно.
  const toastRef = useRef(onToast);
  useEffect(() => { toastRef.current = onToast; });

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const data = await post({ action: "split-candidates" });
        if (!alive) return;
        setNick(data?.nick ?? null);
        setCandidates(data?.passes ?? []);
      } catch (error) {
        if (alive) toastRef.current((error as Error).message, true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [post]);

  const byId = useMemo(() => new Map(candidates.map(c => [c.gamepassId, c])), [candidates]);
  const picked = chosen.map(id => byId.get(id)).filter(Boolean) as Candidate[];
  const sum = picked.reduce((acc, c) => acc + c.amount, 0);
  const diff = sum - order.amount;
  const canSave = !hasPurchased && picked.length >= 2 && diff === 0 && !saving;

  const countOf = useCallback((id: string) => chosen.filter(x => x === id).length, [chosen]);
  const repeated = useMemo(
    () => [...new Set(chosen)].filter(id => chosen.filter(x => x === id).length > 1),
    [chosen],
  );

  const add = useCallback((id: string) => {
    setChosen(prev => {
      if (prev.length >= MAX_SPLIT_PARTS) {
        toastRef.current(`Максимум ${MAX_SPLIT_PARTS} частей на заказ`, true);
        return prev;
      }
      return [...prev, id];
    });
  }, []);

  /** Минус у кандидата снимает ПОСЛЕДНЮЮ его часть, ✕ в списке — конкретную. */
  const removeLastOf = useCallback((id: string) => {
    setChosen(prev => {
      const last = prev.lastIndexOf(id);
      return last < 0 ? prev : [...prev.slice(0, last), ...prev.slice(last + 1)];
    });
  }, []);

  const removeAt = useCallback((index: number) => {
    setChosen(prev => [...prev.slice(0, index), ...prev.slice(index + 1)]);
  }, []);

  /** Точный размен номинала тем, что у покупателя выставлено. */
  const autoFill = useCallback(() => {
    const free = candidates.filter(c => !c.busyWith);
    const plan = planSplitFor(order.amount, free);
    if (!plan) {
      toastRef.current(`Из выставленных пассов ровно ${num(order.amount)} R$ не собрать`, true);
      return;
    }
    setChosen(plan.map(part => part.gamepassId));
    toastRef.current(`Набрано ${plan.length} ч. на ${num(order.amount)} R$`);
  }, [candidates, order.amount]);

  async function save() {
    if (!canSave) return;
    setSaving(true);
    try {
      await post({
        action: "set-gamepass-split",
        parts: picked.map(c => ({ gamepassId: c.gamepassId, amount: c.amount })),
      });
      onToast(`🧩 Разбит на ${picked.length} — выкупай по частям`);
      onChanged();
      onClose();
    } catch (error) {
      onToast((error as Error).message, true);
    } finally {
      setSaving(false);
    }
  }

  async function clearSplit() {
    setSaving(true);
    try {
      await post({ action: "clear-gamepass-split" });
      onToast("Разбиение снято");
      onChanged();
      onClose();
    } catch (error) {
      onToast((error as Error).message, true);
    } finally {
      setSaving(false);
    }
  }

  // Клавиатура — как во всём рабочем месте: руки не уходят на мышь.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); if (!saving) onClose(); return; }
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); void save(); return; }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (hasPurchased) return;
      if (event.key === "Backspace") {
        event.preventDefault();
        setChosen(prev => prev.slice(0, -1));
        return;
      }
      const digit = Number(event.key);
      if (Number.isInteger(digit) && digit >= 1 && digit <= 9) {
        const candidate = candidates[digit - 1];
        if (candidate && !candidate.busyWith) { event.preventDefault(); add(candidate.gamepassId); }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const progress = Math.min(100, Math.round((sum / Math.max(1, order.amount)) * 100));
  const barColor = diff === 0 && picked.length >= 2 ? "var(--o-green)" : diff > 0 ? "var(--o-red)" : "var(--o-accent)";

  return (
    <div className={styles.paletteBackdrop} onMouseDown={event => event.target === event.currentTarget && !saving && onClose()}>
      <div className={styles.splitDialog} role="dialog" aria-modal="true" aria-label={`Разбить выкуп ${order.wbCode}`}>
        <h3>🧩 Разбить выкуп — {order.wbCode}</h3>
        <p>
          Заказ на <b>{num(order.amount)} R$</b>
          {nick ? <> · пассы <b>{nick}</b></> : null}
          {" · "}номинал части берётся из цены пасса, сумма частей обязана сойтись точно
        </p>

        {hasPurchased && (
          <div className={styles.splitWarn} style={{ borderColor: "rgba(255, 214, 10, .3)", background: "rgba(255, 214, 10, .1)", color: "#ffe89a" }}>
            Часть уже выкуплена — состав менять нельзя. Доступно только «Снять разбиение».
          </div>
        )}

        {repeated.length > 0 && !hasPurchased && (
          <div className={styles.splitWarn}>
            Пасс взят несколько раз ({repeated.map(id => `${id} ×${countOf(id)}`).join(", ")}).
            Каждый повтор выкупай с <b>другого донора</b> — тому же аккаунту Roblox ответит
            AlreadyOwned, и робуксы спишутся впустую.
          </div>
        )}

        <div className={styles.splitCols}>
          {/* ── Витрина покупателя ─────────────────────────────────────── */}
          <div className={styles.splitCol}>
            <div className={styles.splitColHead}>
              Пассы покупателя
              <em>{loading ? "ищем…" : `${candidates.length} шт. · клавиши 1…9`}</em>
            </div>
            <div className={styles.splitColBody}>
              {loading ? (
                <div className={styles.loading}>Ищем геймпассы на продаже…</div>
              ) : candidates.length === 0 ? (
                <div className={styles.empty}>
                  <strong>Пассов не нашли</strong>
                  У этого ника нет геймпассов на продаже — или Roblox сейчас недоступен.
                </div>
              ) : candidates.map((candidate, index) => {
                const count = countOf(candidate.gamepassId);
                const blocked = !!candidate.busyWith || hasPurchased;
                const canAdd = !blocked && chosen.length < MAX_SPLIT_PARTS;
                return (
                  <div key={candidate.gamepassId} className={`${styles.splitCand} ${count > 0 ? styles.splitCandOn : ""}`}>
                    <button
                      type="button"
                      className={styles.splitCandAdd}
                      onClick={() => canAdd && add(candidate.gamepassId)}
                      disabled={!canAdd}
                      aria-label={`Добавить часть на ${candidate.amount} R$ — ${candidate.name}`}
                    >
                      <span style={{ minWidth: 0, flex: 1 }}>
                        <span className={styles.splitCandName}>
                          {index < 9 && <kbd style={{ marginRight: 6, color: "#75757d", fontSize: 11 }}>{index + 1}</kbd>}
                          {candidate.name}
                        </span>
                        <span className={styles.splitCandMeta}>
                          {num(candidate.price)} R$ · {candidate.gamepassId}
                          {candidate.busyWith ? ` · занят ${candidate.busyWith}` : ""}
                        </span>
                      </span>
                      <span className={styles.splitCandAmount} style={{ color: count > 0 ? "#cdbcff" : "var(--o-muted)" }}>
                        {num(candidate.amount)}
                      </span>
                    </button>
                    <div className={styles.stepper}>
                      <button
                        type="button"
                        className={styles.stepBtn}
                        onClick={() => removeLastOf(candidate.gamepassId)}
                        disabled={count === 0 || hasPurchased}
                        aria-label={`Убрать одну часть — ${candidate.name}`}
                      >−</button>
                      <span className={styles.stepCount}>{count || "·"}</span>
                      <button
                        type="button"
                        className={styles.stepBtn}
                        onClick={() => add(candidate.gamepassId)}
                        disabled={!canAdd}
                        aria-label={`Добавить часть — ${candidate.name}`}
                      >+</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Собранная разбивка ─────────────────────────────────────── */}
          <div className={styles.splitCol}>
            <div className={styles.splitColHead}>
              Разбивка
              <em>
                <button type="button" className={styles.btn} style={{ minHeight: 26, padding: "0 9px", fontSize: 12 }}
                  onClick={autoFill} disabled={loading || hasPurchased || candidates.length === 0}>
                  Набрать под заказ
                </button>
                {chosen.length > 0 && !hasPurchased && (
                  <button type="button" className={styles.btn} style={{ minHeight: 26, padding: "0 9px", fontSize: 12, marginLeft: 6 }}
                    onClick={() => setChosen([])}>
                    Очистить
                  </button>
                )}
              </em>
            </div>
            <div className={styles.splitColBody}>
              {chosen.length === 0 ? (
                <div className={styles.empty} style={{ padding: "30px 16px" }}>
                  <strong>Пока пусто</strong>
                  Добавьте пассы слева или нажмите «Набрать под заказ».
                </div>
              ) : chosen.map((id, index) => {
                const candidate = byId.get(id);
                const done = parts[index]?.purchasedAt && parts[index]?.gamepassId === id;
                return (
                  <div key={`${id}-${index}`} className={styles.splitPart} title={`Часть ${index + 1} — выкупается ${index === 0 ? "первой" : `${index + 1}-й`}`}>
                    <span className={styles.splitPartNo}>{index + 1}</span>
                    {candidate && <span className={styles.splitPartName}>{candidate.name}</span>}
                    <span className={styles.splitPartId}>{id}</span>
                    {done && <span className={styles.splitPartDone}>✓</span>}
                    <span className={styles.splitPartAmount}>
                      {candidate ? `${num(candidate.amount)} R$` : "номинал неизвестен"}
                    </span>
                    {!hasPurchased && (
                      <button type="button" className={styles.splitPartDrop} onClick={() => removeAt(index)}
                        aria-label={`Убрать часть ${index + 1}`}>✕</button>
                    )}
                  </div>
                );
              })}
            </div>
            <div className={styles.splitBar}>
              <div className={styles.splitBarFill} style={{ width: `${progress}%`, background: barColor }} />
            </div>
            <div className={styles.splitTotals}>
              <span style={{ color: "var(--o-muted)" }}>Частей {picked.length}:</span>
              <b style={{ color: diff === 0 && picked.length >= 2 ? "var(--o-green)" : "#e4e4e8" }}>{num(sum)} R$</b>
              <span style={{ color: "var(--o-muted)" }}>из {num(order.amount)} R$</span>
              {diff !== 0 && picked.length > 0 && (
                <span style={{ color: "var(--o-orange)" }}>
                  {diff > 0 ? `лишние ${num(diff)}` : `не хватает ${num(-diff)}`} R$
                </span>
              )}
            </div>
          </div>
        </div>

        <div className={styles.askActions}>
          <span className={styles.hint} style={{ marginRight: "auto" }}>
            1…9 добавить · ⌫ снять последнюю · ⌘↵ сохранить · Esc закрыть
          </span>
          {parts.length > 0 && (
            <button type="button" className={styles.btn} style={{ color: "#ffc0ba" }} onClick={() => void clearSplit()} disabled={saving}>
              Снять разбиение
            </button>
          )}
          <button type="button" className={styles.btn} onClick={onClose} disabled={saving}>Отмена</button>
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => void save()} disabled={!canSave}>
            {saving ? "Сохраняем…" : picked.length < 2 ? "Нужно минимум 2 части" : diff !== 0 ? "Сумма не сходится" : `Разбить на ${picked.length}`}
            {canSave && <kbd>⌘↵</kbd>}
          </button>
        </div>
      </div>
    </div>
  );
}
