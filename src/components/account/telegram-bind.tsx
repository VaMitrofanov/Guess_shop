"use client";

import { useState } from "react";
import { Loader2, Send } from "lucide-react";
import css from "./telegram-bind.module.css";

/**
 * 🔗 «Получать статус в Telegram» (Э1, 18.11.2026). Один тап: сайт выпускает
 * одноразовую ссылку `t.me/RobloxBankBot?start=ln_…`, бот сам привязывает
 * Telegram к этому профилю и показывает заказы. Telegram — главный канал,
 * поэтому кнопка одна и она про Telegram.
 */
export function TelegramBindCard({ title, text }: { title?: string; text?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const open = async () => {
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/account/bot-bind", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) throw new Error(data.error ?? "Не получилось подготовить ссылку");
      window.location.href = data.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не получилось подготовить ссылку");
      setBusy(false);
    }
  };
  return (
    <section className={`${css.card} ${css.tgCard}`} aria-labelledby="tg-bind-title">
      <div className={css.sky} aria-hidden="true">
        <span className={css.trail} />
        <span className={css.plane}>
          <svg width="32" height="32" viewBox="0 0 24 24"><path d="M21 4.5L2.8 11.4c-.9.35-.9 1.1 0 1.4l4.6 1.5 1.8 5.4c.2.6.9.8 1.4.4l2.6-2.2 4.7 3.5c.6.4 1.4.1 1.6-.6L22.4 5.9c.2-1-.5-1.7-1.4-1.4z" fill="currentColor" /></svg>
        </span>
        <span className={css.bot}>RB</span>
      </div>
      <h2 id="tg-bind-title" className={css.title}>{title ?? "Получать статус в Telegram"}</h2>
      <p className={css.text}>{text ?? "Одно нажатие — и бот уже знает ваши заказы: напишет, когда всё будет готово. Ничего вводить не нужно."}</p>
      <button type="button" className={css.primary} onClick={() => void open()} disabled={busy}>
        {busy ? <Loader2 size={18} className="animate-spin" aria-hidden="true" /> : <Send size={18} aria-hidden="true" />}
        Открыть Telegram
      </button>
      {error && <p className={css.error} role="alert">{error}</p>}
    </section>
  );
}

/** ✉️ Почта для чеков и копии кода — просим тех, у кого её нет. */
export function ContactEmailCard({ initial }: { initial?: string | null }) {
  const [email, setEmail] = useState(initial ?? "");
  const [state, setState] = useState<"idle" | "busy" | "ok" | "error">("idle");
  const [error, setError] = useState("");
  const save = async () => {
    setState("busy"); setError("");
    try {
      const res = await fetch("/api/account/contact-email", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Не сохранилось");
      setState("ok");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не сохранилось");
      setState("error");
    }
  };
  return (
    <section className={css.card} aria-labelledby="contact-email-title">
      <label id="contact-email-title" htmlFor="contact-email" className={css.title}>Почта для чека</label>
      <p className={css.note}>Пришлём туда чек и копию кода — на случай, если потеряете доступ к мессенджеру. Для входа она не нужна.</p>
      <div className={css.row}>
        <input id="contact-email" type="email" inputMode="email" autoComplete="email" placeholder="name@mail.ru" className={css.input}
          value={email} onChange={(e) => { setEmail(e.target.value); setState("idle"); }} />
        <button type="button" className={css.save} onClick={() => void save()} disabled={state === "busy" || !email.trim()}>Сохранить</button>
      </div>
      {state === "ok" && <p className={css.ok} role="status">Сохранили.</p>}
      {state === "error" && <p className={css.error} role="alert">{error}</p>}
    </section>
  );
}
