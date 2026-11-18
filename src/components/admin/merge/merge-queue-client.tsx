"use client";

import { useCallback, useEffect, useState } from "react";
import css from "./merge.module.css";

type Side = { id: string; name: string | null; username: string | null; orders: number; createdAt: string; channels: string[] };
type Pair = { key: string; strong: boolean; evidence: Array<{ kind: string; text: string; strong: boolean }>; target: Side; source: Side };

const fmt = (iso: string) => new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Moscow" }).format(new Date(iso));

function SideCard({ title, side }: { title: string; side: Side }) {
  return (
    <div className={css.side}>
      <span className={css.label}>{title}</span>
      <span className={css.name}>{side.name ?? (side.username ? `@${side.username}` : "Без имени")}</span>
      <span className={css.meta}>{side.channels.join(" · ") || "—"}{side.username ? ` · @${side.username}` : ""}</span>
      <span className={css.meta}>Заказов: {side.orders} · с {fmt(side.createdAt)}</span>
    </div>
  );
}

/** Очередь «похоже, один человек» (Э7, 18.11.2026). */
export default function MergeQueueClient() {
  const [pairs, setPairs] = useState<Pair[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/admin/merge", { cache: "no-store" });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error ?? "Не загрузилось");
      setPairs(d.pairs);
      setTotal(d.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не загрузилось");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function act(p: Pair, action: "merge" | "dismiss") {
    setBusy(p.key); setError(null);
    try {
      const res = await fetch("/api/admin/merge", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, targetId: p.target.id, sourceId: p.source.id }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d?.error ?? "Не получилось");
      setPairs((prev) => prev?.filter((x) => x.key !== p.key) ?? null);
      setTotal((t) => Math.max(0, t - 1));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не получилось");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={css.root}>
      <div className={css.toolbar}>
        <span>{pairs ? `Пар: ${total}` : "Загружаем…"}</span>
        <button type="button" className={css.refresh} onClick={() => void load()}>Обновить</button>
      </div>
      {error && <p className={css.error} role="alert">{error}</p>}
      {pairs && !pairs.length && <p className={css.empty}>Похожих пар нет — все разобраны.</p>}
      <div className={css.list}>
        {pairs?.map((p) => (
          <article key={p.key} className={`${css.pair} ${p.strong ? css.pairStrong : ""}`}>
            <div className={css.sides}>
              <SideCard title="ОСТАЁТСЯ" side={p.target} />
              <SideCard title="ВЛИВАЕТСЯ" side={p.source} />
            </div>
            <ul className={css.evidence} aria-label="Почему думаем, что это один человек">
              {p.evidence.map((e) => (
                <li key={e.text}><span>{e.text}</span><span className={e.strong ? css.strong : css.weak}>{e.strong ? "сильно" : "слабо"}</span></li>
              ))}
            </ul>
            <div className={css.actions}>
              <button type="button" className={css.ghost} disabled={busy === p.key} onClick={() => void act(p, "dismiss")}>Разные люди</button>
              <button type="button" className={css.primary} disabled={busy === p.key} onClick={() => void act(p, "merge")}>Склеить</button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
