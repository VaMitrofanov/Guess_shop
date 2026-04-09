'use client';

import { motion } from 'framer-motion';
import { HelpCircle } from 'lucide-react';
import { GlowCard } from '@/components/ui/spotlight-card';

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.1 } }
};

const item = {
  hidden: { x: -20, opacity: 0 },
  show: { x: 0, opacity: 1 }
};

export default function FAQClient({ initialFaqs }: { initialFaqs: any[] }) {
  return (
    <motion.div 
      variants={container}
      initial="hidden"
      animate="show"
      className="grid gap-4"
    >
      {initialFaqs.map((faq) => (
        <motion.div key={faq.id} variants={item}>
          <GlowCard
            customSize
            glowColor="golden"
            className="group bg-[#141416] p-6 flex gap-6 items-start w-full"
          >
            <div className="pt-1 opacity-50 group-hover:opacity-100 transition-opacity flex-shrink-0">
              <HelpCircle className="text-yellow-500" />
            </div>
            <div className="space-y-2">
              <h3 className="text-lg font-bold uppercase tracking-tight text-zinc-100">{faq.question}</h3>
              <p className="text-zinc-400 leading-relaxed font-medium">
                {faq.answer}
              </p>
            </div>
          </GlowCard>
        </motion.div>
      ))}
    </motion.div>
  );
}
