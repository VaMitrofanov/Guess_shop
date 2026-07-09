import Navbar from "@/components/navbar";
import Footer from "@/components/footer";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import FAQClient from "@/components/faq-client";

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
    question: "Какие есть способы оплаты?",
    answer:
      "Оплата банковской картой и через СБП. Платежи проходят через защищённый шлюз Тинькофф с поддержкой 3-D Secure. Данные вашей карты мы не храним.",
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
      "Если мы не смогли выполнить заказ — возвращаем оплату. Возврат за уже доставленные цифровые товары не предусмотрен (ст. 26.1 ЗоЗПП). Полные условия — в публичной оферте.",
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
      "Напишите в наш Telegram @RobloxBank_PA или в сообщество VK. Обычно отвечаем в течение нескольких минут.",
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
    <main className="min-h-screen">
      <Navbar />

      <section className="container mx-auto px-4 pt-16 pb-24 max-w-3xl">

        {/* Header */}
        <div className="mb-14 space-y-4">
          <div className="font-pixel text-[9px] text-[#00b06f]/60 tracking-wider">HELP CENTER</div>
          <h1 className="text-4xl md:text-6xl font-black uppercase tracking-[-0.03em] leading-none">
            Частые<br />
            <span className="gold-text">вопросы</span>
          </h1>
          <p className="text-zinc-400 font-medium max-w-lg">
            Ответы на самые популярные вопросы о покупке Robux через Roblox Bank.
          </p>
        </div>

        {/* Accent line */}
        <div className="accent-line mb-10" />

        {/* FAQ list */}
        <FAQClient initialFaqs={displayFaqs} />

        {/* Still have questions */}
        <div className="mt-16 pixel-card border-2 border-[#1e2a45] p-8 space-y-5">
          <div className="font-pixel text-[9px] text-[#00b06f]/60 tracking-wider">SUPPORT</div>
          <h2 className="text-2xl font-black uppercase tracking-tight">Остались вопросы?</h2>
          <p className="text-zinc-400 font-medium text-sm leading-relaxed">
            Напишите нам — обычно отвечаем в течение нескольких минут.
          </p>
          <Link
            href="https://t.me/RobloxBank_PA"
            className="inline-flex h-12 px-8 gold-gradient font-black text-[10px] uppercase tracking-widest text-white hover:opacity-90 transition-all rounded-none items-center gap-2"
          >
            Написать в Telegram →
          </Link>
        </div>
      </section>
      
      <Footer />
    </main>
  );
}
