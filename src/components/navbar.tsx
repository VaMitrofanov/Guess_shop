import Link from "next/link";
import { User, ShoppingBag, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

export default function Navbar() {
  return (
    <nav className="sticky top-0 z-50 w-full glass border-b border-[#ffffff10]">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        <Link 
          href="/" 
          className="text-2xl font-bold gold-gradient bg-clip-text text-transparent flex items-center gap-2"
        >
          <ShoppingBag className="w-8 h-8 text-[#ffb800]" />
          ROBUX-VADI
        </Link>

        <div className="hidden md:flex items-center gap-8">
          <Link href="/" className="text-sm font-medium hover:text-[#ffb800] transition-colors">
            КУПИТЬ ROBUX
          </Link>
          <Link href="/reviews" className="text-sm font-medium hover:text-[#ffb800] transition-colors">
            ОТЗЫВЫ
          </Link>
          <Link href="/faq" className="text-sm font-medium hover:text-[#ffb800] transition-colors">
            F.A.Q.
          </Link>
          <Link href="/guarantees" className="text-sm font-medium hover:text-[#ffb800] transition-colors flex items-center gap-1">
            <ShieldCheck className="w-4 h-4 text-green-500" />
            ГАРАНТИИ
          </Link>
        </div>

        <div className="flex items-center gap-4">
          <Link 
            href="/admin" 
            className="p-2 rounded-full hover:bg-white/5 transition-all"
          >
            <User className="w-5 h-5 text-zinc-400 hover:text-white" />
          </Link>
        </div>
      </div>
    </nav>
  );
}
