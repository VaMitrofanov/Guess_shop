"use client";

import { useCallback, useEffect, useState } from "react";
import type { RiskFeed, RiskFeedItem, RiskState } from "@/lib/risk-feed-types";
import { RiskItem } from "./risk-item";
import css from "./risks.module.css";

/** Раздел «Риски» на сайте: сводка, «Открытые / Все», лента с «Разобрано». */
export default function RiskFeedClient() {
  const [state, setState] = useState<RiskState>("open");
  const [feed, setFeed] = useState<RiskFeed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async (next: RiskState) => {
    setError(null);
    try {
      const res = await fetch(`/api/admin/risks?state=${next}`, { cache: "no-store" });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error ?? "Не загрузилось");
      setFeed(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не загрузилось");
    }
  }, []);

  useEffect(() => { void load(state); }, [state, load]);

  async function toggle(item: RiskFeedItem) {
    setBusyId(item.id);
    try {
      const res = await fetch("/api/admin/risks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, action: item.resolvedAt ? "reopen" : "resolve" }),
      });
      if (!res.ok) throw new Error("Не сохранилось");
      await load(state);
      window.dispatchEvent(new Event("admin:risks-changed"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не сохранилось");
    } finally {
      setBusyId(null);
    }
  }

  const s = feed?.summary;
  return (
    <div className={css.root}>
      <div className={css.summary}>
        <div className={`${css.tile} ${css.tileRed}`}><b>{s?.open ?? "—"}</b><span>открыто</span></div>
        <div className={css.tile}><b>{s?.badReviews7d ?? "—"}</b><span>отзывов ★1–3 за 7 дней</span></div>
        <div className={`${css.tile} ${css.tileGreen}`}><b>{s?.fixed7d ?? "—"}</b><span>исправлено за 7 дней</span></div>
        <div className={`${css.tile} ${css.tileAmber}`}><b>{s?.claimsOpen ?? "—"}</b><span>заявок на возврат открыто</span></div>
      </div>

      <div className={css.toolbar}>
        <div className={css.seg} role="group" aria-label="Какие события показать">
          <button type="button" aria-pressed={state === "open"} onClick={() => setState("open")}>
            Открытые{s ? ` · ${s.open}` : ""}
          </button>
          <button type="button" aria-pressed={state === "all"} onClick={() => setState("all")}>Все</button>
        </div>
        <button type="button" className={css.refresh} onClick={() => void load(state)}>Обновить</button>
      </div>

      {error && <p className={css.error}>{error}</p>}
      {!feed && !error && <p className={css.hint}>Загружаем…</p>}
      {feed && feed.items.length === 0 && (
        <div className={css.empty}>{state === "open" ? "Открытых рисков нет — всё разобрано." : "Событий пока не было."}</div>
      )}
      <div className={css.list}>
        {feed?.items.map((item) => (
          <RiskItem key={item.id} item={item} busy={busyId === item.id} onToggle={toggle} />
        ))}
      </div>
    </div>
  );
}
