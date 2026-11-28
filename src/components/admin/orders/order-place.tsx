"use client";

/* «Где заказ» на сайте (25.11.2026) — тот же выбор, что в TWA
   (`src/app/twa/_components/OrderSettingsBlocks.tsx`): одно место вместо
   «Пометить ошибкой», «Отменить», «Переместить», «Вернуть к выкупу».
   Переходы — `placeRequests` из общего реестра. */

import { useState } from "react";
import { ORDER_PLACES, orderPlaceOf, placeRequests, type OrderPlace } from "@/lib/order-actions";
import type { AdminOrder } from "./types";
import styles from "./orders.module.css";

const REASON_CHIPS: Record<OrderPlace, string[]> = {
  ERROR: ["не та цена", "пасс снят", "донор пуст", "AlreadyOwned"],
  REJECTED: ["дубль заказа", "деньги вернули", "по просьбе покупателя"],
  BUYOUT: ["пасс поправили", "цену поправили"],
  AWAITING: ["нужен новый пасс", "пасс не тот"],
};

const TONE: Record<OrderPlace, string> = {
  AWAITING: "var(--o-yellow, #ffd60a)",
  BUYOUT: "var(--o-green, #30d158)",
  ERROR: "var(--o-orange, #ff9f0a)",
  REJECTED: "var(--o-red, #ff453a)",
};

export default function OrderPlaceBox({ order, post, onToast, onChanged }: {
  order: AdminOrder;
  post: (body: Record<string, unknown>) => Promise<unknown>;
  onToast: (text: string, error?: boolean) => void;
  onChanged: () => void;
}) {
  const current = orderPlaceOf(order.status);
  const [target, setTarget] = useState<OrderPlace | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  if (!current) return null;
  const held = Boolean(order.heldAt);

  async function apply() {
    if (!target || busy) return;
    const plan = placeRequests(order, target, reason);
    if ("error" in plan) { onToast(plan.error, true); return; }
    setBusy(true);
    try {
      for (const request of plan.requests) await post(request);
      onToast(`Перенесён: ${ORDER_PLACES.find(p => p.id === target)?.label}`);
      setTarget(null);
      setReason("");
      onChanged();
    } catch (error) {
      onToast((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.box}>
      <div className={styles.boxHead}>Где заказ{held && <em>заморожен — сначала разморозить</em>}</div>
      <div role="radiogroup" aria-label="Где заказ"
        style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 4, padding: 4, borderRadius: 10, background: "rgba(255,255,255,.05)" }}>
        {ORDER_PLACES.map(place => {
          const isCurrent = place.id === current;
          const isTarget = place.id === target;
          return (
            <button key={place.id} type="button" role="radio" aria-checked={isCurrent}
              disabled={held || isCurrent || busy}
              onClick={() => { setTarget(prev => (prev === place.id ? null : place.id)); setReason(""); }}
              style={{
                minHeight: 34, borderRadius: 7, fontFamily: "inherit", fontSize: 13.5, fontWeight: 650,
                border: `1px solid ${isTarget ? TONE[place.id] : "transparent"}`,
                background: isCurrent ? "rgba(255,255,255,.1)" : "transparent",
                color: isCurrent ? TONE[place.id] : isTarget ? "#fff" : "#a1a1aa",
                cursor: held || isCurrent ? "default" : "pointer",
              }}>
              {place.label}
            </button>
          );
        })}
      </div>
      {target && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {REASON_CHIPS[target].map(chip => (
              <button key={chip} type="button" className={styles.btnSm} onClick={() => setReason(chip)}
                style={reason === chip ? { borderColor: TONE[target] } : undefined}>{chip}</button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={reason}
              onChange={event => setReason(event.target.value)}
              onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void apply(); } }}
              placeholder={target === "REJECTED" ? "Причина — её увидит покупатель" : "Причина"}
              aria-label="Причина переноса"
              autoComplete="off"
              style={{
                flex: 1, minWidth: 0, minHeight: 34, padding: "0 10px", borderRadius: 8,
                border: "1px solid var(--o-line-2, rgba(255,255,255,.14))", background: "rgba(255,255,255,.04)",
                color: "#fff", fontSize: 14, outline: "none",
              }}
            />
            <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => void apply()} disabled={busy || !reason.trim()}>
              {busy ? "…" : `В «${ORDER_PLACES.find(p => p.id === target)?.label}»`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
