import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Gamepad2, Gift, Headphones, KeyRound, LockKeyhole, Mail, WalletCards } from "lucide-react";
import Navbar from "@/components/navbar";
import Footer from "@/components/footer";
import Calculator from "@/components/calculator";
import CodesStore from "@/components/codes-store";
import CodesInfo from "@/components/codes-info";
import GiftArt from "@/components/gift-art";
import { HeroProof, HeroPulse, ReviewsMarquee, WbReviewsLink } from "@/components/storefront-pulse";
import { CODE_DISCOUNT_TIERS, CODE_PRICES } from "@/lib/codes-pricing";
import { codesInstantDelivery } from "@/lib/codes/fulfillment";
import { Garland, NewYearScene, Snowfall } from "@/components/new-year";
import { isNewYearSeason } from "@/lib/new-year";
import styles from "./storefront2.module.css";

// D11: canonical объявляется на самой странице, а не в корневом layout —
// метаданные layout наследуются всеми маршрутами, и «/» в корне заставил бы
// /login и /checkout выдавать себя за главную. Значение берётся от
// metadataBase, то есть от канонического хоста (apex).
export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

// Тексты первого экрана зависят от серверного режима выдачи кодов
// (`CODES_BACKORDER`, рестарт без пересборки): страница рендерится на запрос,
// иначе «код за минуту» вшился бы в статику на момент сборки.
export const dynamic = "force-dynamic";

const minCodePrice = Math.min(...Object.values(CODE_PRICES));

/**
 * 🏠 Главная — витрина 2.0 (макет утверждён владельцем 14.11.2026,
 * docs/storefront-2-plan.md). Главная мысль: маркетинг в сторону кодов.
 * Код — первым и крупно; геймпасс — вторым: «дешевле, но с ожиданием».
 * Сроков ожидания не называем нигде (правило 26.10.2026).
 */
