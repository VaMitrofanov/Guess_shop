"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Check, Copy, Heart, Loader2, Mail } from "lucide-react";
import type { GiftTheme } from "@/lib/codes/gift";
import styles from "./gift.module.css";

/* 🎁 Открытка-подарок, «вариант В» (19.11.2026).

   Владелец: «хочется больше праздника, а свои услуги — нативно, невзначай».
   Поэтому страница — письмо, а не витрина: конверт с сургучной печатью «R$»
   (бренд = печать и штемпель), после открытия — открытка с почтовой маркой
   RobloxBank. Продажа — одна рукописная строка P.S. внизу открытки.
   «Спасибо» дарителю спрятано в сердечко в углу пожелания: одно касание,
   никаких форм — дарителю уходит короткое письмо (`/api/codes/gift/thanks`). */

const FLAGS = ["#e83f86", "#ffd166", "#45d6aa", "#7556e8"];

/** Почтовый штемпель «ROBLOXBANK ★» — рисунок, не текст страницы. */
function Postmark() {
  return (
    <svg className={styles.postmark} viewBox="0 0 70 70" aria-hidden="true">
      <circle cx="35" cy="35" r="33" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="35" cy="35" r="25" fill="none" stroke="currentColor" strokeWidth="1" />
      <text x="35" y="34" textAnchor="middle" fill="currentColor" fontSize="7" fontWeight="900" textLength="42" lengthAdjust="spacingAndGlyphs">ROBLOXBANK</text>
      <text x="35" y="46" textAnchor="middle" fill="currentColor" fontSize="9">★</text>
    </svg>
  );
}

