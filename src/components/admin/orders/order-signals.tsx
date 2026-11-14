"use client";

/**
 * Состояние и лента заказа на сайте (11.11.2026).
 *
 * Три куска, общие правила — в `@/lib/order-feed`:
 *  • `NowBlock` — «Сейчас» под шапкой досье: можно ли выкупать + заметка;
 *  • `OrderFeed` — поле «Добавить заметку» и хроника заказа;
 *  • `StateWord` / `Headline` — слово состояния и строка под ником в очереди.
 * Минимум оформления: цвет несёт только состояние, выделены только слова
 * покупателя.
 */

import { useState } from "react";
import { collapseFeed, orderFeed, orderHeadline, orderNow, orderStateWord, type FeedOrder } from "@/lib/order-feed";
import { TONE_COLOR } from "./types";
import styles from "./orders.module.css";

export function StateWord({ order }: { order: FeedOrder }) {
  const w = orderStateWord(order);
  if (!w) return null;
  return <span className={styles.stateWord} style={{ color: TONE_COLOR[w.tone] }}>{w.text}</span>;
}

export function Headline({ order }: { order: FeedOrder }) {
  const text = orderHeadline(order);
  return text ? <span className={styles.headline} title={text}>{text}</span> : null;
}

export function NowBlock({
  order,
  onUnhold,
  onAck,
}: {
  order: FeedOrder;
  onUnhold: () => void;
  onAck: (flag: string) => void;
}) {
  const now = orderNow(order);
  if (!now) return null;
  const color = TONE_COLOR[now.tone];
  return (
    <div className={styles.now} style={{ ["--now" as string]: color }}>
      {now.title && (
        <div className={styles.nowHead}>
          <i aria-hidden />
          <strong>{now.title}</strong>
          {now.sub && <span>{now.sub}</span>}
          {now.action && (
            <button
              type="button"
              className={styles.nowAction}
              onClick={() => (now.action!.kind === "unhold" ? onUnhold() : onAck(now.action!.kind === "ack" ? now.action!.flag : ""))}
            >
              {now.actionLabel}
            </button>
          )}
        </div>
      )}
      {now.quote && <p className={styles.quote}>«{now.quote}»</p>}
      {now.note && (
        <div className={styles.nowNote} data-solo={now.title ? undefined : "1"}>
          <p>{now.note.text}</p>
          {now.note.meta && <span>{now.note.meta}</span>}
        </div>
      )}
    </div>
  );
}

export function OrderFeed({
  order,
  onAdd,
  onEditRaw,
}: {
  order: FeedOrder;
  onAdd: (text: string) => Promise<boolean>;
  onEditRaw: () => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const entries = collapseFeed(orderFeed(order));

  async function submit() {
    const value = text.trim();
    if (!value || busy) return;
    setBusy(true);
    const ok = await onAdd(value);
    setBusy(false);
    if (ok) setText("");
  }

  return (
    <section className={styles.feed} aria-label="Лента заказа">
      <label htmlFor="order-note" className={styles.feedLabel}>Лента заказа</label>
      <input
        id="order-note"
        className={styles.feedInput}
        value={text}
        disabled={busy}
        placeholder="Добавить заметку…  ↵"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void submit(); } e.stopPropagation(); }}
      />
      {entries.length > 0 && (
        <ol className={styles.feedList}>
          {entries.map((e) => (
            <li key={e.key} data-dim={e.weight === "dim" ? "1" : undefined}>
              <span className={styles.feedText}>
                {e.text}
                {e.quote && <span className={styles.quote}>«{e.quote}»</span>}
              </span>
              {e.meta && <span className={styles.feedMeta}>{e.meta}</span>}
            </li>
          ))}
        </ol>
      )}
      <button type="button" className={styles.feedRaw} onClick={onEditRaw}>Править текстом</button>
    </section>
  );
}
