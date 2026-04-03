import Navbar from '@/components/navbar';
import { prisma } from '@/lib/prisma';
import ReviewsClient from '@/components/reviews-client';
import { Star } from 'lucide-react';

export default async function ReviewsPage() {
  const reviews = await prisma.review.findMany({
    orderBy: { createdAt: 'desc' },
  });

  return (
    <main className="min-h-screen bg-[#05070a] text-white selection:bg-[#00f2fe] selection:text-black">
      <Navbar />

      <section className="pt-32 pb-48 px-4">
        <div className="container mx-auto">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-12 mb-24">
            <div className="space-y-6 max-w-2xl">
              <span className="text-[#00f2fe] font-black tracking-widest text-sm uppercase">Наши достижения</span>
              <h1 className="text-5xl md:text-8xl font-black uppercase tracking-tighter leading-none italic">
                  ЧТО О НАС <br/> <span className="gold-text">ГОВОРЯТ</span>
              </h1>
              <p className="text-zinc-500 text-lg font-medium">Более 10,000 довольных клиентов уже оставили свои отзывы в наших социальных сетях.</p>
            </div>

            <div className="p-8 bg-[#0d1117] border border-white/5 rounded-2xl flex flex-col gap-4 text-center min-w-[280px]">
                <div className="flex justify-center gap-1">
                    {[1,2,3,4,5].map(i => <Star key={i} className="w-5 h-5 fill-[#00f2fe] text-[#00f2fe]" />)}
                </div>
                <div className="text-4xl font-black text-[#00f2fe]">4.9 / 5</div>
                <div className="text-xs font-bold uppercase tracking-widest text-zinc-500">Средний рейтинг</div>
            </div>
          </div>

          <ReviewsClient initialReviews={JSON.parse(JSON.stringify(reviews))} />

          {/* Call to action */}
          <div className="mt-32 flex flex-col items-center gap-8 text-center">
              <h2 className="text-3xl font-black uppercase italic">Хочешь оставить свой отзыв?</h2>
              <button className="h-16 px-12 gold-gradient text-black font-black uppercase tracking-widest hover:scale-[1.02] active:scale-[0.98] transition-all rounded-2xl flex items-center gap-4">
                  НАПИСАТЬ ОТЗЫВ
              </button>
              <p className="text-zinc-600 text-xs font-bold uppercase tracking-widest">Отзывы проходят модерацию перед публикацией</p>
          </div>
        </div>
      </section>
    </main>
  );
}
