import Link from "next/link";
import { ArrowRight, BadgeCheck, CreditCard, FileCheck2, LockKeyhole, MessageCircleMore, ScanSearch } from "lucide-react";
import Navbar from "@/components/navbar";
import Footer from "@/components/footer";
import styles from "../public-sections.module.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Как защищены аккаунт, цена и заказ — RobloxBank",
  description: "Как RobloxBank проверяет аккаунт, цену геймпасса, платёж и статус заказа без запроса пароля Roblox.",
  alternates: { canonical: "/guarantees" },
};

const guarantees = [
  { title: "Пароль остаётся у тебя", text: "Для доставки нужен только публичный геймпасс. Доступ к аккаунту, cookie и коды подтверждения мы не просим.", icon: LockKeyhole, tag: "Защита аккаунта" },
  { title: "Сумма видна заранее", text: "До оплаты показываем пакет, цену геймпасса, скидку и итог в рублях. Сервер фиксирует расчёт на время оформления.", icon: ScanSearch, tag: "Прозрачная цена" },
  { title: "Платёжный контур закрыт до проверки", text: "Оплата на сайте появится только после проверки банка и кассы. Карточные данные будет обрабатывать платёжный провайдер, а не RobloxBank.", icon: CreditCard, tag: "Безопасный запуск" },
  { title: "Заказ под контролем", text: "После оплаты у заказа есть статус. Мы сверяем владельца, продажу и точную цену геймпасса перед выкупом.", icon: BadgeCheck, tag: "Проверка заказа" },
  { title: "Условия до оплаты", text: "Реквизиты, оферта, политика и правила возврата уже опубликованы на сайте. После подключения кассы электронный чек будет отправляться на указанный email.", icon: FileCheck2, tag: "Документы" },
  { title: "Есть живой человек", text: "Если что-то пошло не так, поддержка помогает найти заказ, проверить геймпасс и следующий шаг.", icon: MessageCircleMore, tag: "Поддержка" },
];

export default function GuaranteesPage() {
  return (
    <main className={styles.page}>
      <Navbar />
      <div className={styles.shell}>
        <header className={styles.hero}>
          <div className={styles.heroCopy}>
            <span className={styles.kicker}>Система доверия RobloxBank</span>
            <h1>Robux хранятся<br /><span>за дверью сейфа.</span></h1>
            <p>Каждый важный этап — цена, платёж, геймпасс и статус заказа — проверяется отдельно. Ни одного обещания, которое нельзя увидеть в интерфейсе.</p>
          </div>
          <div className={styles.seal}>R$</div>
        </header>

        <div className={styles.sectionTop}>
          <h2>Шесть уровней защиты</h2>
          <p>Человеческим языком о том, что происходит с аккаунтом, деньгами и заказом.</p>
        </div>
        <section className={styles.grid}>
          {guarantees.map(({ title, text, icon: Icon, tag }) => (
            <article key={title} className={styles.card}>
              <div className={styles.cardIcon}><Icon size={25} /></div>
              <div><span className={styles.cardTag}>{tag}</span><h3>{title}</h3><p>{text}</p></div>
            </article>
          ))}
        </section>

        <section className={styles.cta}>
          <div className={styles.ctaText}><h2>Готов открыть свой сейф?</h2><p>Сначала введи ник — пароль Roblox не понадобится.</p></div>
          <Link href="/#calculator" className={styles.button}>Рассчитать покупку <ArrowRight size={19} /></Link>
        </section>
      </div>
      <Footer />
    </main>
  );
}