export default async function Home({ searchParams }: { searchParams: Promise<{ ny?: string }> }) {
  const instant = codesInstantDelivery();
  // 🎄 Новогоднее оформление: само с 1 декабря по 14 января (МСК), предпросмотр — `/?ny=1`.
  const ny = isNewYearSeason() || (await searchParams).ny === "1";
  const trust = [
    { icon: LockKeyhole, title: "Без пароля", text: "Пароль от Roblox не нужен" },
    instant
      ? { icon: KeyRound, title: "Код сразу", text: "Приходит после оплаты" }
      : { icon: Mail, title: "Код на почту", text: "Пришлём после оплаты" },
    { icon: WalletCards, title: "Картой или СБП", text: "Чек придёт на почту" },
    { icon: Headphones, title: "Поможем", text: "Живой человек в Telegram" },
  ];

  return (
    <main className={styles.page}>
      <Navbar />
      {ny && <Snowfall />}

      {/* ── Первый экран: код — главный способ ─────────────────────────── */}
      <section className={`${styles.hero} ${ny ? styles.heroNY : ""}`}>
        {ny && <div className={styles.garlandRow}><Garland /></div>}
        <div className={styles.heroCopy}>
          <div className={styles.eyebrow}><span className={styles.statusDot} /> {ny ? "🎄 Новогодние коды Roblox" : "Коды активации Roblox"}</div>
          {ny ? (
            <h1 className={styles.title}>Robux<br />под ёлку.<br /><span>Подари открыткой.</span></h1>
          ) : instant ? (
            <h1 className={styles.title}>Robux<br />за минуту.<br /><span>Без ожидания.</span></h1>
          ) : (
            <h1 className={styles.title}>Robux<br />кодом.<br /><span>Сразу на баланс.</span></h1>
          )}
          <p className={styles.lead}>
            {ny
              ? "Код Robux в новогодней открытке: выберите номинал, напишите пару тёплых слов — и письмо придёт точно к празднику, хоть 31 декабря в 23:55. Без пароля от Roblox."
              : instant
              ? "Код активации приходит сразу после оплаты — на почту или в кабинет. Без ожидания и без пароля от Roblox."
              : "Оплатите — пришлём код активации на почту или в кабинет. Ввели его на roblox.com/redeem — Robux сразу на балансе. Без пароля от Roblox."}
          </p>
          <div className={styles.heroActions}>
            {ny ? (
              <>
                <a href="#gift" className={styles.buyCode}>
                  <b>🎁 Подарить открыткой</b>
                  <span>открытка в нужный день · от {minCodePrice} ₽</span>
                </a>
                <a href="#codes" className={styles.viaPass}>
                  <b>Купить код себе</b>
                  <span>сразу на баланс</span>
                </a>
              </>
            ) : (
              <>
                <a href="#codes" className={styles.buyCode}>
                  <b>Купить код</b>
                  <span>сразу на баланс · от {minCodePrice} ₽</span>
                </a>
                <a href="#calculator" className={styles.viaPass}>
                  <b>Через геймпасс</b>
                  <span>дешевле, но с ожиданием</span>
                </a>
              </>
            )}
          </div>
          <HeroProof />
        </div>

        <div className={styles.heroSide}>
          {ny && <NewYearScene />}
          <HeroPulse />
          {/* Код с карточки Wildberries. Обычный `<a>`: `?source=wb` обслуживает
              инструкция, клиентский переход Next туда не нужен. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- намеренно полная загрузка */}
          <a className={styles.wbCard} href="/guide?source=wb">
            <span>
              <b>Купил карточку на Wildberries?</b>
              <small>Введи код с карточки — платить второй раз не нужно</small>
            </span>
            <span className={styles.wbCardAction}>Ввести код</span>
          </a>
        </div>
      </section>

      {/* ── Полоса доверия: простыми словами ───────────────────────────── */}
      <section className={styles.trust} aria-label="Почему это безопасно">
        {trust.map(({ icon: Icon, title, text }) => (
          <div key={title} className={styles.trustItem}>
            <span className={styles.trustIcon}><Icon size={18} /></span>
            <span><b>{title}</b><small>{text}</small></span>
          </div>
        ))}
      </section>

      {/* ── Покупка: код первым и крупнее, геймпасс — вторым ───────────── */}
      <section className={styles.buy}>
        <CodesStore instant={instant} festive={ny} />
        <div id="calculator" className={styles.passColumn}>
          <div className={styles.passHead}>
            <div className={styles.passTitle}>
              <span className={styles.passIcon} aria-hidden="true"><Gamepad2 size={24} strokeWidth={2.4} /></span>
              <div>
                <span className={styles.passTag}>Дешевле · с ожиданием</span>
                <b>Геймпасс</b>
              </div>
            </div>
            <span>Robux приходят не сразу: Roblox держит их в ожидании</span>
            <Link href="/guide?source=site&amount=1000" className={styles.passGuide}>Как создать геймпасс — инструкция</Link>
          </div>
          <Calculator />
        </div>
      </section>

      {/* ── Сравнение: код рекомендован ────────────────────────────────── */}
      <section className={styles.compare} aria-labelledby="compare-title">
        <div className={styles.sectionHead}>
          <span className={styles.kicker}>Как выбрать</span>
          <h2 id="compare-title">Не хочешь ждать? Бери код</h2>
        </div>
        <div className={styles.compareGrid}>
          <article className={`${styles.compareCard} ${styles.compareMain}`}>
            <span className={styles.recommend}>РЕКОМЕНДУЕМ</span>
            <span className={styles.compareKicker}>КОД АКТИВАЦИИ</span>
            <dl>
              <dt>Robux на балансе</dt><dd>Сразу после ввода кода</dd>
              <dt>Что сделать</dt><dd>Ввести код на roblox.com/redeem</dd>
              <dt>Подойдёт</dt><dd>Себе, в подарок, за ребёнка</dd>
            </dl>
            <a href="#codes" className={styles.compareCta}>Купить код <ArrowRight size={17} /></a>
          </article>
          <article className={styles.compareCard}>
            <span className={styles.compareKicker}>ГЕЙМПАСС</span>
            <dl>
              <dt>Robux на балансе</dt><dd>Не сразу — Roblox держит в ожидании</dd>
              <dt>Что сделать</dt><dd>Создать пасс по инструкции</dd>
              <dt>Подойдёт</dt><dd>Кто готов подождать ради цены</dd>
            </dl>
            <a href="#calculator" className={styles.compareAlt}>Через геймпасс</a>
          </article>
        </div>
      </section>

      {/* ── Отзывы с Wildberries ───────────────────────────────────────── */}
      <section id="reviews" className={styles.reviews} aria-labelledby="reviews-title">
        <div className={styles.reviewsHead}>
          <div className={styles.sectionHead}>
            <span className={styles.kicker}>Отзывы покупателей с Wildberries</span>
            <h2 id="reviews-title">Пишут покупатели</h2>
          </div>
          <WbReviewsLink className={styles.reviewsLink} />
        </div>
        <ReviewsMarquee />
      </section>

      {/* ── Подарок ───────────────────────────────────────────────────── */}
      <section className={styles.giftPromo} aria-labelledby="gift-title">
        <div className={styles.giftCopy}>
          <span className={styles.kicker}>Подарок, который точно порадует</span>
          <h2 id="gift-title">Подари Robux открыткой</h2>
          <p>Выбери номинал и открытку, напиши пару слов. Получатель откроет подарок по кнопке в письме и сразу введёт код. Можно отправить в день праздника.</p>
          <a href="#gift" className={styles.giftCta}><Gift size={18} /> Выбрать подарок</a>
        </div>
        <div className={styles.giftCards} aria-hidden="true">
          <div className={`${styles.giftCard} ${styles.giftBirthday}`}>
            <GiftArt theme="BIRTHDAY" className={styles.giftArt} />
            <span>С днём рождения!</span>
            <b>1 000<small>ROBUX</small></b>
          </div>
          <div className={`${styles.giftCard} ${styles.giftNewYear}`}>
            <GiftArt theme="NEW_YEAR" className={styles.giftArt} />
            <span>С Новым годом!</span>
            <b>800<small>ROBUX</small></b>
          </div>
        </div>
      </section>

      {/* ── Приглашения ───────────────────────────────────────────────── */}
      <section id="invite" className={styles.invite} aria-labelledby="invite-title">
        <div className={styles.inviteCopy}>
          <span className={styles.kicker}>Приглашай друзей</span>
          <h2 id="invite-title">Скидка на коды растёт вместе с друзьями</h2>
          <p>1% — за регистрацию и подписку на наш канал. Друг купил код по твоей ссылке — он засчитан. Скидка остаётся навсегда — на сайте и в наших ботах.</p>
          <Link href="/dashboard#referral" className={styles.inviteCta}>Получить ссылку <ArrowRight size={17} /></Link>
        </div>
        <ol className={styles.tiers}>
          {CODE_DISCOUNT_TIERS.map((tier, index) => (
            <li key={tier.percent}>
              <b>{tier.percent}%</b>
              <span>{tier.invited === 0 ? "регистрация + канал" : `${tier.invited} ${tier.invited === 3 ? "друга" : "друзей"}`}</span>
              <i aria-hidden="true" style={{ height: `${24 + index * 18}px` }} />
            </li>
          ))}
        </ol>
      </section>

      <CodesInfo instant={instant} />

      <section className={styles.bottomCta}>
        <div>
          <span className={styles.kicker}>Готов?</span>
          <h2>{instant ? "Robux через минуту" : "Robux — кодом"}</h2>
        </div>
        <div className={styles.bottomActions}>
          <a href="#codes" className={styles.bottomPrimary}>Купить код <ArrowRight size={18} /></a>
          <a href="#calculator" className={styles.bottomSecondary}>или через геймпасс</a>
        </div>
      </section>

      <Footer />
    </main>
  );
}
