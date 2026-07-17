import Link from "next/link";
import PaymentMethods from "@/components/payment-methods";

const links = [
  { href: "/guide?source=site&amount=1000", label: "Инструкция" },
  { href: "/faq", label: "FAQ" },
  { href: "/guarantees", label: "Гарантии" },
  { href: "/reviews", label: "Отзывы" },
  { href: "/legal/offer", label: "Оферта" },
  { href: "/legal/policy", label: "Конфиденциальность" },
  { href: "/legal/details", label: "Реквизиты и контакты" },
];

export default function Footer() {
  return (
    <footer className="border-t border-[var(--rb-border)] bg-[var(--rb-footer)] text-[var(--rb-text)]">
      <div className="mx-auto max-w-[1240px] px-5 py-10 md:px-7">
        <div className="flex flex-col gap-7 md:flex-row md:items-center md:justify-between">
          <Link href="/" className="flex items-center gap-3">
            <span className="grid h-8 w-8 -rotate-6 place-items-center rounded-[10px] border-2 border-[var(--rb-text)] bg-[#7556e8] text-[13px] font-black text-white shadow-[2px_2px_0_#45d6aa]">R$</span>
            <span className="font-black tracking-[-0.03em]">ROBLOXBANK</span>
          </Link>
          <div className="flex flex-wrap gap-x-5 gap-y-3 text-base font-bold text-[var(--rb-muted)]">
            {links.map((item) => <Link key={item.href} href={item.href} className="hover:text-[var(--rb-accent)]">{item.label}</Link>)}
          </div>
        </div>
        <div className="mt-7 border-t border-[var(--rb-border)] pt-6">
          <p className="mb-3 text-sm font-black uppercase tracking-[0.08em] text-[var(--rb-muted)]">Платёжный партнёр и способы оплаты</p>
          <PaymentMethods showStatus />
        </div>
        <div className="mt-8 flex flex-col gap-3 border-t border-[var(--rb-border)] pt-6 text-base leading-relaxed text-[var(--rb-muted)] md:flex-row md:items-end md:justify-between">
          <p>ROBLOXBANK не связан с Roblox Corporation. Roblox и его логотип — торговые марки Roblox Corporation.</p>
          <a href="https://vk.me/club237309399" target="_blank" rel="noopener noreferrer" className="font-bold text-[#7556e8]">Сообщество ВКонтакте ↗</a>
        </div>
      </div>
    </footer>
  );
}
