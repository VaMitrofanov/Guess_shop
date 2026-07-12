"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { ArrowRight, Menu, User, X } from "lucide-react";
import { cn } from "@/lib/utils";

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
    <nav className="sticky top-0 z-50 border-b border-[#ded8f1] bg-[#fbfaff]/90 text-[#251b3f] backdrop-blur-xl">
      <div className="mx-auto flex h-[72px] max-w-[1280px] items-center justify-between px-5 md:px-7">
        <Link href="/" className="group flex items-center gap-3" aria-label="RobloxBank — главная">
          <span className="grid h-9 w-9 -rotate-6 place-items-center rounded-[11px] border-2 border-[#251b3f] bg-[#7556e8] text-sm font-black text-white shadow-[3px_3px_0_#45d6aa] transition-transform group-hover:rotate-0">R$</span>
          <span className="text-[15px] font-black tracking-[-0.04em] sm:text-[18px]">ROBLOXBANK</span>
        </Link>

        <div className="hidden items-center gap-1 md:flex">
          {NAV_LINKS.map((item) => {
            const active = pathname === (item.match ?? item.href);
            return (
              <Link key={item.href} href={item.href} className={cn("rounded-full px-4 py-2 text-sm font-bold transition-colors", active ? "bg-[#ece7ff] text-[#7556e8]" : "text-[#6f6782] hover:bg-white hover:text-[#251b3f]")}>{item.label}</Link>
            );
          })}
        </div>

        <div className="flex items-center gap-8">
          <Link href={loggedIn ? (isAdmin ? "/admin" : "/dashboard") : "/login"} className="hidden items-center gap-2 text-sm font-bold text-[#6f6782] transition-colors hover:text-[#7556e8] lg:flex">
            <User size={15} /> {loggedIn ? "Кабинет" : "Войти"}
          </Link>
          <Link href="/checkout?amount=1000" className="hidden h-11 items-center gap-2 rounded-xl bg-[#251b3f] px-4 text-sm font-extrabold text-white shadow-[3px_3px_0_#45d6aa] transition-transform hover:-translate-y-0.5 md:flex">
            Купить Robux <ArrowRight size={15} />
          </Link>
          <button type="button" onClick={() => setOpen((value) => !value)} className="grid h-10 w-10 place-items-center rounded-xl border border-[#dcd5ef] bg-white text-[#251b3f] md:hidden" aria-label={open ? "Закрыть меню" : "Открыть меню"}>
            {open ? <X size={19} /> : <Menu size={19} />}
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-[#e4def3] bg-[#fbfaff] px-5 py-4 md:hidden">
          <div className="mx-auto flex max-w-[620px] flex-col gap-1">
            {NAV_LINKS.map((item) => <Link key={item.href} href={item.href} onClick={() => setOpen(false)} className="rounded-xl px-4 py-3 text-sm font-bold text-[#635a78] hover:bg-[#ece7ff] hover:text-[#7556e8]">{item.label}</Link>)}
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Link href={loggedIn ? (isAdmin ? "/admin" : "/dashboard") : "/login"} onClick={() => setOpen(false)} className="flex h-11 items-center justify-center gap-2 rounded-xl border border-[#dcd5ef] bg-white text-sm font-bold"><User size={15} /> Кабинет</Link>
              <Link href="/checkout?amount=1000" onClick={() => setOpen(false)} className="flex h-11 items-center justify-center gap-2 rounded-xl bg-[#7556e8] text-sm font-bold text-white">Купить <ArrowRight size={15} /></Link>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
