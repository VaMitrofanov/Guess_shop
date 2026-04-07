"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { User, ShieldCheck, Menu, X, BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_LINKS = [
  { href: "/", label: "Купить" },
  { href: "/guide", label: "Инструкция", icon: BookOpen, accent: true },
  { href: "/reviews", label: "Отзывы" },
  { href: "/faq", label: "FAQ" },
  { href: "/guarantees", label: "Гарантии", icon: ShieldCheck },
];

export default function Navbar() {
  const [isOpen, setIsOpen] = useState(false);
  const pathname = usePathname();

  return (
    <nav className="sticky top-0 z-50 w-full border-b border-[#00b06f]/10 bg-[#0a0e1a]/90 backdrop-blur-xl">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">

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
                  "px-4 py-2 text-xs font-black uppercase tracking-widest transition-all flex items-center gap-1.5 rounded-none border-b-2",
                  active
                    ? "border-[#00b06f] text-[#00b06f]"
                    : accent
                      ? "border-transparent text-[#00b06f]/60 hover:text-[#00b06f] hover:border-[#00b06f]/30"
                      : "border-transparent text-zinc-400 hover:text-white hover:border-white/20"
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
          <Link
            href="/register"
            className="hidden md:flex w-9 h-9 border border-[#1e2a45] hover:border-[#00b06f]/40 items-center justify-center transition-all rounded-none"
          >
            <User className="w-4 h-4 text-zinc-500 hover:text-[#00b06f]" />
          </Link>

          <Link
            href="/checkout"
            className="hidden md:flex h-9 px-5 gold-gradient items-center justify-center font-black text-[10px] uppercase tracking-widest text-white hover:opacity-90 active:scale-[0.97] transition-all rounded-none"
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

      {/* Pixel progress line */}
      <div className="rb-progress">
        <div className="rb-progress-fill" style={{ width: "100%" }} />
      </div>

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
                    "flex items-center justify-between px-4 py-3 font-black text-sm uppercase tracking-widest transition-all border-l-2",
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
            <div className="pt-3">
              <Link
                href="/checkout"
                onClick={() => setIsOpen(false)}
                className="w-full h-12 gold-gradient flex items-center justify-center font-black text-sm uppercase tracking-widest text-white rounded-none"
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
