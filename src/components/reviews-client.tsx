'use client';

import { motion } from 'framer-motion';
import { Star, MessageCircle, User, CheckCircle2 } from 'lucide-react';
import { GlowCard } from '@/components/ui/spotlight-card';

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.1 } }
};

const item = {
  hidden: { y: 30, opacity: 0 },
  show: { y: 0, opacity: 1 }
};

export default function ReviewsClient({ initialReviews }: { initialReviews: any[] }) {
  return (
    <motion.div 
      variants={container}
      initial="hidden"
      animate="show"
      className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
    >
      {initialReviews.map((review) => (
        <motion.div key={review.id} variants={item}>
          <GlowCard
            customSize
            glowColor="golden"
            className="bg-[#141416] p-8 flex flex-col gap-8 group h-full"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center border border-white/10">
                  <User className="w-5 h-5 text-zinc-500" />
                </div>
                <div>
                  <div className="font-bold flex items-center gap-2">
                    {review.author}
                    {review.isVerified && <CheckCircle2 className="w-4 h-4 text-green-500" />}
                  </div>
                  <div className="text-[10px] uppercase font-black tracking-widest text-zinc-500">{review.date}</div>
                </div>
              </div>
              <div className="flex gap-0.5">
                {[...Array(review.rating)].map((_, i) => (
                  <Star key={i} className="w-3 h-3 fill-[#ffb800] text-[#ffb800]" />
                ))}
              </div>
            </div>

            <p className="text-zinc-400 font-medium leading-relaxed italic flex-1">
              &quot;{review.content}&quot;
            </p>

            <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <MessageCircle className="w-4 h-4 text-[#ffb800]" />
              <span className="text-[10px] font-black uppercase tracking-widest text-[#ffb800]">Верифицированный клиент</span>
            </div>
          </GlowCard>
        </motion.div>
      ))}
    </motion.div>
  );
}