export default function GiftClient(props: {
  token: string;
  ready: boolean;
  theme: GiftTheme;
  greeting: string;
  tagline: string;
  denomination: number;
  message: string | null;
  from: string | null;
  to: string | null;
  canThank: boolean;
  thanked: boolean;
}) {
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /** Номер скопированного кода (1, 2…), 0 — ничего. */
  const [copied, setCopied] = useState(0);
  const [thanked, setThanked] = useState(props.thanked);
  const [thanking, setThanking] = useState(false);

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

  const copy = async (value: string, index: number) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(index);
      window.setTimeout(() => setCopied(0), 2500);
    } catch {
      window.prompt("Скопируйте код", value);
    }
  };

  const thank = async () => {
    if (thanked || thanking) return;
    setThanking(true);
    try {
      const response = await fetch("/api/codes/gift/thanks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: props.token }),
      });
      if (response.ok) setThanked(true);
    } catch {
      /* сердечко — не повод показывать ошибку */
    } finally {
      setThanking(false);
    }
  };

  const giver = props.from ?? "Даритель";
  const heart = props.canThank && (props.message || props.from) ? (
    <button
      type="button"
      className={`${styles.heart} ${thanked ? styles.heartOn : ""}`}
      onClick={thank}
      disabled={thanked || thanking}
      aria-label={thanked ? `${giver} узнает, что подарок понравился` : `Сказать спасибо: ${giver}`}
      aria-pressed={thanked}
      title={thanked ? "Спасибо отправлено" : "Сказать спасибо"}
    >
      <Heart size={24} fill={thanked ? "currentColor" : "none"} />
    </button>
  ) : null;

  return (
    <main className={`${styles.scene} ${styles[`theme${props.theme}`]}`}>
      <div className={styles.garland} aria-hidden="true">
        {Array.from({ length: 14 }, (_, index) => (
          <span key={index} style={{ borderTopColor: FLAGS[index % FLAGS.length] }} />
        ))}
      </div>
      <span className={`${styles.bit} ${styles.bit1}`} aria-hidden="true" />
      <span className={`${styles.bit} ${styles.bit2}`} aria-hidden="true" />
      <span className={`${styles.bit} ${styles.bit3}`} aria-hidden="true" />
      <span className={`${styles.bit} ${styles.bit4}`} aria-hidden="true" />
      <div className={styles.balloons} aria-hidden="true"><i /><i /><i /></div>
      {code && (
        <div className={styles.openedEnvelope} aria-hidden="true">
          <Postmark />
          <span className={styles.sealSmall}>R$</span>
        </div>
      )}

      <div className={styles.column}>
        {!code ? (
          <section className={styles.closed} aria-labelledby="gift-title">
            <h1 id="gift-title" className={styles.hand}>{props.to ? `${props.to}, тебе письмо!` : "Тебе письмо!"}</h1>
            {props.from && <p className={styles.fromLine}>От кого: {props.from}</p>}
            <div className={styles.envelope} aria-hidden="true">
              <span className={styles.flap} />
              <span className={styles.pocketL} />
              <span className={styles.pocketR} />
              <Postmark />
              <span className={styles.seal}>R$</span>
            </div>
            {props.ready ? (
              <button type="button" className={styles.primary} onClick={open} disabled={busy}>
                {busy ? <Loader2 size={20} className={styles.spin} /> : <Mail size={20} />} Открыть письмо
              </button>
            ) : (
              <p className={styles.wait}>Письмо ещё в пути — загляните чуть позже, ссылка та же.</p>
            )}
            {error && <p className={styles.error} role="alert">{error}</p>}
            <p className={styles.soft}>Внутри — подарок на Roblox. Пароль от аккаунта не понадобится.</p>
          </section>
        ) : (
          <section className={styles.opened} aria-labelledby="gift-title" aria-live="polite">
            <h1 id="gift-title" className={styles.hand}>{props.to ? `${props.to}, это тебе!` : "Это тебе!"}</h1>
            <article className={styles.card}>
              {/* Марка — бренд, но как часть открытки. */}
              <Link href="/" className={styles.stamp} aria-label="RobloxBank — на главную">
                <svg viewBox="0 0 54 70" aria-hidden="true">
                  <rect width="54" height="70" fill="#7556e8" />
                  <text x="27" y="38" textAnchor="middle" fill="#fff" fontSize="18" fontWeight="900">R$</text>
                  <text x="27" y="54" textAnchor="middle" fill="#fff" fontSize="6.4" fontWeight="900" letterSpacing=".4">ROBLOXBANK</text>
                </svg>
              </Link>
              <header className={styles.cover}>
                <p className={styles.greeting}>{props.greeting}</p>
                <p className={styles.amount}>{props.denomination.toLocaleString("ru-RU")}<span> Robux</span></p>
              </header>
              <div className={styles.body}>
                {(props.message || props.from) && (
                  <div className={styles.note}>
                    {props.message && <p className={styles.noteText}>{props.message}</p>}
                    {props.from && <p className={styles.noteFrom}>— {props.from}</p>}
                    {heart}
                  </div>
                )}
                <p className={styles.label}>{code.includes("\n") ? "Ваши коды — введите каждый по очереди" : "Ваш код активации"}</p>
                {code.split("\n").map((one) => <div key={one} className={styles.code}>{one}</div>)}
                <div className={styles.actions}>
                  {/* Набор (2 000 = 2 × 1 000, 20.11.2026): кнопка на каждый код. */}
                  {code.split("\n").map((one, index, all) => (
                    <button key={one} type="button" className={styles.primary} onClick={() => copy(one, index + 1)}>
                      {copied === index + 1 ? <><Check size={18} /> Скопировано</> : <><Copy size={18} /> {all.length > 1 ? `Скопировать код ${index + 1}` : "Скопировать"}</>}
                    </button>
                  ))}
                  <a className={styles.secondary} href="https://www.roblox.com/redeem" target="_blank" rel="noopener noreferrer">
                    Активировать <ArrowUpRight size={18} />
                  </a>
                </div>
                <p className={styles.small}>Войдите в свой аккаунт Roblox, вставьте код и нажмите «Redeem» — Robux сразу на балансе. Пароль никому сообщать не нужно.</p>
                <p className={styles.ps}>P.S. Захочешь так же порадовать друга — <Link href="/#gift">открытки живут тут</Link></p>
              </div>
            </article>
            {thanked && heart && <p className={styles.thanked}><Heart size={16} fill="currentColor" /> {giver} узнает, что тебе понравилось</p>}
          </section>
        )}
        <p className={styles.foot}>Вопросы по коду — <a href="https://t.me/RobloxBank_PA" target="_blank" rel="noopener noreferrer">@RobloxBank_PA</a></p>
      </div>
    </main>
  );
}
