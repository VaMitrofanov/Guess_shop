import Navbar from "@/components/navbar";
import Footer from "@/components/footer";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import FAQClient from "@/components/faq-client";
import { ArrowRight, Headphones } from "lucide-react";
import styles from "../public-sections.module.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Помощь и частые вопросы — RobloxBank",
  description: "Ответы о покупке Robux через геймпасс, цене, сроках, статусе заказа и поддержке RobloxBank.",
  alternates: { canonical: "/faq" },
};

// Force dynamic rendering — the FAQ list lives in DB, so we don't want
// `next build` to try and prerender this page (Coolify build env may not
// have network access to Neon DB, which caused the previous build to fail).
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Curated fallback shown when the DB has no FAQs (fresh env / empty prod DB).
// Keeps the page from looking unfinished during payment-gateway moderation.
// Factual answers only — the service workflow, no unverifiable claims. Any FAQ
// added via /admin/faq overrides this list.
const DEFAULT_FAQS = [
  {
    id: "default-1",
    question: "Как купить Robux?",
    answer:
      "Укажите сумму в калькуляторе на главной, создайте в своей игре Roblox геймпасс на нужную цену, оформите заказ с игровым ником и оплатите. Пошаговая инструкция — на странице «Инструкция».",
  },
  {
    id: "default-2",
    question: "Нужен ли пароль от аккаунта Roblox?",
    answer:
      "Нет. Мы никогда не запрашиваем пароль или доступ к аккаунту. Доставка идёт через геймпасс: вы создаёте геймпасс в своей игре, а наш бот его покупает — Robux зачисляются вам.",
  },
  {
    id: "default-3",
    question: "Почему Robux приходят не сразу?",
    answer:
      "По правилам Roblox средства от продажи геймпасса зачисляются в статусе Pending и становятся доступны примерно через 5–7 дней. Это ограничение самой платформы Roblox, а не сервиса.",
  },
  {
    id: "default-4",
    question: "Можно ли оплатить заказ на сайте?",
    answer:
      "Пока публичная оплата на сайте закрыта: мы завершаем проверку платёжного и кассового контура. Доступный способ оформления будет явно показан перед подтверждением заказа — без передачи карточных данных RobloxBank.",
  },
  {
    id: "default-5",
    question: "Учтён ли налог Roblox в цене?",
    answer:
      "Да. Roblox удерживает комиссию с продажи геймпасса (30%). Цена в калькуляторе — финальная: комиссия платформы уже заложена в расчёт, скрытых доплат нет.",
  },
  {
    id: "default-6",
    question: "Что если заказ не будет выполнен?",
    answer:
      "Обратитесь к менеджеру с номером заказа. Порядок отмены и возврата будет указан в утверждённой публичной оферте до запуска оплаты на сайте.",
  },
  {
    id: "default-7",
    question: "Как отследить статус заказа?",
    answer:
      "Сразу после оплаты открывается страница статуса заказа. Зачисление Robux можно проверить на странице транзакций в самом Roblox — до 5–7 дней средства держатся в статусе Pending.",
  },
  {
    id: "default-8",
    question: "Как связаться с поддержкой?",
    answer:
      "Напишите в наш Telegram @RobloxBank_PA или в сообщество VK. Менеджер ответит в рабочее время; точные часы и срок ответа появятся вместе с реквизитами до публичного запуска.",
  },
];

export default async function FAQPage() {
  // Wrap DB call in try/catch so a transient DB outage during SSR
  // (or a build-time prerender attempt) doesn't 500 the whole page.
  let faqs: Awaited<ReturnType<typeof prisma.fAQ.findMany>> = [];
  try {
    faqs = await prisma.fAQ.findMany({ orderBy: { order: "asc" } });
  } catch (err) {
    console.error("[faq] failed to load FAQs from DB:", err);
    faqs = [];
  }

  const displayFaqs = faqs.length > 0 ? JSON.parse(JSON.stringify(faqs)) : DEFAULT_FAQS;

  return (
    <main className={styles.page}>
      <Navbar />
      <div className={styles.shell}>
        <header className={styles.hero}>
          <div className={styles.heroCopy}><span className={styles.kicker}>Центр помощи RobloxBank</span><h1>Ответ рядом.<br /><span>Без мелкого шрифта.</span></h1><p>Собрали понятные ответы о цене, геймпассе, оплате, сроках и возврате. Самый частый вопрос уже открыт.</p></div>
          <div className={styles.seal}>?</div>
        </header>
        <div className={styles.sectionTop}><h2>Популярные вопросы</h2><p>Нажми на вопрос, чтобы открыть ответ. Всё читается нормально даже с телефона.</p></div>
        <FAQClient initialFaqs={displayFaqs} />
        <section className={styles.cta}><div className={styles.ctaText}><Headphones size={30} /><h2>Нужен человек?</h2><p>Напиши менеджеру и приложи номер заказа или скрин проблемы.</p></div><Link href="https://t.me/RobloxBank_PA" className={styles.button}>Написать в Telegram <ArrowRight size={19} /></Link></section>
      </div>
      <Footer />
    </main>
  );
}
