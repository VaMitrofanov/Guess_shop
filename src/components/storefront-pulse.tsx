"use client";

import { useEffect, useState } from "react";
import { Gift, KeyRound, Gamepad2, Star } from "lucide-react";
import type { StorefrontPulse } from "@/lib/storefront-pulse";
import styles from "@/app/storefront2.module.css";

/**
 * Живые блоки главной (витрина 2.0): лента «Выдано сегодня» / честный счётчик,
 * строка доверия под первым экраном и лента отзывов WB. Один запрос на всю
 * страницу (`/api/storefront/pulse`), данные — только настоящие.
 */

let pulsePromise: Promise<StorefrontPulse | null> | null = null;

function loadPulse(): Promise<StorefrontPulse | null> {
  if (!pulsePromise) {
    pulsePromise = fetch("/api/storefront/pulse")
      .then((response) => (response.ok ? response.json() as Promise<StorefrontPulse> : null))
      .catch(() => null);
  }
  return pulsePromise;
}

function usePulse(): StorefrontPulse | null | undefined {
  const [pulse, setPulse] = useState<StorefrontPulse | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    void loadPulse().then((value) => { if (alive) setPulse(value); });
    return () => { alive = false; };
  }, []);
  return pulse;
}

function plural(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

function ago(iso: string, now: number): string {
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return "только что";
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.floor(minutes / 60);
  return `${hours} ${plural(hours, ["час", "часа", "часов"])} назад`;
}

/** «Больше 380» — округляем ВНИЗ до десятков: цифра не врёт ни в одну сторону. */
export function floorTens(n: number): number {
  return n >= 20 ? Math.floor(n / 10) * 10 : n;
}

const VIA: Record<StorefrontPulse["feed"][number]["via"], string> = {
  email: "на почту",
  account: "в кабинет",
  chat: "в чат бота",
  gift: "в подарок",
  roblox: "на аккаунт",
};

export function HeroPulse() {
  const pulse = usePulse();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  if (pulse === undefined) {
    return <div className={styles.pulseCard} aria-busy="true"><div className={styles.pulseSkeleton} /></div>;
  }
  if (!pulse) return null;

  if (!pulse.showFeed) {
    return (
      <div className={styles.pulseCard}>
        <div className={styles.pulseHead}>
          <span className={styles.pulseLive}><i /> ПРОШЛО ЧЕРЕЗ ROBLOXBANK</span>
          <small>все способы, включая Wildberries</small>
        </div>
        <p className={styles.pulseBig}>{(pulse.totals.gross ?? pulse.totals.robux).toLocaleString("ru-RU")} <span>Robux</span></p>
        <p className={styles.pulseSub}>
          {pulse.totals.orders.toLocaleString("ru-RU")} {plural(pulse.totals.orders, ["выдача", "выдачи", "выдач"])} · сумма выкупленных геймпассов и кодов
        </p>
      </div>
    );
  }

  return (
    <div className={styles.pulseCard}>
      <div className={styles.pulseHead}>
        <span className={styles.pulseLive}><i /> ВЫДАНО СЕГОДНЯ</span>
        <small>на сайте · {pulse.todayCount}</small>
      </div>
      <ul className={styles.pulseList}>
        {pulse.feed.slice(0, 4).map((item, index) => (
          <li key={`${item.at}-${index}`}>
            <span className={styles.pulseIcon} data-kind={item.kind}>
              {item.kind === "gift" ? <Gift size={16} /> : item.kind === "gamepass" ? <Gamepad2 size={16} /> : <KeyRound size={16} />}
            </span>
            <span className={styles.pulseText}>
              <b>{item.denomination.toLocaleString("ru-RU")} R$</b>
              <small>{item.kind === "gamepass" ? "геймпасс" : "код"} · {VIA[item.via]} · {ago(item.at, now)}</small>
            </span>
            <span className={styles.pulseTag}>{item.kind === "gift" ? "подарок" : item.kind === "gamepass" ? "выкуплен" : "код выдан"}</span>
          </li>
        ))}
      </ul>
      <p className={styles.pulseFoot}>Настоящие выдачи на сайте. Имена и почты не показываем.</p>
    </div>
  );
}

export function HeroProof() {
  const pulse = usePulse();
  const reviews = pulse ? floorTens(pulse.reviewsTotal) : 0;
  return (
    <div className={styles.proof}>
      <span className={styles.wbBadge} aria-hidden="true">WB</span>
      <span>
        <b>{reviews >= 20 ? `Больше ${reviews.toLocaleString("ru-RU")} отзывов на Wildberries` : "Отзывы покупателей на Wildberries"}</b>
        <small>{pulse ? `${pulse.totals.orders.toLocaleString("ru-RU")} ${plural(pulse.totals.orders, ["выдача", "выдачи", "выдач"])} за всё время, включая Wildberries` : " "}</small>
      </span>
    </div>
  );
}

export function WbReviewsLink({ className }: { className?: string }) {
  const pulse = usePulse();
  if (!pulse?.wbReviewsUrl) return null;
  return <a className={className} href={pulse.wbReviewsUrl} target="_blank" rel="noopener noreferrer">Все отзывы на WB →</a>;
}

export function ReviewsMarquee() {
  const pulse = usePulse();
  const reviews = pulse?.reviews ?? [];
  if (pulse === undefined) return <div className={styles.reviewsSkeleton} aria-busy="true" />;
  if (reviews.length < 3) {
    return (
      <p className={styles.reviewsEmpty}>
        Отзывы покупателей — на <a href={pulse?.wbReviewsUrl ?? "/reviews"} target="_blank" rel="noopener noreferrer">{pulse?.wbReviewsUrl ? "Wildberries" : "странице отзывов"}</a>.
      </p>
    );
  }
  // Лента дублируется, чтобы ехать без шва; второй экземпляр скрыт от чтения с экрана.
  return (
    <div className={styles.marqueeViewport}>
      <div className={styles.marquee}>
        {[0, 1].map((copy) => (
          <ul key={copy} className={styles.marqueeTrack} aria-hidden={copy === 1 ? true : undefined}>
            {reviews.map((review) => (
              <li key={`${copy}-${review.id}`} className={styles.reviewCard}>
                <span className={styles.reviewStars} aria-label="5 звёзд из 5">
                  {Array.from({ length: 5 }).map((_, index) => <Star key={index} size={15} fill="currentColor" strokeWidth={0} />)}
                </span>
                <p>{review.text}</p>
                <small>{review.name} · 5★ на Wildberries</small>
              </li>
            ))}
          </ul>
        ))}
      </div>
    </div>
  );
}
