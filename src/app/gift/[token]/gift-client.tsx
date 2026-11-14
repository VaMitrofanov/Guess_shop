"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Check, Copy, Gift, Loader2 } from "lucide-react";
import type { GiftTheme } from "@/lib/codes/gift";
import GiftArt from "@/components/gift-art";
import styles from "./gift.module.css";

const STEPS = [
  "Откройте roblox.com/redeem — кнопка ниже.",
  "Войдите в свой аккаунт Roblox.",
  "Вставьте код и нажмите «Активировать» (Redeem).",
];

export default function GiftClient(props: {
  token: string;
  ready: boolean;
  theme: GiftTheme;
  greeting: string;
  tagline: string;
  denomination: number;
  message: string | null;
  from: string | null;
}) {
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const open = async () => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/codes/gift", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: props.token }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.code) setCode(data.code);
      else setError(data.error ?? "Не получилось открыть подарок. Попробуйте ещё раз.");
    } catch {
      setError("Нет связи. Проверьте интернет и попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt("Скопируйте код", code);
    }
  };

  return (
    <article className={`${styles.card} ${styles[`theme${props.theme}`]}`} aria-labelledby="gift-title">
      <header className={styles.cover}>
        <GiftArt theme={props.theme} className={styles.art} />
        <p className={styles.greeting}>{props.greeting}</p>
        <h1 id="gift-title" className={styles.amount}>{props.denomination.toLocaleString("ru-RU")}</h1>
        <p className={styles.tagline}>{props.tagline}</p>
      </header>
      <div className={styles.body}>
        {props.message ? (
          <blockquote className={styles.note}>
            «{props.message}»
            {props.from && <cite>— {props.from}</cite>}
          </blockquote>
        ) : props.from ? <p className={styles.fromLine}>От: <b>{props.from}</b></p> : null}

        {code ? (
          <section className={styles.reveal} aria-live="polite">
            <p className={styles.label}>Ваш код активации</p>
            <div className={styles.code}>{code}</div>
            <div className={styles.actions}>
              <button type="button" className={styles.primary} onClick={copy}>
                {copied ? <><Check size={18} /> Скопировано</> : <><Copy size={18} /> Скопировать</>}
              </button>
              <a className={styles.secondary} href="https://www.roblox.com/redeem" target="_blank" rel="noopener noreferrer">
                Активировать <ArrowUpRight size={18} />
              </a>
            </div>
            <ol className={styles.steps}>{STEPS.map((step) => <li key={step}>{step}</li>)}</ol>
            <p className={styles.small}>Robux появятся на балансе сразу после ввода. Пароль от Roblox никому сообщать не нужно — и нам тоже.</p>
          </section>
        ) : props.ready ? (
          <button type="button" className={`${styles.primary} ${styles.openButton}`} onClick={open} disabled={busy}>
            {busy ? <Loader2 size={20} className={styles.spin} /> : <Gift size={20} />} Открыть подарок
          </button>
        ) : (
          <p className={styles.wait}>Подарок ещё готовится — загляните чуть позже, ссылка та же.</p>
        )}
        {error && <p className={styles.error} role="alert">{error}</p>}
        <p className={styles.foot}>Подарок оформлен в <Link href="/">RobloxBank</Link> · вопросы — <a href="https://t.me/RobloxBank_PA" target="_blank" rel="noopener noreferrer">@RobloxBank_PA</a></p>
      </div>
    </article>
  );
}
