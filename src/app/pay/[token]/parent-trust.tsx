import { ArrowUpRight, Phone, Star } from "lucide-react";
import Link from "next/link";
import type { TrustStats } from "@/lib/trust-stats";
import { LEGAL_DETAILS } from "@/lib/legal-details";
import styles from "./parent-trust.module.css";

/**
 * 🛡 Доверие для родителя на странице оплаты (15.11.2026, мокап утверждён
 * владельцем). Ссылку на оплату родителю присылает ребёнок — человек видит
 * незнакомый магазин. Здесь всё, чем нас можно проверить самому: живые цифры
 * с площадок, настоящие отзывы WB, реквизиты, живая поддержка.
 * Среднюю оценку WB не показываем (≈3,9 — «★4,9» было бы враньём).
 */

function floorTens(n: number): number {
  return n >= 20 ? Math.floor(n / 10) * 10 : n;
}

function fmt(n: number): string {
  return n.toLocaleString("ru-RU");
}

function millions(n: number): string {
  return n >= 1_000_000 ? `${(Math.floor(n / 100_000) / 10).toLocaleString("ru-RU")} млн` : fmt(n);
}

const PHONE_HREF = `tel:${LEGAL_DETAILS.phone.replace(/[^\d+]/g, "")}`;

export function PayExplainer() {
  return (
    <>
      <section className={styles.card} aria-labelledby="what-title">
        <h2 id="what-title">Что вы оплачиваете</h2>
        <div className={styles.what}><span aria-hidden="true">🎮</span><div><b>Robux — валюта игры Roblox</b><p>На неё в играх покупают скины, предметы и возможности. В России оплатить Roblox картой напрямую нельзя — поэтому покупают код.</p></div></div>
        <div className={styles.what}><span aria-hidden="true">🎟</span><div><b>Код — как подарочная карта</b><p>После оплаты код придёт туда, куда указано в заказе. Его вводят на официальном сайте roblox.com/redeem — и Robux сразу на балансе.</p></div></div>
        <div className={styles.what}><span aria-hidden="true">🔐</span><div><b>Никаких паролей</b><p>Мы не просим пароль от Roblox, коды из СМС или вход в аккаунт ребёнка. Данные карты видит только банк.</p></div></div>
      </section>
      <section className={styles.card} aria-labelledby="promise-title">
        <h2 id="promise-title">Наши обещания</h2>
        <ul className={styles.promise}>
          <li>Оплата только на защищённой странице Т-Банка — карта к нам не попадает.</li>
          <li>Электронный чек придёт на вашу почту сразу после оплаты.</li>
          <li>Если код не выдадим — вернём деньги полностью.</li>
          <li>На любой вопрос отвечает живой человек, а не робот.</li>
        </ul>
      </section>
    </>
  );
}

