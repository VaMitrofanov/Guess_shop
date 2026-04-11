import Navbar from "@/components/navbar";
import Footer from "@/components/footer";
import Link from "next/link";
import { ShieldCheck, Zap, Users, Star, Lock, HeartHandshake, ArrowRight } from "lucide-react";

const guarantees = [
  {
    title: "Безопасные платежи",
    desc: "Все транзакции проходят через официальный шлюз Тинькофф. Мы не храним данные карт. Все операции защищены 3D-Secure.",
    icon: Lock,
    tag: "SECURITY",
  },
  {
    title: "Мгновенная обработка",
    desc: "Система автоматически обрабатывает заказ сразу после оплаты. Никаких ожиданий оператора.",
    icon: Zap,
    tag: "AUTO",
  },
  {
    title: "Официальный курс",
    desc: "Работаем напрямую с поставщиками. Предлагаем один из лучших курсов на рынке СНГ.",
    icon: HeartHandshake,
    tag: "FAIR PRICE",
  },
  {
    title: "Поддержка 24/7",
    desc: "Наша команда всегда онлайн. Если возникла проблема — ответим в течение нескольких минут.",
    icon: ShieldCheck,
    tag: "SUPPORT",
  },
  {
    title: "Опыт и репутация",
    desc: "Работаем с 2024 года. Более 5 000 выполненных заказов. Ваша покупка в надёжных руках.",
    icon: Users,
    tag: "TRUSTED",
  },
  {
    title: "Реальные отзывы",
    desc: "Тысячи довольных клиентов в Telegram и VK. Проверьте сами, почитав реальные истории.",
    icon: Star,
    tag: "VERIFIED",
  },
];

export default function GuaranteesPage() {
  return (
    <main className="min-h-screen">
      <Navbar />

      <section className="container mx-auto px-4 pt-16 pb-24 max-w-5xl">

        {/* Header */}
        <div className="mb-14 space-y-4">
          <div className="font-pixel text-[9px] text-[#00b06f]/60 tracking-wider">TRUST & SAFETY</div>
          <h1 className="text-4xl md:text-6xl font-black uppercase tracking-[-0.03em] leading-none">
            Наши<br />
            <span className="gold-text">гарантии</span>
          </h1>
          <p className="text-zinc-400 font-medium max-w-lg">
            Мы несём полную ответственность за каждый заказ. Вот почему тысячи игроков доверяют нам.
          </p>
        </div>

        <div className="accent-line mb-10" />

        {/* Guarantees grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-16">
          {guarantees.map(({ title, desc, icon: Icon, tag }) => (
            <div
              key={title}
              className="pixel-card border-2 border-[#1e2a45] p-6 space-y-5 hover:border-[#00b06f]/30 transition-colors group"
            >
              <div className="flex items-start justify-between">
                <div className="w-10 h-10 bg-[#00b06f]/10 border border-[#00b06f]/20 flex items-center justify-center group-hover:bg-[#00b06f]/15 transition-colors">
                  <Icon className="w-5 h-5 text-[#00b06f]" />
                </div>
                <span className="font-pixel text-[7px] text-[#00b06f]/50 border border-[#00b06f]/15 px-2 py-1">{tag}</span>
              </div>
              <div className="space-y-2">
                <h3 className="font-black uppercase tracking-tight">{title}</h3>
                <p className="text-sm text-zinc-500 font-medium leading-relaxed">{desc}</p>
              </div>
            </div>
          ))}
        </div>

        {/* CTA banner */}
        <div className="pixel-card border-2 border-[#00b06f]/30 bg-[#00b06f]/3 p-8 md:p-12 relative overflow-hidden">
          {/* Decorative background text */}
          <div
            className="absolute inset-0 flex items-center justify-center font-black text-[80px] md:text-[120px] uppercase tracking-tighter text-[#00b06f]/[0.03] pointer-events-none select-none whitespace-nowrap"
            aria-hidden
          >
            ROBLOX BANK
          </div>

          <div className="relative z-10 flex flex-col md:flex-row items-center justify-between gap-8 text-center md:text-left">
            <div className="space-y-3">
              <div className="font-pixel text-[9px] text-[#00b06f]/60 tracking-wider">JOIN US</div>
              <h2 className="text-2xl md:text-4xl font-black uppercase tracking-tight leading-tight">
                Тысячи игроков<br />выбирают нас каждый день
              </h2>
              <p className="text-zinc-500 text-sm font-medium">
                Присоединяйся к самому надёжному сервису в СНГ
              </p>
            </div>
            <Link
              href="/checkout"
              className="h-14 px-10 gold-gradient font-black text-sm uppercase tracking-widest text-white hover:opacity-90 active:scale-[0.97] transition-all rounded-none flex items-center gap-3 flex-shrink-0"
            >
              Купить Robux <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>
      <Footer />
    </main>
  );
}
