"use client";

/**
 * 🔗 Контакты заказа в досье (17.11.2026).
 *
 * Кроме владельца, заказ может видеть ещё несколько аккаунтов: покупатель
 * написал в поддержку или в бота с другого Telegram/VK и назвал код, пасс или
 * ник. Здесь видно, кто они, откуда взялись, и можно добавить или убрать.
 */

import { useState } from "react";
import styles from "./orders.module.css";
import { VIA_WORD } from "../../../../bots/shared/order-contacts";
import { vkCommunityDialogUrl } from "../../../../bots/shared/vk-links";

export interface OrderContactRow {
  id: string;
  via: string;
  evidence: string | null;
  createdAt: string;
  removedAt: string | null;
  removedBy: string | null;
  user: { id: string; tgId: string | null; vkId: string | null; name: string | null; username: string | null } | null;
}

function who(u: OrderContactRow["user"]): { channel: string; label: string } {
  if (!u) return { channel: "—", label: "профиль удалён" };
  const channel = u.tgId ? "TG" : u.vkId ? "VK" : "—";
  const label = u.name?.trim() || (u.username ? `@${u.username}` : u.tgId ? `tg ${u.tgId}` : `vk ${u.vkId}`);
  return { channel, label: u.username && u.name ? `${label} · @${u.username}` : label };
}

/** Telegram без @username открывается по ID (`tg://user?id=`) — у того, кто уже с ним переписывался. */
function writeHref(u: OrderContactRow["user"]): string | null {
  if (!u) return null;
  if (u.username) return `https://t.me/${u.username}`;
  if (u.tgId) return `tg://user?id=${u.tgId}`;
  if (u.vkId) return vkCommunityDialogUrl(u.vkId);
  return null;
}

const fmt = (iso: string) => new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });

export function OrderContactsBlock({ initial, post, onToast }: {
  initial: OrderContactRow[];
  post: (payload: Record<string, unknown>) => Promise<{ contacts?: OrderContactRow[] }>;
  onToast: (text: string, error?: boolean) => void;
}) {
  const [rows, setRows] = useState<OrderContactRow[]>(initial);
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const active = rows.filter((r) => !r.removedAt);
  const removed = rows.filter((r) => r.removedAt);

  const run = async (payload: Record<string, unknown>, done: string) => {
    setBusy(true);
    try {
      const data = await post(payload);
      if (data.contacts) setRows(data.contacts);
      onToast(done);
      setValue(""); setAdding(false);
    } catch (e) {
      onToast(e instanceof Error ? e.message : "Не получилось", true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.box}>
      <div className={styles.boxHead}>
        Контакты заказа
        <em style={{ color: "var(--o-muted)" }}>{active.length ? `ещё ${active.length}` : "только владелец"}</em>
      </div>
      {active.length === 0 && (
        <div className={styles.refNote} style={{ marginBottom: 0 }}>
          Уведомления получает только владелец. Если покупатель пишет с другого аккаунта и назовёт код, ник или пасс, бот предложит добавить этот аккаунт.
        </div>
      )}
      {active.map((r) => {
        const w = who(r.user);
        return (
          <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderTop: "1px solid var(--o-line)" }}>
            <span style={{ minWidth: 26, fontSize: 12, fontWeight: 800, color: "var(--o-muted)" }}>{w.channel}</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 650, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{w.label}</div>
              <div style={{ color: "var(--o-muted)", fontSize: 12.5 }}>
                {VIA_WORD[r.via] ?? r.via}{r.evidence && r.via !== "support_code" && r.via !== "bot_code" ? ` (${r.evidence})` : ""} · {fmt(r.createdAt)}
              </div>
            </span>
            {writeHref(r.user) && (
              <a className={styles.btn} href={writeHref(r.user)!} target="_blank" rel="noreferrer">Написать</a>
            )}
            <button type="button" className={styles.btn} disabled={busy}
              onClick={() => run({ action: "remove-contact", contactId: r.id }, "Контакт убран")}>Убрать</button>
          </div>
        );
      })}
      {removed.length > 0 && (
        <div style={{ color: "var(--o-muted)", fontSize: 12.5, marginTop: 6 }}>
          Убраны: {removed.map((r) => `${who(r.user).label} (${r.removedBy === "owner" ? "владельцем" : r.removedBy === "self" ? "сам" : r.removedBy?.startsWith("admin:") ? r.removedBy.slice(6) : "—"})`).join(", ")}
        </div>
      )}
      {adding ? (
        <form className={styles.keyForm} style={{ display: "flex", gap: 8, marginTop: 10 }}
          onSubmit={(e) => { e.preventDefault(); if (value.trim()) void run({ action: "add-contact", who: value.trim() }, "Контакт добавлен"); }}>
          <input id="order-contact-add" autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder="@ник, tg:123456 или vk:123456" />
          <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={busy || !value.trim()}>Добавить</button>
          <button type="button" className={styles.btn} onClick={() => { setAdding(false); setValue(""); }}>Отмена</button>
        </form>
      ) : (
        <button type="button" className={styles.btn} style={{ marginTop: 10 }} onClick={() => setAdding(true)}>+ Добавить аккаунт</button>
      )}
    </div>
  );
}
