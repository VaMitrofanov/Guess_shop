"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { User, ShieldCheck, Menu, X, BookOpen, ShoppingCart, MessageSquare, HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { NavbarLampGlow } from "@/components/ui/lamp";

const NAV_LINKS = [
  { href: "/",           label: "Купить",      icon: ShoppingCart, accent: false },
  { href: "/guide",      label: "Инструкция",  icon: BookOpen,     accent: false },
  { href: "/reviews",    label: "Отзывы",      icon: MessageSquare,accent: false },
  { href: "/faq",        label: "FAQ",          icon: HelpCircle,   accent: false },
  { href: "/guarantees", label: "Гарантии",    icon: ShieldCheck,  accent: false },
];

export default function Navbar() {
  const [isOpen, setIsOpen] = useState(false);
  const pathname = usePathname();
  const { data: session, status } = useSession();
  const isLoggedIn = status === "authenticated" && !!session?.user;
  const displayName = (session?.user as any)?.name ?? session?.user?.email?.split("@")[0] ?? "Кабинет";
  const isAdmin = (session?.user as any)?.role === "ADMIN";

  return (
    <nav className="sticky top-0 z-50 w-full border-b border-[#00b06f]/10 bg-[#0a0e1a]/90 backdrop-blur-xl relative">
      {/* Lamp glow effect — sits behind all navbar content */}
      <NavbarLampGlow />

      <div className="container mx-auto px-4 h-16 flex items-center justify-between relative z-10">

        {/* Logo — pixel block style */}
        <Link href="/" className="flex items-center gap-3 group">
          {/* Roblox-style block logo */}
          <div className="relative w-9 h-9 flex-shrink-0">
            <div className="absolute inset-0 bg-[#00b06f] rounded-[4px] group-hover:bg-[#00d084] transition-colors" />
            <div className="absolute top-0 right-0 w-2 h-2 bg-[#0a0e1a] rounded-none" />
            <div className="absolute bottom-0 left-0 w-2 h-2 bg-[#0a0e1a] rounded-none" />
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-white font-black text-[11px] tracking-wider relative z-10">RB</span>
            </div>
          </div>
          <div className="hidden sm:flex flex-col leading-none">
            <span className="text-[11px] font-black uppercase tracking-[0.2em] text-white">Roblox</span>
            <span className="text-[11px] font-black uppercase tracking-[0.2em] text-[#00b06f]">Bank</span>
          </div>
        </Link>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-1">
          {NAV_LINKS.map(({ href, label, icon: Icon, accent }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "px-4 py-2 text-[12px] font-black uppercase tracking-widest transition-all flex items-center gap-1.5 rounded-none border-b-2",
                  active
                    ? "border-[#00b06f] text-[#00b06f]"
                    : accent
                      ? "border-[#00b06f]/40 text-[#00b06f] hover:border-[#00b06f] hover:text-[#00d084]"
                      : "border-transparent text-zinc-300 hover:text-white hover:border-white/20"
                )}
              >
                {Icon && <Icon className="w-3.5 h-3.5" />}
                {label}
              </Link>
            );
          })}
        </div>

        {/* Right */}
        <div className="flex items-center gap-2">
          {isLoggedIn ? (
            <Link
              href={isAdmin ? "/admin" : "/dashboard"}
              className="hidden md:flex h-9 px-4 border border-[#00b06f]/30 bg-[#00b06f]/5 hover:border-[#00b06f]/60 items-center justify-center gap-2 transition-all rounded-none text-[#00b06f] text-[11px] font-black uppercase tracking-widest"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[#00b06f] animate-pulse flex-shrink-0" />
              {displayName}
            </Link>
          ) : (
            <Link
              href="/login"
              className="hidden md:flex h-9 px-4 border border-[#1e2a45] hover:border-[#00b06f]/40 items-center justify-center gap-2 transition-all rounded-none text-zinc-300 hover:text-[#00b06f] text-[11px] font-black uppercase tracking-widest"
            >
              <User className="w-3.5 h-3.5" />
              Кабинет
            </Link>
          )}

          <Link
            href="/checkout"
            className="hidden md:flex h-9 px-5 gold-gradient items-center justify-center font-black text-[11px] uppercase tracking-widest text-white hover:opacity-90 active:scale-[0.97] transition-all rounded-none"
          >
            Купить R$
          </Link>

          <button
            onClick={() => setIsOpen(!isOpen)}
            className="md:hidden w-9 h-9 border border-[#1e2a45] flex items-center justify-center text-zinc-400 hover:text-white hover:border-[#00b06f]/40 transition-all rounded-none"
          >
            {isOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Accent separator line */}
      <div className="accent-line" />

      {/* Mobile menu */}
      {isOpen && (
        <div className="md:hidden border-t border-[#00b06f]/10 bg-[#0a0e1a] animate-in fade-in slide-in-from-top-2 duration-150">
          <div className="container mx-auto px-4 py-4 flex flex-col gap-0.5">
            {NAV_LINKS.map(({ href, label, icon: Icon, accent }) => {
              const active = pathname === href;
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setIsOpen(false)}
                  className={cn(
                    "flex items-center justify-between px-4 py-3 font-black text-[13px] uppercase tracking-widest transition-all border-l-2",
                    active
                      ? "border-[#00b06f] text-[#00b06f] bg-[#00b06f]/5"
                      : accent
                        ? "border-transparent text-[#00b06f]/60 hover:border-[#00b06f]/40 hover:text-[#00b06f]"
                        : "border-transparent text-zinc-400 hover:border-white/20 hover:text-white"
                  )}
                >
                  <div className="flex items-center gap-2">
                    {Icon && <Icon className="w-4 h-4" />}
                    {label}
                  </div>
                  <span className="text-[10px] opacity-40">→</span>
                </Link>
              );
            })}
            {isLoggedIn ? (
              <Link
                href={isAdmin ? "/admin" : "/dashboard"}
                onClick={() => setIsOpen(false)}
                className="flex items-center justify-between px-4 py-3 font-black text-[13px] uppercase tracking-widest border-l-2 border-[#00b06f]/40 text-[#00b06f] bg-[#00b06f]/5 transition-all"
              >
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[#00b06f] animate-pulse" />
                  {displayName}
                </div>
                <span className="text-[10px] opacity-40">→</span>
              </Link>
            ) : (
              <Link
                href="/login"
                onClick={() => setIsOpen(false)}
                className="flex items-center justify-between px-4 py-3 font-black text-[13px] uppercase tracking-widest border-l-2 border-transparent text-zinc-400 hover:border-white/20 hover:text-white transition-all"
              >
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4" />
                  Личный кабинет
                </div>
                <span className="text-[10px] opacity-40">→</span>
              </Link>
            )}
            <div className="pt-3">
              <Link
                href="/checkout"
                onClick={() => setIsOpen(false)}
                className="w-full h-12 gold-gradient flex items-center justify-center font-black text-[13px] uppercase tracking-widest text-white rounded-none"
              >
                Купить Robux
              </Link>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
