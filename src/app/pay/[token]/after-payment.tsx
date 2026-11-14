"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Check, CheckCircle2, CircleAlert, Clock3, Copy, Gift, Loader2, RotateCcw, Share2, Star } from "lucide-react";
import type { PublicCodeOrder } from "@/lib/codes/orders";
import type { PayViewerExtras } from "./pay-client";
import styles from "./after-payment.module.css";

/**
 * Экран после оплаты (витрина 2.0, п. 9 плана): код с «Скопировать» и
 * «Активировать» (только создателю, вошедшему в аккаунт), приглашение друга
 * в момент радости, оценка «Всё прошло нормально?» и мягкое «подари другу».
 *
 * По общей ссылке (её мог открыть родитель) кода не видно — как и раньше:
 * он уходит туда, куда указал создатель заказа.
 */

const REDEEM = "https://www.roblox.com/redeem";

function friends(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "друга";
  return "друзей";
}

function when(iso: string): string {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

export default function AfterPayment(props: {
  token: string;
  view: PublicCodeOrder;
  extras: PayViewerExtras;
  busy: boolean;
  info: string;
  error: string;
  onResend: () => void;
}) {
  const { view, extras } = props;
  const issued = view.status === "ISSUED";
  const amount = view.denomination.toLocaleString("ru-RU");
  const [code, setCode] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [stars, setStars] = useState<number | null>(view.rating);
  const [rateError, setRateError] = useState("");

  const reveal = async () => {
    setRevealing(true);
    try {
      const response = await fetch("/api/codes/reveal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId: view.publicId }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.code) setCode(data.code);
    } finally {
      setRevealing(false);
    }
  };

  const copy = async (value: string, done: (v: boolean) => void) => {
    try {
      await navigator.clipboard.writeText(value);
      done(true);
      window.setTimeout(() => done(false), 2500);
    } catch {
      window.prompt("Скопируйте", value);
    }
  };

  const shareInvite = async () => {
    if (!extras.referralLink) return;
    const text = "Robux кодом — сразу на баланс, без геймпассов. Держи ссылку:";
    if (navigator.share) {
      try {
        await navigator.share({ title: "RobloxBank", text, url: extras.referralLink });
        return;
      } catch (error) {
        if ((error as Error)?.name === "AbortError") return;
      }
    }
    await copy(extras.referralLink, setLinkCopied);
  };

  const rate = async (value: number) => {
    setStars(value);
    setRateError("");
    const response = await fetch("/api/codes/rate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: props.token, stars: value }),
    }).catch(() => null);
    if (!response?.ok) setRateError("Не получилось сохранить оценку — попробуйте ещё раз.");
  };

  const where = view.gift
    ? `Открытка уйдёт на ${view.maskedRecipient}${view.gift.sendAt && !view.gift.sent ? ` ${when(view.gift.sendAt)}` : ""}`
    : view.deliveryMode === "EMAIL"
      ? `Код на почте ${view.maskedRecipient}`
      : view.channel !== "SITE"
        ? `Код в чате бота ${view.channel === "TG" ? "Telegram" : "ВКонтакте"} и в кабинете`
        : "Код в личном кабинете";

  const next = extras.next;
  const progress = next ? Math.max(4, Math.min(100, Math.round((extras.invitedCount / next.invited) * 100))) : 100;

  return (
    <div className={styles.wrap}>
      <header className={styles.head}>
        <span className={issued ? styles.iconOk : styles.iconWait}>{issued ? <CheckCircle2 size={26} /> : <Clock3 size={26} />}</span>
        <div>
          <span className={styles.paid}>ОПЛАЧЕНО · {view.publicId}</span>
          <h1>
            {view.gift
              ? issued ? `Подарок на ${amount} Robux готов` : `Готовим подарок на ${amount} Robux`
              : issued ? `Код на ${amount} Robux у вас` : `Готовим код на ${amount} Robux`}
          </h1>
        </div>
      </header>

      <section className={styles.codeCard} aria-label="Код активации">
        {issued && !view.gift && extras.isCreator ? (
          code ? (
            <>
              <span className={styles.codeLabel}>Код активации · заказ {view.publicId}</span>
              <div className={styles.code}>{code}</div>
              <div className={styles.codeActions}>
                <button type="button" className={styles.copy} onClick={() => copy(code, setCopied)}>
                  {copied ? <><Check size={18} /> Скопировано</> : <><Copy size={18} /> Скопировать</>}
                </button>
                <a className={styles.activate} href={REDEEM} target="_blank" rel="noopener noreferrer">Активировать <ArrowUpRight size={18} /></a>
              </div>
            </>
          ) : (
            <>
              <span className={styles.codeLabel}>Код активации · заказ {view.publicId}</span>
              <button type="button" className={styles.revealButton} onClick={reveal} disabled={revealing}>
                {revealing ? <Loader2 size={18} className={styles.spin} /> : null} Показать код
              </button>
            </>
          )
        ) : (
          <>
            <span className={styles.codeLabel}>{where}</span>
            <p className={styles.codeText}>
              {!issued
                ? "Оплата получена — готовим код. Пришлём, как только он будет готов. Ничего делать не нужно."
                : view.gift
                  ? "Код в письме не виден: получатель откроет подарок по кнопке «Открыть подарок»."
                  : "Robux придут сразу после ввода кода на roblox.com/redeem."}
            </p>
            {issued && !view.gift && (
              <div className={styles.codeActions}>
                <a className={styles.activate} href={REDEEM} target="_blank" rel="noopener noreferrer">Активировать <ArrowUpRight size={18} /></a>
                {(view.deliveryMode === "EMAIL" || view.emailSent) && (
                  <button type="button" className={styles.copy} onClick={props.onResend} disabled={props.busy}>
                    {props.busy ? <Loader2 size={18} className={styles.spin} /> : <RotateCcw size={18} />} Письмо снова
                  </button>
                )}
              </div>
            )}
            {issued && view.gift && view.gift.sent && (
              <div className={styles.codeActions}>
                <button type="button" className={styles.copy} onClick={props.onResend} disabled={props.busy}>
                  {props.busy ? <Loader2 size={18} className={styles.spin} /> : <RotateCcw size={18} />} Отправить открытку ещё раз
                </button>
              </div>
            )}
          </>
        )}
        {issued && !view.gift && extras.isCreator && <span className={styles.codeHint}>Код также {view.deliveryMode === "EMAIL" ? "на почте" : "в кабинете"}. Robux придут сразу после ввода на roblox.com/redeem.</span>}
      </section>
      {props.info && <p className={styles.ok} role="status"><CheckCircle2 size={16} /> {props.info}</p>}
      {props.error && <p className={styles.error} role="alert"><CircleAlert size={16} /> {props.error}</p>}

      {/* Приглашение в момент радости */}
      <section className={styles.invite} aria-labelledby="invite-title">
        {extras.isCreator ? (
          <>
            <h2 id="invite-title">{next ? `Позови ${next.remaining} ${friends(next.remaining)} — скидка станет ${next.percent}%` : "У вас максимальная скидка — 5%"}</h2>
            <p>Друг регистрируется по ссылке и покупает код — он засчитан. Скидка остаётся навсегда.</p>
            <div className={styles.bar} aria-hidden="true"><i style={{ width: `${progress}%` }} /></div>
            <span className={styles.barNote}>Сейчас: {extras.discountPercent}% · засчитано {extras.invitedCount}{next ? ` из ${next.invited}` : ""}</span>
            {extras.referralLink && (
              <button type="button" className={styles.inviteButton} onClick={shareInvite}>
                {linkCopied ? <><Check size={18} /> Ссылка скопирована</> : <><Share2 size={18} /> Отправить ссылку другу</>}
              </button>
            )}
          </>
        ) : (
          <>
            <h2 id="invite-title">Следующий код — дешевле</h2>
            <p>С аккаунтом и подпиской на канал — скидка 1%, и до 5% — за друзей, которые купят код по вашей ссылке.</p>
            <Link className={styles.inviteButton} href="/register?next=%2Fdashboard%23referral">Получить скидку</Link>
          </>
        )}
      </section>

      {issued && (
        <section className={styles.rate} aria-labelledby="rate-title">
          <h2 id="rate-title">Всё прошло нормально?</h2>
          <div className={styles.stars} role="radiogroup" aria-label="Оценка">
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={stars === value}
                aria-label={`${value} из 5`}
                className={stars !== null && value <= stars ? styles.starOn : undefined}
                onClick={() => rate(value)}
              >
                <Star size={22} fill={stars !== null && value <= stars ? "currentColor" : "none"} />
              </button>
            ))}
          </div>
          {rateError ? <span className={styles.rateNote}>{rateError}</span>
            : stars === null ? <span className={styles.rateNote}>Оценка помогает нам стать лучше — займёт 5 секунд.</span>
            : stars >= 4 ? <span className={styles.rateNote}>Спасибо! Рады, что всё получилось 💜</span>
            : <span className={styles.rateNote}>Жаль. Напишите нам в <a href="https://t.me/RobloxBank_PA" target="_blank" rel="noopener noreferrer">Telegram</a> — разберёмся.</span>}
        </section>
      )}

      <Link className={styles.giftLink} href="/#gift"><Gift size={17} /> Подари другу код открыткой →</Link>
    </div>
  );
}
