import Link from "next/link";
import Navbar from "@/components/navbar";
import Calculator from "@/components/calculator";
import { Zap, ShieldCheck, Clock, TrendingUp, Users, Check, Star } from "lucide-react";

// Pixel Robux icon
function RobuxIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none">
      <rect x="9" y="2" width="6" height="3" fill="currentColor" />
      <rect x="6" y="5" width="3" height="3" fill="currentColor" />
      <rect x="15" y="5" width="3" height="3" fill="currentColor" />
      <rect x="3" y="8" width="3" height="8" fill="currentColor" />
      <rect x="18" y="8" width="3" height="8" fill="currentColor" />
      <rect x="6" y="16" width="3" height="3" fill="currentColor" />
      <rect x="15" y="16" width="3" height="3" fill="currentColor" />
      <rect x="9" y="19" width="6" height="3" fill="currentColor" />
      <rect x="6" y="8" width="6" height="6" fill="currentColor" />
    </svg>
  );
}

// Floating pixel block decoration
function PixelBlocks() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
      {[
        { size: 12, top: "15%", left: "8%", delay: "0s", color: "#00b06f" },
        { size: 8, top: "25%", right: "10%", delay: "1s", color: "#00b06f" },
        { size: 16, top: "60%", left: "5%", delay: "2s", color: "#3b82f6" },
        { size: 10, top: "70%", right: "8%", delay: "0.5s", color: "#00b06f" },
        { size: 6, top: "40%", left: "92%", delay: "1.5s", color: "#6366f1" },
        { size: 14, top: "80%", left: "15%", delay: "3s", color: "#00b06f" },
      ].map(({ size, top, left, right, delay, color }, i) => (
        <div
          key={i}
          className="pixel-float absolute opacity-20"
          style={{
            width: size, height: size,
            top, left, right,
            backgroundColor: color,
            animationDelay: delay,
            borderRadius: 0,
          }}
        />
      ))}
    </div>
  );
}

