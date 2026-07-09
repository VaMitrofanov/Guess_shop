import Navbar from "@/components/navbar";
import Footer from "@/components/footer";
import { prisma } from "@/lib/prisma";
import ReviewsClient from "@/components/reviews-client";
import Link from "next/link";
import { MessageCircle } from "lucide-react";

// Public reviews list lives in DB. Force dynamic so `next build` doesn't try
// to prerender it (Coolify build container may have no DB access).
export const dynamic = "force-dynamic";
export const revalidate = 0;

const VK_COMMUNITY = "https://vk.ru/bankroblox";

function StarRow({ count = 5 }: { count?: number }) {
  return (
    <div className="flex gap-1">
      {Array.from({ length: 5 }).map((_, i) => (
        <svg key={i} className={`w-4 h-4 ${i < count ? "text-[#00b06f]" : "text-zinc-700"}`} viewBox="0 0 24 24" fill="currentColor">
          <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" />
        </svg>
      ))}
    </div>
  );
}

export default async function ReviewsPage() {
  let reviews: Awaited<ReturnType<typeof prisma.review.findMany>> = [];
  try {
    reviews = await prisma.review.findMany({ orderBy: { createdAt: "desc" } });
  } catch (err) {
    console.error("[reviews] failed to load reviews from DB:", err);
    reviews = [];
  }

  const count = reviews.length;
  // Rating derived from real data — no hardcoded "4.9" when the DB is empty.
  const avg = count > 0 ? reviews.reduce((s, r) => s + (r.rating ?? 0), 0) / count : 0;

  return (
    <main className="min-h-screen">
      <Navbar />

      <section className="container mx-auto px-4 pt-16 pb-24 max-w-5xl">

        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-10 mb-14">
          <div className="space-y-4">
            <div className="font-pixel text-[9px] text-[#00b06f]/60 tracking-wider">REVIEWS</div>
            <h1 className="text-4xl md:text-6xl font-black uppercase tracking-[-0.03em] leading-none">
              Что говорят<br />
              <span className="gold-text">покупатели</span>
            </h1>
            <p className="text-zinc-400 font-medium max-w-md">
              Отзывы наших покупателей из Telegram и VK-сообщества.
            </p>
          </div>

          {/* Rating card — only when there are real reviews to summarise */}
          {count > 0 && (
            <div className="pixel-card border-2 border-[#1e2a45] p-6 space-y-3 min-w-[200px]">
              <StarRow count={Math.round(avg)} />
              <div className="font-pixel text-2xl text-[#00b06f]">{avg.toFixed(1)}</div>
              <p className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">Средний рейтинг</p>
              <div className="accent-line" />
              <p className="font-pixel text-[8px] text-zinc-600">
                {count} {count === 1 ? "отзыв" : count < 5 ? "отзыва" : "отзывов"}
              </p>
            </div>
          )}
        </div>

        <div className="accent-line mb-10" />

        {/* Reviews grid, or graceful empty state */}
        {count > 0 ? (
          <ReviewsClient initialReviews={JSON.parse(JSON.stringify(reviews))} />
        ) : (
          <div className="pixel-card border-2 border-[#1e2a45] p-16 text-center space-y-5">
            <div className="w-14 h-14 mx-auto border-2 border-[#1e2a45] flex items-center justify-center">
              <MessageCircle className="w-7 h-7 text-zinc-600" />
            </div>
            <div>
              <p className="font-black text-lg uppercase">Публичные отзывы скоро появятся</p>
              <p className="text-sm text-zinc-500 font-medium mt-1 max-w-md mx-auto">
                Живые отзывы и истории покупателей — в нашем сообществе VK. Заходите почитать или
                оставить свой.
              </p>
            </div>
            <Link
              href={VK_COMMUNITY}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-12 px-8 gold-gradient font-black text-[10px] uppercase tracking-widest text-white hover:opacity-90 transition-all rounded-none items-center gap-2"
            >
              Читать отзывы в VK →
            </Link>
          </div>
        )}

        {/* CTA — now a working link to where reviews are collected (M6 fix) */}
        <div className="mt-16 pixel-card border-2 border-[#1e2a45] p-8 flex flex-col sm:flex-row items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="font-pixel text-[9px] text-[#00b06f]/60 tracking-wider">YOUR TURN</div>
            <h2 className="text-xl font-black uppercase">Оставь свой отзыв</h2>
            <p className="text-zinc-500 text-sm font-medium">Отзывы проходят модерацию перед публикацией</p>
          </div>
          <Link
            href={VK_COMMUNITY}
            target="_blank"
            rel="noopener noreferrer"
            className="h-12 px-8 gold-gradient font-black text-[10px] uppercase tracking-widest text-white hover:opacity-90 transition-all rounded-none flex-shrink-0 flex items-center"
          >
            Написать отзыв →
          </Link>
        </div>
      </section>
      <Footer />
    </main>
  );
}
