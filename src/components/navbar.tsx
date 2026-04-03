"use client";
import { useState } from "react";
import Link from "next/link";
import { User, ShoppingBag, ShieldCheck, Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";

export default function Navbar() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <nav className="sticky top-0 z-50 w-full glass border-b border-[#ffffff10]">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        <Link 
          href="/" 
          className="text-2xl font-bold gold-text flex items-center gap-2"
        >
          <ShoppingBag className="w-8 h-8 text-[#00f2fe]" />
          GUESS-SHOP
        </Link>

        {/* Desktop Menu */}
        <div className="hidden md:flex items-center gap-8">
          <Link href="/" className="text-sm font-medium hover:text-[#00f2fe] transition-colors">
            КУПИТЬ ROBUX
          </Link>
          <Link href="/reviews" className="text-sm font-medium hover:text-[#00f2fe] transition-colors">
            ОТЗЫВЫ
          </Link>
          <Link href="/faq" className="text-sm font-medium hover:text-[#00f2fe] transition-colors">
            F.A.Q.
          </Link>
          <Link href="/guarantees" className="text-sm font-medium hover:text-[#00f2fe] transition-colors flex items-center gap-1">
            <ShieldCheck className="w-4 h-4 text-emerald-500" />
            ГАРАНТИИ
          </Link>
        </div>

        <div className="flex items-center gap-2 md:gap-4">
          <Link 
            href="/admin" 
            className="p-2 rounded-full hover:bg-white/5 transition-all hidden md:block"
          >
            <User className="w-5 h-5 text-zinc-400 hover:text-white" />
          </Link>

          {/* Mobile Toggle */}
          <button 
            onClick={() => setIsOpen(!isOpen)}
            className="md:hidden p-2 text-zinc-400 hover:text-white transition-all"
          >
            {isOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {/* Mobile Menu Overlay */}
      {isOpen && (
        <div className="md:hidden absolute top-16 left-0 w-full glass border-b border-[#ffffff10] slide-down animate-in fade-in py-8 px-4 flex flex-col gap-6 z-40 bg-[#05070a]/95">
          <Link 
            href="/" 
            onClick={() => setIsOpen(false)}
            className="text-lg font-bold hover:text-[#00f2fe] flex items-center justify-between group"
          >
            КУПИТЬ ROBUX
            <ChevronRight className="w-5 h-5 opacity-0 group-hover:opacity-100 transition-all" />
          </Link>
          <Link 
            href="/reviews" 
            onClick={() => setIsOpen(false)}
            className="text-lg font-bold hover:text-[#00f2fe] flex items-center justify-between group"
          >
            ОТЗЫВЫ
            <ChevronRight className="w-5 h-5 opacity-0 group-hover:opacity-100 transition-all" />
          </Link>
          <Link 
            href="/faq" 
            onClick={() => setIsOpen(false)}
            className="text-lg font-bold hover:text-[#00f2fe] flex items-center justify-between group"
          >
            F.A.Q.
            <ChevronRight className="w-5 h-5 opacity-0 group-hover:opacity-100 transition-all" />
          </Link>
          <Link 
            href="/guarantees" 
            onClick={() => setIsOpen(false)}
            className="text-lg font-bold hover:text-[#00f2fe] flex items-center justify-between group"
          >
            ГАРАНТИИ
            <ChevronRight className="w-5 h-5 opacity-0 group-hover:opacity-100 transition-all" />
          </Link>
          <div className="h-px w-full bg-white/5 my-4" />
          <Link 
            href="/admin" 
            onClick={() => setIsOpen(false)}
            className="flex items-center gap-3 text-zinc-400 py-2 hover:text-white"
          >
            <User className="w-5 h-5" />
            Личный кабинет
          </Link>
        </div>
      )}
    </nav>
  );
}

function ChevronRight(props: any) {
  return (
    <svg 
      {...props} 
      xmlns="http://www.w3.org/2000/svg" 
      width="24" 
      height="24" 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round"
    >
      <path d="m9 18 6-6-6-6"/>
    </svg>
  );
}