export default function Home() {
  return (
    <main className="min-h-screen">
      <Navbar />

      {/* ── HERO ─────────────────────────────────────────────── */}
      <section className="relative pt-16 pb-24 overflow-hidden scanlines">
        <PixelBlocks />

        {/* Subtle grid */}
        <div
          className="absolute inset-0 opacity-[0.025] pointer-events-none"
          style={{
            backgroundImage: `linear-gradient(rgba(0,176,111,0.8) 1px, transparent 1px),
                              linear-gradient(90deg, rgba(0,176,111,0.8) 1px, transparent 1px)`,
            backgroundSize: "40px 40px",
          }}
        />

        <div className="container mx-auto px-4 relative z-10">

          {/* Status badge */}
          <div className="flex justify-center mb-10">
            <div className="inline-flex items-center gap-2 px-4 py-2 border border-[#00b06f]/20 bg-[#00b06f]/5 text-[#00b06f] text-xs font-black uppercase tracking-[0.15em] rounded-none">
              <span className="w-1.5 h-1.5 bg-[#00b06f] animate-pulse block rounded-none" />
              Система активна · Заказы обрабатываются
            </div>
          </div>

          {/* Main headline */}
          <div className="text-center max-w-5xl mx-auto mb-4 space-y-6">

            <h1 className="text-5xl md:text-7xl lg:text-8xl font-black tracking-[-0.04em] leading-[0.88] uppercase">
              Купи{" "}
              <span className="inline-flex items-center gap-3">
                <RobuxIcon className="w-12 h-12 md:w-16 md:h-16 text-[#00b06f] coin-spin inline-block" />
                <span className="gold-text">Robux</span>
              </span>
              <br />
              <span className="text-4xl md:text-6xl text-zinc-300">быстро и безопасно</span>
            </h1>

            <p className="text-zinc-400 text-lg font-medium max-w-lg mx-auto leading-relaxed">
              Официальный курс обновляется каждые 10 минут.
              Доставка через геймпасс — без ввода пароля.
            </p>
          </div>

          {/* Calculator */}
          <div className="max-w-lg mx-auto mb-14 mt-12">
            <Calculator />
          </div>

          {/* Trust row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 max-w-3xl mx-auto">
            {[
              { icon: Zap, label: "~10 мин", sub: "Время доставки" },
              { icon: ShieldCheck, label: "Гарантия", sub: "Возврат денег" },
              { icon: RobuxIcon, label: "5 000+ заказов", sub: "С 2024 года" },
              { icon: TrendingUp, label: "Лучший курс", sub: "Авто-обновление" },
            ].map(({ icon: Icon, label, sub }) => (
              <div key={label} className="pixel-card p-4 flex flex-col items-center gap-2 text-center rounded-none">
                <Icon className="w-5 h-5 text-[#00b06f]" />
                <span className="text-xs font-black uppercase tracking-wider text-white">{label}</span>
                <span className="text-xs text-zinc-500 uppercase tracking-wider">{sub}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Glow orb */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[400px] rounded-full bg-[#00b06f]/[0.03] blur-[100px] pointer-events-none" />
      </section>

      <div className="accent-line" />

      {/* ── STATS BAR ────────────────────────────────────────── */}
      <section className="py-12 bg-[#0a0e1a]">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-3 gap-6 max-w-2xl mx-auto">
            {[
              { value: "5 247", label: "Выполнено заказов", pixel: true },
              { value: "99.8%", label: "Успешных сделок", pixel: true },
              { value: "~10 мин", label: "Среднее время", pixel: true },
            ].map(({ value, label }) => (
              <div key={label} className="text-center space-y-2">
                <div className="font-pixel text-[#00b06f] text-sm md:text-base">{value}</div>
                <div className="text-xs font-black uppercase tracking-wider text-zinc-400">{label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="accent-line" />

      {/* ── HOW IT WORKS ─────────────────────────────────────── */}
      <section className="py-20 bg-[#080c18]">
        <div className="container mx-auto px-4 max-w-4xl">
          <div className="flex items-center gap-4 mb-14">
            <div className="h-px flex-1 bg-[#1e2a45]" />
            <div className="text-center space-y-1">
              <div className="font-pixel text-[10px] text-[#00b06f]/60 tracking-wider">TUTORIAL</div>
              <h2 className="text-2xl md:text-3xl font-black uppercase tracking-tight">Как это работает</h2>
            </div>
            <div className="h-px flex-1 bg-[#1e2a45]" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              {
                step: "01",
                icon: "🎮",
                title: "Создай геймпасс",
                desc: "Открой Roblox Creator Hub, создай геймпасс в своей игре и установи нужную цену.",
                link: "/guide",
                cta: "Смотреть инструкцию",
                color: "#00b06f",
              },
              {
                step: "02",
                icon: "💳",
                title: "Оформи заказ",
                desc: "Введи ник, найди геймпасс через поиск, оплати удобным способом.",
                link: "/checkout",
                cta: "Оформить заказ",
                color: "#3b82f6",
              },
              {
                step: "03",
                icon: "⚡",
                title: "Получи Robux",
                desc: "Наш бот купит твой геймпасс. Robux поступят через 5–7 дней по правилам Roblox.",
                link: null,
                cta: null,
                color: "#00b06f",
              },
            ].map(({ step, icon, title, desc, link, cta, color }) => (
              <div key={step} className="pixel-card p-6 space-y-4 rounded-none">
                <div className="flex items-center justify-between">
                  <span className="font-pixel text-[10px] tracking-wider" style={{ color }}>{step}</span>
                  <span className="text-2xl">{icon}</span>
                </div>
                <div className="rb-progress">
                  <div className="rb-progress-fill" style={{ width: step === "01" ? "33%" : step === "02" ? "66%" : "100%", background: color }} />
                </div>
                <h3 className="text-lg font-black uppercase tracking-tight">{title}</h3>
                <p className="text-sm text-zinc-400 font-medium leading-relaxed">{desc}</p>
                {link && (
                  <Link href={link} className="text-xs font-black uppercase tracking-widest hover:opacity-70 transition-opacity flex items-center gap-1" style={{ color }}>
                    {cta} →
                  </Link>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="accent-line" />

      {/* ── WHY US ───────────────────────────────────────────── */}
      <section className="py-20 bg-[#0a0e1a]">
        <div className="container mx-auto px-4 max-w-4xl">
          <div className="flex items-center gap-4 mb-14">
            <div className="h-px flex-1 bg-[#1e2a45]" />
            <div className="text-center space-y-1">
              <div className="font-pixel text-[10px] text-[#00b06f]/60 tracking-wider">PERKS</div>
              <h2 className="text-2xl md:text-3xl font-black uppercase tracking-tight">Почему мы</h2>
            </div>
            <div className="h-px flex-1 bg-[#1e2a45]" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              {
                title: "Прямые поставки",
                desc: "Работаем напрямую с поставщиками Robux. Никаких посредников — только честная цена.",
                tag: "OFFICIAL",
              },
              {
                title: "Гарантия возврата",
                desc: "Если заказ не выполнен в срок — возвращаем деньги без вопросов.",
                tag: "ГАРАНТИЯ",
              },
              {
                title: "Полная автоматизация",
                desc: "Заказы обрабатываются системой круглосуточно. Мгновенно после оплаты.",
                tag: "24/7",
              },
              {
                title: "Без скрытых комиссий",
                desc: "Цена в калькуляторе — финальная. Налог Roblox уже учтён в стоимости.",
                tag: "ЧЕСТНО",
              },

            ].map(({ title, desc, tag }) => (
              <div key={title} className="glass border border-[#1e2a45] hover:border-[#00b06f]/20 transition-colors p-6 flex gap-4 rounded-none">
                <div className="w-2 h-full min-h-[60px] bg-[#00b06f]/20 flex-shrink-0 relative">
                  <div className="absolute top-0 left-0 w-full h-1/2 bg-[#00b06f]" />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <h3 className="font-black uppercase tracking-tight text-sm">{title}</h3>
                    <span className="font-pixel text-[9px] text-[#00b06f]/60 border border-[#00b06f]/20 px-1.5 py-0.5">{tag}</span>
                  </div>
                  <p className="text-sm text-zinc-400 font-medium leading-relaxed">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="accent-line" />

      {/* ── CTA ──────────────────────────────────────────────── */}
      <section className="py-20 bg-[#080c18] relative overflow-hidden">
        <PixelBlocks />
        <div className="container mx-auto px-4 max-w-2xl text-center space-y-8 relative z-10">
          <div className="font-pixel text-[10px] text-[#00b06f]/60 tracking-wider">READY?</div>
          <h2 className="text-4xl md:text-6xl font-black uppercase tracking-[-0.03em] leading-tight">
            Начни<br />
            <span className="gold-text flex items-center justify-center gap-3">
              <RobuxIcon className="w-10 h-10 coin-spin" />
              прямо сейчас
            </span>
          </h2>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/checkout"
              className="h-14 px-10 gold-gradient flex items-center justify-center font-black text-sm uppercase tracking-widest text-white hover:opacity-90 active:scale-[0.97] transition-all rounded-none"
            >
              Купить Robux
            </Link>
            <Link
              href="/guide"
              className="h-14 px-10 border-2 border-[#1e2a45] hover:border-[#00b06f]/30 flex items-center justify-center font-black text-sm uppercase tracking-widest hover:text-[#00b06f] transition-all rounded-none"
            >
              Инструкция
            </Link>
          </div>
        </div>
      </section>

      {/* ── FOOTER ───────────────────────────────────────────── */}
      <footer className="border-t border-[#00b06f]/8 py-10 bg-[#06080f]">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6 mb-6">
            <div className="flex items-center gap-3">
              <div className="relative w-8 h-8 flex-shrink-0">
                <div className="absolute inset-0 bg-[#00b06f] rounded-none" />
                <div className="absolute top-0 right-0 w-2 h-2 bg-[#06080f]" />
                <div className="absolute bottom-0 left-0 w-2 h-2 bg-[#06080f]" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-white font-black text-[10px]">RB</span>
                </div>
              </div>
              <div className="font-pixel text-[9px] text-[#00b06f] tracking-wider">ROBLOX BANK</div>
            </div>

            <div className="flex items-center gap-5 text-xs font-black uppercase tracking-widest text-zinc-500">
              {[
                { href: "/guide", label: "Инструкция" },
                { href: "/faq", label: "FAQ" },
                { href: "/guarantees", label: "Гарантии" },
                { href: "/reviews", label: "Отзывы" },
              ].map(({ href, label }) => (
                <Link key={href} href={href} className="hover:text-[#00b06f] transition-colors">
                  {label}
                </Link>
              ))}
            </div>
          </div>

          <div className="accent-line mb-6" />

          <div className="text-center space-y-1.5">
            <p className="text-zinc-500 text-xs font-medium uppercase tracking-widest">
              ROBLOX BANK не связан с Roblox Corporation
            </p>
            <p className="text-zinc-600 text-xs max-w-xl mx-auto">
              Roblox и логотип Roblox — зарегистрированные торговые марки Roblox Corporation
            </p>
          </div>
        </div>
      </footer>
    </main>
  );
}
