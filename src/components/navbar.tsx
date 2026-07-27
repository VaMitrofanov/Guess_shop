"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { ArrowRight, Menu, User, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme-toggle";

const NAV_LINKS = [
  { href: "/", label: "Купить" },
  { href: "/guide?source=site&amount=1000", match: "/guide", label: "Инструкция" },
  { href: "/guarantees", label: "Гарантии" },
  { href: "/reviews", label: "Отзывы" },
  { href: "/faq", label: "Помощь" },
];

export default function Navbar() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const { data: session, status } = useSession();
  const loggedIn = status === "authenticated" && !!session?.user;
  const isAdmin = (session?.user as { role?: string } | undefined)?.role === "ADMIN";

  return (
    <nav className="sticky top-0 z-50 border-b border-[var(--rb-border)] bg-[var(--rb-nav)] text-[var(--rb-text)] backdrop-blur-xl">
      <div className="mx-auto flex h-[72px] max-w-[1280px] items-center justify-between px-5 md:px-7">
        <Link href="/" className="group flex items-center gap-3" aria-label="RobloxBank — главная">
          <span className="grid h-9 w-9 -rotate-6 place-items-center rounded-[11px] border-2 border-[var(--rb-text)] bg-[#7556e8] text-sm font-black text-white shadow-[3px_3px_0_#45d6aa] transition-transform group-hover:rotate-0">R$</span>
          <span className="text-[15px] font-black tracking-[-0.04em] sm:text-[18px]">ROBLOXBANK</span>
        </Link>

        <div className="hidden items-center gap-1 md:flex">
          {NAV_LINKS.map((item) => {
            const active = pathname === (item.match ?? item.href);
            return (
              <Link key={item.href} href={item.href} className={cn("rounded-full px-4 py-2 text-base font-bold transition-colors", active ? "bg-[var(--rb-accent-soft)] text-[var(--rb-accent)]" : "text-[var(--rb-muted)] hover:bg-[var(--rb-surface)] hover:text-[var(--rb-text)]")}>{item.label}</Link>
            );
          })}
        </div>

        <div className="flex items-center gap-3 lg:gap-6">
          <ThemeToggle compact />
          {/* D2: ссылка была `lg:flex`, а бургер — `md:hidden`, поэтому на
              768–1023 px (все iPad в портрете) в личный кабинет было не попасть
              вообще. На md показываем иконку, подпись возвращаем с lg. */}
          <Link href={loggedIn ? (isAdmin ? "/admin" : "/dashboard") : "/login"} aria-label={loggedIn ? "Личный кабинет" : "Войти"} className="hidden items-center gap-2 text-sm font-bold text-[var(--rb-muted)] transition-colors hover:text-[var(--rb-accent)] md:flex">
            <User size={15} /> <span className="hidden lg:inline">{loggedIn ? "Кабинет" : "Войти"}</span>
          </Link>
          <Link href="/#calculator" className="hidden h-11 items-center gap-2 rounded-xl bg-[var(--rb-strong)] px-4 text-base font-extrabold text-white shadow-[3px_3px_0_#45d6aa] transition-transform hover:-translate-y-0.5 md:flex">
            Купить Robux <ArrowRight size={15} />
          </Link>
          <button type="button" onClick={() => setOpen((value) => !value)} className="grid h-10 w-10 place-items-center rounded-xl border border-[var(--rb-border)] bg-[var(--rb-surface)] text-[var(--rb-text)] md:hidden" aria-label={open ? "Закрыть меню" : "Открыть меню"}>
            {open ? <X size={19} /> : <Menu size={19} />}
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-[var(--rb-border)] bg-[var(--rb-bg)] px-5 py-4 md:hidden">
          <div className="mx-auto flex max-w-[620px] flex-col gap-1">
            {NAV_LINKS.map((item) => <Link key={item.href} href={item.href} onClick={() => setOpen(false)} className="rounded-xl px-4 py-3 text-sm font-bold text-[var(--rb-muted)] hover:bg-[var(--rb-accent-soft)] hover:text-[var(--rb-accent)]">{item.label}</Link>)}
            {/* D1: здесь были литеральные `bg-white` и `border-[#dcd5ef]` без
                цвета текста — он наследовался от `--rb-text`, и в тёмной теме
                получался белый текст на белом фоне (контраст ≈1.05:1).
                D7: подпись была всегда «Кабинет», даже когда клиент не вошёл.
                Цвета публичного шелла — только через токены `--rb-*`. */}
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Link href={loggedIn ? (isAdmin ? "/admin" : "/dashboard") : "/login"} onClick={() => setOpen(false)} className="flex h-11 items-center justify-center gap-2 rounded-xl border border-[var(--rb-border)] bg-[var(--rb-surface)] text-sm font-bold text-[var(--rb-text)]"><User size={15} /> {loggedIn ? "Кабинет" : "Войти"}</Link>
              <Link href="/#calculator" onClick={() => setOpen(false)} className="flex h-11 items-center justify-center gap-2 rounded-xl bg-[var(--rb-strong)] text-base font-bold text-white">Купить <ArrowRight size={15} /></Link>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
