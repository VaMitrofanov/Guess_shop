import { motion } from 'framer-motion';
import Navbar from '@/components/navbar';
import { HelpCircle } from 'lucide-react';
import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import FAQClient from '@/components/faq-client';

export default async function FAQPage() {
  const faqs = await prisma.fAQ.findMany({
    orderBy: { order: 'asc' },
  });

  return (
    <main className="min-h-screen bg-[#0a0a0b] text-white selection:bg-[#ffb800] selection:text-black">
      <Navbar />

      <section className="pt-32 pb-20 px-4">
        <div className="container mx-auto max-w-4xl">
          <div className="space-y-4 mb-16">
            <span className="text-[#00f2fe] font-black tracking-widest text-sm uppercase">Помощь и поддержка</span>
            <h1 className="text-5xl md:text-7xl font-black uppercase leading-none">
                ЧАСТО ЗАДАВАЕМЫЕ <br/> <span className="gold-text italic">ВОПРОСЫ</span>
            </h1>
          </div>

          <FAQClient initialFaqs={JSON.parse(JSON.stringify(faqs))} />

          <div className="mt-20 p-8 border border-dashed border-white/10 rounded-sm text-center space-y-6">
            <h2 className="text-2xl font-bold uppercase">Все еще есть вопросы?</h2>
            <p className="text-zinc-500 max-w-md mx-auto">
                Наша поддержка работает круглосуточно. Напишите нам, и мы ответим в течение 10 минут.
            </p>
            <Link 
              href="https://t.me/your_support" 
              className="inline-flex h-12 px-8 bg-zinc-100 text-black font-black uppercase text-sm items-center hover:bg-[#ffb800] transition-colors"
            >
              СВЯЗАТЬСЯ В TELEGRAM
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
