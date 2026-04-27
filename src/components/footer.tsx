"use client";

import Link from "next/link";

export default function Footer() {
  // Two link buckets so the layout stays balanced as we add more legal docs
  // (e.g. user agreement, cookie policy). Marketing/utility links on top
  // row, legal-required docs below.
  const navLinks = [
    { href: "/guide", label: "Инструкция" },
    { href: "/faq", label: "FAQ" },
    { href: "/guarantees", label: "Гарантии" },
    { href: "/reviews", label: "Отзывы" },
  ];

  const legalLinks = [
    { href: "/legal/offer", label: "Публичная оферта" },
    { href: "/legal/policy", label: "Политика конфиденциальности" },
  ];

  return (
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
            <div className="font-pixel text-[9px] text-[#00b06f] tracking-wider uppercase">
              Roblox Bank
            </div>
          </div>

          <div className="flex flex-wrap justify-center items-center gap-x-6 gap-y-2 text-xs font-black uppercase tracking-widest text-zinc-500">
            {navLinks.map(({ href, label }) => (
              <Link key={href} href={href} className="hover:text-[#00b06f] transition-colors">
                {label}
              </Link>
            ))}
          </div>
        </div>

        <div className="accent-line mb-6" />

        {/* Legal row — separated visually from nav links so users (and
            regulators) immediately see the offer + privacy policy links
            required by ФЗ-152 / ЗоЗПП. */}
        <div className="flex flex-wrap justify-center items-center gap-x-6 gap-y-2 mb-6 text-[10px] font-black uppercase tracking-widest text-zinc-500">
          {legalLinks.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className="hover:text-[#00b06f] transition-colors"
            >
              {label}
            </Link>
          ))}
        </div>

        <div className="text-center space-y-2">
          <p className="text-zinc-500 text-[10px] font-medium uppercase tracking-widest">
            ROBLOX BANK не связан с Roblox Corporation
          </p>
          <p className="text-zinc-600 text-[10px] max-w-xl mx-auto uppercase tracking-tighter opacity-50">
            Roblox и логотип Roblox — зарегистрированные торговые марки Roblox Corporation
          </p>
          <div className="pt-2">
            <a
              href="https://vk.ru/bankroblox"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#00b06f] text-[10px] font-black uppercase tracking-widest hover:underline"
            >
              Наше сообщество ВК
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
