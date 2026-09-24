"use client";

/* ─────────────────────────────────────────────────────────────────────────────
   Новый заказ по коду ВБ — минимальный путь, который закрывает ежедневный
   случай: код у покупателя на руках, заказа в базе нет (активация не дошла).

   Номинал берётся из самого кода, поэтому руками его вводить не надо. Прямой
   заказ здесь не заводится намеренно: ему нужен поиск пассов по нику и выбор
   клиента — этот лист живёт в TWA, и дублировать его вслепую хуже, чем честно
   отправить туда.
   ───────────────────────────────────────────────────────────────────────── */

import { useState } from "react";
import styles from "./orders.module.css";

export default function NewOrderDialog({
  onClose, onCreated, onToast,
}: {
  onClose: () => void;
  onCreated: (wbCode: string) => void;
  onToast: (text: string, error?: boolean) => void;
}) {
  const [wbCode, setWbCode] = useState("");
  const [wbOrderId, setWbOrderId] = useState("");
  const [nick, setNick] = useState("");
  const [gamepass, setGamepass] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);

  const code = wbCode.trim().toUpperCase();
  const canSubmit = /^[A-Z0-9]{7}$/.test(code) || /^\d{5,}$/.test(wbOrderId.trim());

  async function submit(force = false) {
    setSaving(true);
    setConflict(null);
    try {
      const res = await fetch("/api/admin/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create-manual",
          wbCode: code || undefined,
          wbOrderId: wbOrderId.trim() || undefined,
          robloxUsername: nick.trim() || undefined,
          gamepassUrl: gamepass.trim() || undefined,
          note: note.trim() || undefined,
          force,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // 409 — заказ на этот пасс уже есть: даём осознанный выход, а не тупик.
        if (res.status === 409 && data?.existing?.wbCode) setConflict(data.error);
        else onToast(data?.error ?? `Сервер ответил ${res.status}`, true);
        return;
      }
      onToast(`Заказ ${data?.order?.wbCode ?? code} создан`);
      onCreated(data?.order?.wbCode ?? code);
    } catch (error) {
      onToast((error as Error).message, true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.paletteBackdrop} onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <div className={styles.ask} role="dialog" aria-modal="true" aria-label="Новый заказ">
        <h3>Новый заказ по коду ВБ</h3>
        <p>Номинал подставится из кода. Заморозку код тоже проверит — по замороженному заказ не создастся.</p>

        <div style={{ display: "grid", gap: 10 }}>
          <label style={{ display: "grid", gap: 5 }}>
            <span className={styles.kvKey}>Код ВБ</span>
            <input
              autoFocus
              value={wbCode}
              onChange={event => setWbCode(event.target.value.toUpperCase())}
              placeholder="7 символов, например ZZF7T5B"
              maxLength={7}
              style={{ fontFamily: "ui-monospace, Menlo, monospace", letterSpacing: ".08em" }}
            />
          </label>
          <label style={{ display: "grid", gap: 5 }}>
            <span className={styles.kvKey}>или номер заказа WB</span>
            <input value={wbOrderId} onChange={event => setWbOrderId(event.target.value.replace(/\D/g, ""))} placeholder="5638591741" />
          </label>
          <label style={{ display: "grid", gap: 5 }}>
            <span className={styles.kvKey}>Ник Roblox — необязательно</span>
            <input value={nick} onChange={event => setNick(event.target.value)} placeholder="Anastasia_M" />
          </label>
          <label style={{ display: "grid", gap: 5 }}>
            <span className={styles.kvKey}>Ссылка на геймпасс или ID — необязательно</span>
            <input value={gamepass} onChange={event => setGamepass(event.target.value)} placeholder="roblox.com/game-pass/1907029789" />
          </label>
          <label style={{ display: "grid", gap: 5 }}>
            <span className={styles.kvKey}>Заметка</span>
            <input value={note} onChange={event => setNote(event.target.value)} placeholder="Почему заводим руками" />
          </label>
        </div>

        {conflict && (
          <p style={{ marginTop: 12, color: "#ffc0ba" }}>
            {conflict}
            <button type="button" className={styles.btn} style={{ marginLeft: 10 }} onClick={() => void submit(true)} disabled={saving}>
              Всё равно создать
            </button>
          </p>
        )}

        <p className={styles.hint} style={{ marginTop: 12 }}>
          Прямой заказ (без кода ВБ) заводится в TWA — там поиск пассов по нику и выбор клиента.
        </p>

        <div className={styles.askActions}>
          <button type="button" className={styles.btn} onClick={onClose}>Отмена</button>
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => void submit(false)} disabled={!canSubmit || saving}>
            {saving ? "Создаём…" : "Создать заказ"}
          </button>
        </div>
      </div>
    </div>
  );
}
