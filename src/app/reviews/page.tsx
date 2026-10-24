import Link from "next/link";
import { ArrowRight, MessageCircleMore, Star } from "lucide-react";
import Navbar from "@/components/navbar";
import Footer from "@/components/footer";
import ReviewsClient from "@/components/reviews-client";
import { prisma } from "@/lib/prisma";
import styles from "../public-sections.module.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Отзывы клиентов — RobloxBank",
  description: "Опубликованные отзывы клиентов RobloxBank с отметкой подтверждённой покупки.",
  alternates: { canonical: "/reviews" },
};

export const dynamic = "force-dynamic";
export const revalidate = 0;
const VK_COMMUNITY = "https://vk.ru/bankroblox";

export default async function ReviewsPage() {
  let reviews: Awaited<ReturnType<typeof prisma.review.findMany>> = [];
  try { reviews = await prisma.review.findMany({ orderBy: { createdAt: "desc" } }); }
  catch (error) { console.error("[reviews] failed to load reviews from DB:", error); }
  const count = reviews.length;
  const average = count ? reviews.reduce((sum, review) => sum + (review.rating ?? 0), 0) / count : 0;

  return (
    <main className={styles.page}>
      <Navbar />
      <div className={styles.shell}>
        <header className={styles.hero}>
          <div className={styles.heroCopy}><span className={styles.kicker}>Отзывы клиентов</span><h1>Люди открыли сейф.<br /><span>Вот что они говорят.</span></h1><p>Публикуем отзывы покупателей из наших каналов. Подтверждённая отметка означает, что покупка действительно была.</p></div>
          {count > 0 ? <div className={styles.rating}><div className={styles.stars}>{Array.from({ length: 5 }).map((_, index) => <Star key={index} size={18} fill="currentColor" opacity={index < Math.round(average) ? 1 : .22} />)}</div><strong>{average.toFixed(1)}</strong><span>{count} {count === 1 ? "отзыв" : count < 5 ? "отзыва" : "отзывов"}</span></div> : <div className={styles.seal}>R$</div>}
        </header>

        <div className={styles.sectionTop}><h2>Без рекламного шума</h2><p>Короткие реальные истории — о скорости, понятной инструкции и результате.</p></div>
        {count > 0 ? <ReviewsClient initialReviews={JSON.parse(JSON.stringify(reviews))} /> : <div className={styles.empty}><MessageCircleMore size={42} /><h2>Отзывы скоро появятся здесь</h2><p>Пока их можно посмотреть в сообществе VK — там же легко оставить свой.</p><Link href={VK_COMMUNITY} target="_blank" rel="noopener noreferrer" className={styles.button}>Открыть отзывы в VK <ArrowRight size={19} /></Link></div>}

        <section className={styles.cta}><div className={styles.ctaText}><h2>Есть опыт с RobloxBank?</h2><p>Расскажи честно — отзыв пройдёт модерацию и поможет другим.</p></div><Link href={VK_COMMUNITY} target="_blank" rel="noopener noreferrer" className={styles.button}>Написать отзыв <ArrowRight size={19} /></Link></section>
      </div>
      <Footer />
    </main>
  );
}
