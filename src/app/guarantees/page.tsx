import Link from "next/link";
import { ArrowRight, BadgeCheck, CreditCard, FileCheck2, LockKeyhole, MessageCircleMore, ScanSearch } from "lucide-react";
import Navbar from "@/components/navbar";
import Footer from "@/components/footer";
import styles from "../public-sections.module.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Гарантии — RobloxBank",
  description: "Простыми словами: почему покупать Robux в RobloxBank безопасно — без пароля от Roblox, с чеком, с живой поддержкой.",
  alternates: { canonical: "/guarantees" },
};

/* Витрина 2.0 (15.11.2026): переписано простыми словами. Старый текст обещал
   «оплата на сайте появится после проверки банка» — оплата давно работает.
   Без терминов: часть покупателей — родители, которые еле пользуются интернетом. */
const guarantees = [
  { title: "Пароль от Roblox не нужен", text: "Мы никогда не просим пароль, коды из СМС или вход в ваш аккаунт. Если кто-то просит от нашего имени — это мошенник.", icon: LockKeyhole, tag: "Аккаунт" },
  { title: "Цена — до оплаты", text: "Сумма на кнопке — окончательная. Никаких доплат и комиссий сверху: сколько видите, столько и платите.", icon: ScanSearch, tag: "Цена" },
  { title: "Оплата через банк", text: "Платите картой или по СБП на странице Т-Банка. Данные карты видит только банк — нам они не приходят.", icon: CreditCard, tag: "Оплата" },
  { title: "Чек на почту", text: "После оплаты банк присылает электронный чек на вашу почту. Это официальное подтверждение покупки.", icon: FileCheck2, tag: "Документы" },
  { title: "Код — только ваш", text: "Код активации приходит на почту, в личный кабинет или в чат бота — только тому, кто покупал. Повторно его можно отправить в любой момент.", icon: BadgeCheck, tag: "Коды" },
  { title: "Живой человек на связи", text: "Если что-то непонятно — пишите в Telegram @RobloxBank_PA. Отвечает человек, а не робот: поможем найти заказ и довести до конца.", icon: MessageCircleMore, tag: "Поддержка" },
];

export default function GuaranteesPage() {
  return (
    <main className={styles.page}>
      <Navbar />
      <div className={styles.shell}>
        <header className={styles.hero}>
          <div className={styles.heroCopy}>
            <span className={styles.kicker}>Гарантии</span>
            <h1>Покупать у нас<br /><span>безопасно.</span></h1>
            <p>Простыми словами — что мы делаем и чего не делаем никогда. Обещаем только то, что вы видите своими глазами.</p>
          </div>
          <div className={styles.seal}>R$</div>
        </header>

        <div className={styles.sectionTop}>
          <h2>Шесть простых правил</h2>
          <p>Про аккаунт, деньги и ваш заказ.</p>
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
          <div className={styles.ctaText}><h2>Готовы пополнить баланс?</h2><p>Код активации — сразу на баланс, без пароля от Roblox.</p></div>
          <Link href="/#codes" className={styles.button}>Купить код <ArrowRight size={19} /></Link>
        </section>
      </div>
      <Footer />
    </main>
  );
}
