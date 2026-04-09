"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { usePricing } from "@/hooks/usePricing";

// Pixel Robux icon — inline SVG to match Roblox aesthetic
function RobuxIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="9" y="2" width="6" height="3" fill="currentColor" />
      <rect x="6" y="5" width="3" height="3" fill="currentColor" />
      <rect x="15" y="5" width="3" height="3" fill="currentColor" />
      <rect x="3" y="8" width="3" height="8" fill="currentColor" />
      <rect x="18" y="8" width="3" height="8" fill="currentColor" />
      <rect x="6" y="16" width="3" height="3" fill="currentColor" />
      <rect x="15" y="16" width="3" height="3" fill="currentColor" />
      <rect x="9" y="19" width="6" height="3" fill="currentColor" />
      <rect x="6" y="8" width="6" height="6" fill="currentColor" />
    </svg>
  );
}

export default function Calculator() {
  const [robux, setRobux] = useState<string>("1000");
  const [rub, setRub] = useState<string>("");
  const { rubPerRobux, loading, getPrice } = usePricing();

  const displayRub = rub !== ""
    ? rub
    : getPrice(parseFloat(robux) || 0).toString();

  const handleRobuxChange = (val: string) => {
    setRobux(val);
    setRub(getPrice(parseFloat(val) || 0).toString());
  };

  const handleRubChange = (val: string) => {
    setRub(val);
    setRobux(
      rubPerRobux > 0
        ? Math.round((parseFloat(val) || 0) / rubPerRobux).toString()
        : "0"
    );
  };

  return (
    <div className="w-full max-w-xl mx-auto gold-glow pixel-card p-8 rounded-none relative">

      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-[#00b06f]/20 border border-[#00b06f]/30 flex items-center justify-center rounded-none">
            <RobuxIcon className="w-4 h-4 text-[#00b06f]" />
          </div>
          <div>
            <div className="text-[10px] font-pixel text-[#00b06f] tracking-wider">ROBLOX BANK</div>
            <div className="text-sm font-black uppercase tracking-widest text-zinc-300 mt-0.5">Калькулятор</div>
          </div>
        </div>
        {/* Live indicator */}
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-none bg-[#00b06f] animate-pulse block" />
          <span className="text-xs font-black uppercase tracking-widest text-[#00b06f]/70">Live курс</span>
        </div>
      </div>

      <div className="space-y-5">
        {/* Robux input */}
        <div className="space-y-2">
          <label className="text-xs font-black text-zinc-400 uppercase tracking-[0.2em]">
            Вы получите (Robux)
          </label>
          <div className="relative">
            <input
              type="number"
              value={robux}
              onChange={(e) => handleRobuxChange(e.target.value)}
              className="w-full h-16 bg-[#080c18] border-2 border-[#1e2a45] focus:border-[#00b06f]/60 rounded-none pl-5 pr-16 text-2xl font-black outline-none transition-all hover:border-[#1e2a45]/80 text-white"
              placeholder="0"
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-2xl font-black text-[#00b06f]">R$</span>
          </div>
        </div>

        {/* Arrow divider */}
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-[#1e2a45]" />
          <div className="w-8 h-8 border-2 border-[#1e2a45] bg-[#080c18] flex items-center justify-center rounded-none flex-shrink-0">
            <ChevronRight className="w-4 h-4 text-[#00b06f] rotate-90" />
          </div>
          <div className="flex-1 h-px bg-[#1e2a45]" />
        </div>

        {/* RUB input */}
        <div className="space-y-2">
          <label className="text-xs font-black text-zinc-400 uppercase tracking-[0.2em]">
            Вы потратите (рублей)
          </label>
          <div className="relative">
            <input
              type="number"
              value={loading ? "" : displayRub}
              onChange={(e) => handleRubChange(e.target.value)}
              className="w-full h-16 bg-[#080c18] border-2 border-[#1e2a45] focus:border-[#00b06f]/60 rounded-none px-5 text-2xl font-black outline-none transition-all hover:border-[#1e2a45]/80 text-white"
              placeholder={loading ? "Загрузка..." : "0"}
            />
            <span className="absolute right-5 top-1/2 -translate-y-1/2 text-2xl font-black text-zinc-600">₽</span>
          </div>
        </div>

        {/* Rate badge */}
        {!loading && rubPerRobux > 0 && (
          <div className="flex items-center justify-between px-3 py-2 bg-[#00b06f]/5 border border-[#00b06f]/15 rounded-none">
            <span className="text-xs font-black uppercase tracking-widest text-zinc-400">Текущий курс</span>
            <span className="text-[10px] font-pixel text-[#00b06f]">{rubPerRobux} ₽/R$</span>
          </div>
        )}

        {/* CTA */}
        <Link
          href={`/checkout?amount=${robux}`}
          className="w-full flex h-14 gold-gradient items-center justify-center gap-3 font-black text-sm uppercase tracking-widest text-white hover:opacity-90 active:scale-[0.98] transition-all rounded-none mt-2"
        >
          Перейти к оплате
          <ChevronRight className="w-4 h-4" />
        </Link>
      </div>

      <p className="mt-5 text-center text-xs text-zinc-500 uppercase tracking-widest">
        * Цена включает 30% комиссию Roblox
      </p>
    </div>
  );
}