export default function ParentTrust({ trust, denomination }: { trust: TrustStats | null; denomination: number }) {
  const reviews = trust ? floorTens(trust.reviewsTotal) : 0;
  return (
    <aside className={styles.side}>
      <section className={styles.card} aria-labelledby="check-title">
        <h2 id="check-title">Проверьте нас сами</h2>
        <p className={styles.muted}>Мы работаем открыто — откройте любую площадку и посмотрите отзывы настоящих покупателей.</p>
        <div className={styles.check}>
          <a className={styles.src} href={trust?.wbReviewsUrl ?? "https://www.wildberries.ru/"} target="_blank" rel="noopener noreferrer">
            <span className={styles.badge} data-brand="wb">Wildberries</span>
            <b>{reviews >= 20 ? `${fmt(reviews)}+` : "Отзывы"}</b>
            <small>отзывов покупателей</small>
            <em>Открыть отзывы <ArrowUpRight size={13} /></em>
          </a>
          <a className={styles.src} href="https://t.me/Roblox_Bank_Tg" target="_blank" rel="noopener noreferrer">
            <span className={styles.badge} data-brand="tg">Telegram</span>
            <b>{trust?.tgMembers ? fmt(trust.tgMembers) : "Канал"}</b>
            <small>подписчиков канала</small>
            <em>Открыть канал <ArrowUpRight size={13} /></em>
          </a>
          <a className={styles.src} href="https://vk.ru/bankroblox" target="_blank" rel="noopener noreferrer">
            <span className={styles.badge} data-brand="vk">ВКонтакте</span>
            <b>{trust?.vkMembers ? fmt(trust.vkMembers) : "Группа"}</b>
            <small>участников группы</small>
            <em>Открыть группу <ArrowUpRight size={13} /></em>
          </a>
          <div className={styles.src}>
            <span className={styles.badge} data-brand="rb">RobloxBank</span>
            <b>{trust ? fmt(trust.orders) : "—"}</b>
            <small>выдач покупателям{trust ? ` · ${millions(trust.robuxGross)} Robux` : ""}</small>
            <em className={styles.plain}>все способы, включая WB</em>
          </div>
        </div>
      </section>

      {trust && trust.reviews.length > 0 && (
        <section className={styles.card} aria-labelledby="rev-title">
          <h2 id="rev-title">Что пишут покупатели на Wildberries</h2>
          <div className={styles.reviews}>
            {trust.reviews.map((review) => (
              <figure key={review.id} className={styles.review}>
                <span className={styles.stars} aria-label="5 звёзд из 5">{Array.from({ length: 5 }).map((_, i) => <Star key={i} size={13} fill="currentColor" strokeWidth={0} />)}</span>
                <blockquote>{review.text}</blockquote>
                <figcaption>{review.name} · 5★ на Wildberries</figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}

      <section className={styles.card} aria-labelledby="sup-title">
        <h2 id="sup-title">Остались вопросы? Спросите до оплаты</h2>
        <div className={styles.support}>
          <a className={styles.tgButton} href="https://t.me/RobloxBank_PA" target="_blank" rel="noopener noreferrer">Написать в Telegram</a>
          <a className={styles.phone} href={PHONE_HREF}><Phone size={15} /> {LEGAL_DETAILS.phone}</a>
        </div>
        <p className={styles.muted}>Ежедневно с 12:00 до 20:00 по Москве, ответим в течение дня.</p>
      </section>

      <section className={`${styles.card} ${styles.faq}`} aria-labelledby="faq-title">
        <h2 id="faq-title">Частые вопросы родителей</h2>
        <details open>
          <summary>Это не мошенники?</summary>
          <p>У нас магазин на Wildberries с сотнями отзывов, мы работаем как ИП (реквизиты ниже), чек приходит от банка. Мы никогда не просим пароль от Roblox и данные карты.</p>
        </details>
        <details>
          <summary>Что получит ребёнок?</summary>
          <p>Код на {fmt(denomination)} Robux — туда, куда указано в заказе. Код вводят на roblox.com/redeem, и Robux сразу появляются на балансе его аккаунта.</p>
        </details>
        <details>
          <summary>Можно ли вернуть деньги?</summary>
          <p>Если код не выдан — вернём полностью. Выданный код — как подарочная карта: после ввода в игре вернуть его нельзя.</p>
        </details>
        <details>
          <summary>Почему нельзя оплатить прямо в игре?</summary>
          <p>Roblox не принимает российские карты, а покупки в магазинах приложений часто недоступны. Код — рабочий способ пополнить баланс из России.</p>
        </details>
      </section>

      <p className={styles.legal}>
        <b>{LEGAL_DETAILS.entity.replace("Индивидуальный предприниматель", "ИП")}</b> · ИНН {LEGAL_DETAILS.inn} · ОГРНИП {LEGAL_DETAILS.ogrn}<br />
        <Link href="/legal/details">Реквизиты</Link> · <Link href="/legal/offer">Оферта</Link> · <Link href="/legal/policy">Конфиденциальность</Link><br />
        Сервис не связан с Roblox Corporation.
      </p>
    </aside>
  );
}
