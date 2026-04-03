"use client";

import { useState, useEffect } from "react";
import { Coins, Diamond, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import Link from "next/link";

export default function Calculator() {
  const [robux, setRobux] = useState<string>("1000");
  const [rub, setRub] = useState<string>("850");
  const RATE = 0.85;

  const handleRobuxChange = (val: string) => {
    setRobux(val);
    const amount = parseFloat(val) || 0;
    setRub(Math.round(amount * RATE).toString());
  };

  const handleRubChange = (val: string) => {
    setRub(val);
    const amount = parseFloat(val) || 0;
    setRobux(Math.round(amount / RATE).toString());
  };

  return (
    <div className="w-full max-w-xl mx-auto glass p-8 rounded-3xl gold-glow border border-[#ffffff10]">
      <div className="flex items-center gap-2 mb-8">
        <Diamond className="w-6 h-6 text-[#00f2fe] fill-[#00f2fe]/20" />
        <h2 className="text-xl font-bold tracking-tight uppercase">Авто-Калькулятор</h2>
      </div>

      <div className="space-y-6">
        <div className="space-y-3">
          <label className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] ml-1">Вы получите (Robux)</label>
          <div className="relative group">
            <input
              type="number"
              value={robux}
              onChange={(e) => handleRobuxChange(e.target.value)}
              className="w-full h-16 bg-[#05070a]/80 backdrop-blur-xl border border-white/5 rounded-2xl px-6 text-2xl font-black outline-none focus:border-[#00f2fe]/40 transition-all group-hover:border-white/10"
              placeholder="0"
            />
            <Coins className="absolute right-6 top-1/2 -translate-y-1/2 w-6 h-6 text-[#00f2fe] drop-shadow-[0_0_8px_rgba(0,242,254,0.5)]" />
          </div>
        </div>

        <div className="flex justify-center items-center -my-2 relative z-10">
            <div className="w-10 h-10 rounded-full bg-[#0a0a0b] border border-white/10 flex items-center justify-center shadow-2xl">
                <ChevronRight className="w-5 h-5 text-zinc-600 rotate-90" />
            </div>
        </div>

        <div className="space-y-3">
          <label className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] ml-1">Вы потратите (RUB)</label>
          <div className="relative group">
            <input
              type="number"
              value={rub}
              onChange={(e) => handleRubChange(e.target.value)}
              className="w-full h-16 bg-[#05070a]/80 backdrop-blur-xl border border-white/5 rounded-2xl px-6 text-2xl font-black outline-none focus:border-[#00f2fe]/40 transition-all group-hover:border-white/10"
              placeholder="0"
            />
            <span className="absolute right-6 top-1/2 -translate-y-1/2 text-2xl font-black text-zinc-700">₽</span>
          </div>
        </div>

        <Link
          href={`/checkout?amount=${robux}`}
          className="w-full block h-16 gold-gradient rounded-2xl flex items-center justify-center gap-3 font-black text-sm uppercase tracking-widest text-black hover:scale-[1.02] active:scale-[0.98] transition-all shadow-xl shadow-[#00f2fe]/10 mt-4"
        >
          ПЕРЕЙТИ К ОПЛАТЕ <ChevronRight className="w-4 h-4" />
        </Link>
      </div>
      
      <p className="mt-6 text-center text-xs text-zinc-500">
        * Цена зависит от способа доставки и текущего курса.
      </p>
    </div>
  );
}
