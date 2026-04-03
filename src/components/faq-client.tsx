'use client';

import { motion } from 'framer-motion';
import { HelpCircle } from 'lucide-react';

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
        <motion.div 
          key={faq.id}
          variants={item}
          className="group bg-[#141416] border border-white/5 hover:border-[#ffb800]/30 transition-all p-6 rounded-sm flex gap-6 items-start"
        >
          <div className="pt-1 opacity-50 group-hover:opacity-100 transition-opacity">
              <HelpCircle className="text-yellow-500" />
          </div>
          <div className="space-y-2">
            <h3 className="text-lg font-bold uppercase tracking-tight text-zinc-100">{faq.question}</h3>
            <p className="text-zinc-400 leading-relaxed font-medium">
              {faq.answer}
            </p>
          </div>
        </motion.div>
      ))}
    </motion.div>
  );
}
