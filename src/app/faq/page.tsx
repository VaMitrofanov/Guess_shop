import Navbar from "@/components/navbar";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import FAQClient from "@/components/faq-client";

export default async function FAQPage() {
  const faqs = await prisma.fAQ.findMany({ orderBy: { order: "asc" } });

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
        <FAQClient initialFaqs={JSON.parse(JSON.stringify(faqs))} />

        {/* Still have questions */}
        <div className="mt-16 pixel-card border-2 border-[#1e2a45] p-8 space-y-5">
          <div className="font-pixel text-[9px] text-[#00b06f]/60 tracking-wider">SUPPORT</div>
          <h2 className="text-2xl font-black uppercase tracking-tight">Остались вопросы?</h2>
          <p className="text-zinc-400 font-medium text-sm leading-relaxed">
            Наша поддержка работает круглосуточно. Отвечаем в течение 10 минут.
          </p>
          <Link
            href="https://t.me/RobloxBank_PA"
            className="inline-flex h-12 px-8 gold-gradient font-black text-[10px] uppercase tracking-widest text-white hover:opacity-90 transition-all rounded-none items-center gap-2"
          >
            Написать в Telegram →
          </Link>
        </div>
      </section>
    </main>
  );
}
