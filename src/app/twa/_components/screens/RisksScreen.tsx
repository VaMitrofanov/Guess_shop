"use client";

/* Раздел «Риски» (30.10.2026): всё, что требует решения человека, — плохие
   отзывы, исправления, заявки на возврат. «Открытые» — список дел; «Все» —
   история. Разобранное по закрытым заказам автоматика отмечает сама. */

import { useCallback, useEffect, useState } from "react";
import { C } from "../theme";
import { haptic } from "../haptics";
import { BuyerDossierSheet, RiskItemCard } from "../RiskBits";
import type { RiskFeed, RiskFeedItem, RiskState } from "@/lib/risk-feed-types";

export default function RisksScreen({
  token, onOpenOrder, onChanged,
}: {
  token: string;
  onOpenOrder: (code: string) => void;
  onChanged?: () => void;
}) {
  const [state, setState] = useState<RiskState>("open");
  const [feed, setFeed] = useState<RiskFeed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [buyer, setBuyer] = useState<string | null>(null);

  const load = useCallback(async (next: RiskState) => {
    setError(null);
    try {
      const res = await fetch(`/api/twa/risks?state=${next}`, { headers: { Authorization: `Bearer ${token}` } });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error ?? "Не загрузилось");
      setFeed(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не загрузилось");
    }
  }, [token]);

  useEffect(() => { void load(state); }, [state, load]);

  async function toggle(item: RiskFeedItem) {
    setBusyId(item.id);
    try {
      const res = await fetch("/api/twa/risks", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, action: item.resolvedAt ? "reopen" : "resolve" }),
      });
      if (!res.ok) throw new Error("Не сохранилось");
      haptic.notify("success");
      await load(state);
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не сохранилось");
    } finally {
      setBusyId(null);
    }
  }

  const summary = feed?.summary;
  return (
    <div style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch" as never, padding: "8px 14px 120px", display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "4px 2px 0" }}>
        <span style={{ fontSize: 14, color: C.textSecondary }}>Отзывы ★1–3, исправления и возвраты</span>
        <button type="button" className="twa-press-sm" onClick={() => { haptic.select(); void load(state); }}
          style={{ background: "none", border: 0, color: C.accent, fontSize: 15, cursor: "pointer", font: "inherit" }}>
          Обновить
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
        {([
          ["открыто", summary?.open, C.red],
          ["отзывов ★1–3 за 7 дн.", summary?.badReviews7d, C.textPrimary],
          ["исправлено за 7 дн.", summary?.fixed7d, C.green],
        ] as const).map(([label, value, tone]) => (
          <div key={label} style={{ background: C.card, border: `1px solid ${C.hairline}`, borderRadius: 14, padding: "11px 10px", display: "flex", flexDirection: "column", gap: 3 }}>
            <b style={{ fontSize: 24, color: tone, fontVariantNumeric: "tabular-nums" }}>{value ?? "—"}</b>
            <span style={{ fontSize: 14, color: C.textSecondary, lineHeight: 1.25 }}>{label}</span>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 6 }}>
        {(["open", "all"] as const).map((s) => (
          <button key={s} type="button" className="twa-press-sm" onClick={() => { haptic.select(); setState(s); }}
            style={{
              padding: "8px 14px", borderRadius: 999, border: 0, cursor: "pointer", font: "inherit", fontSize: 14,
              background: state === s ? C.textPrimary : C.cardTop, color: state === s ? C.bg : C.textSecondary,
              fontWeight: state === s ? 700 : 500,
            }}>
            {s === "open" ? `Открытые${summary ? ` · ${summary.open}` : ""}` : "Все"}
          </button>
        ))}
      </div>

      {error && <span style={{ fontSize: 15, color: C.red }}>{error}</span>}
      {!feed && !error && <span style={{ fontSize: 15, color: C.textSecondary }}>Загружаем…</span>}
      {feed && feed.items.length === 0 && (
        <div style={{ padding: "28px 12px", textAlign: "center", color: C.textSecondary, fontSize: 15 }}>
          {state === "open" ? "Открытых рисков нет — всё разобрано." : "Событий пока не было."}
        </div>
      )}
      {feed?.items.map((item) => (
        <RiskItemCard
          key={item.id}
          item={item}
          busy={busyId === item.id}
          onToggleResolved={toggle}
          onOpenOrder={onOpenOrder}
          onOpenBuyer={setBuyer}
        />
      ))}

      <BuyerDossierSheet token={token} name={buyer} onClose={() => setBuyer(null)}
        onOpenOrder={(code) => { setBuyer(null); onOpenOrder(code); }} />
    </div>
  );
}
