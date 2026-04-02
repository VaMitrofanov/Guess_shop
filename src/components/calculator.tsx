"use client";

import { useState, useEffect } from "react";
import { Coins, Flame, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import Link from "next/link";

export default function Calculator() {
  const [robux, setRobux] = useState<string>("1000");
  const [rub, setRub] = useState<number>(0);
  const RATE = 0.85; // 1 Robux = 0.85 RUB (Placeholder)

  useEffect(() => {
    const amount = parseInt(robux) || 0;
    setRub(Math.round(amount * RATE));
  }, [robux]);

  return (
    <div className="w-full max-w-xl mx-auto glass p-8 rounded-3xl gold-glow border border-[#ffffff10]">
      <div className="flex items-center gap-2 mb-8">
        <Flame className="w-6 h-6 text-[#ffb800] fill-[#ffb800]" />
        <h2 className="text-xl font-bold tracking-tight">КАЛЬКУЛЯТОР ROBUX</h2>
      </div>

      <div className="space-y-6">
        <div className="space-y-2">
          <label className="text-sm font-medium text-zinc-400 ml-1">Вы получите (Robux)</label>
          <div className="relative group">
            <input
              type="number"
              value={robux}
              onChange={(e) => setRobux(e.target.value)}
              className="w-full h-16 bg-[#0a0a0b] border border-white/5 rounded-2xl px-6 pt-2 text-2xl font-bold outline-none focus:border-[#ffb800]/50 transition-all group-hover:border-white/10"
              placeholder="0"
            />
            <Coins className="absolute right-6 top-1/2 -translate-y-1/2 w-6 h-6 text-[#ffb800]" />
          </div>
        </div>

        <div className="flex justify-center items-center py-2">
          <div className="w-12 h-12 rounded-full glass flex items-center justify-center">
            <ChevronRight className="w-6 h-6 text-zinc-600 rotate-90" />
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-zinc-400 ml-1">К оплате (RUB)</label>
          <div className="relative">
            <div className="w-full h-16 bg-[#ffffff05] border border-white/5 rounded-2xl px-6 pt-4 text-2xl font-black text-[#ffb800]">
              {rub.toLocaleString("ru-RU")} <span className="text-sm font-medium text-zinc-500">₽</span>
            </div>
          </div>
        </div>

        <Link
          href={`/checkout?amount=${robux}`}
          className="w-full block h-16 gold-gradient rounded-2xl flex items-center justify-center gap-2 font-bold text-lg text-black hover:scale-[1.02] active:scale-[0.98] transition-all shadow-lg shadow-[#ffb800]/20"
        >
          КУПИТЬ СЕЙЧАС
        </Link>
      </div>
      
      <p className="mt-6 text-center text-xs text-zinc-500">
        * Цена зависит от способа доставки и текущего курса.
      </p>
    </div>
  );
}
