import Image from "next/image";
import Link from "next/link";
import Navbar from "@/components/navbar";
import Calculator from "@/components/calculator";
import { ShoppingBag, Zap, ShieldCheck, Clock, Check } from "lucide-react";

const products = [
  { id: '1', name: 'НАБОР НОВИЧКА', robux: 400, rub: 340, type: 'Gamepass' },
  { id: '2', name: 'НАБОР ГЕЙМЕРА', robux: 800, rub: 680, type: 'Gamepass' },
  { id: '3', name: 'ПРО-ПАКЕТ', robux: 1700, rub: 1445, type: 'Group Funds' },
  { id: '4', name: 'ЛЕГЕНДАРНЫЙ НАБОР', robux: 4500, rub: 3825, type: 'Group Funds' },
];

export default function Home() {
  return (
    <main className="min-h-screen selection:bg-[#ffb800] selection:text-black">
      <Navbar />
      
      {/* Hero Section */}
      <section className="relative pt-24 pb-32 overflow-hidden">
        <div className="container mx-auto px-4 relative z-10 flex flex-col items-center gap-16">
          <div className="text-center space-y-6 max-w-3xl">
            <h1 className="text-5xl md:text-7xl font-black tracking-tight leading-tight uppercase">
              Лучший способ купить <span className="gold-gradient bg-clip-text text-transparent italic">Robux</span>
            </h1>
            <p className="text-zinc-400 text-lg md:text-xl font-medium tracking-wide">
              Быстрая доставка, надежные платежи и лучший курс на рынке с 2024 года.
            </p>
          </div>

          <Calculator />

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-8 w-full max-w-4xl">
            <div className="bg-white/5 p-4 rounded-2xl flex flex-col items-center gap-2 text-center">
              <Zap className="w-5 h-5 text-yellow-500" />
              <span className="text-xs font-bold uppercase tracking-widest text-zinc-500">Быстрая доставка</span>
            </div>
            <div className="bg-white/5 p-4 rounded-2xl flex flex-col items-center gap-2 text-center">
              <ShieldCheck className="w-5 h-5 text-green-500" />
              <span className="text-xs font-bold uppercase tracking-widest text-zinc-500">Безопасно</span>
            </div>
            <div className="bg-white/5 p-4 rounded-2xl flex flex-col items-center gap-2 text-center">
              <Clock className="w-5 h-5 text-blue-500" />
              <span className="text-xs font-bold uppercase tracking-widest text-zinc-500">Поддержка 24/7</span>
            </div>
            <div className="bg-white/5 p-4 rounded-2xl flex flex-col items-center gap-2 text-center">
              <Check className="w-5 h-5 text-indigo-500" />
              <span className="text-xs font-bold uppercase tracking-widest text-zinc-500">Фикс. курс</span>
            </div>
          </div>
        </div>
        
        {/* Decorative elements */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[120%] h-full opacity-10 pointer-events-none">
          <Image 
            src="/hero.png" 
            alt="Hero Background" 
            fill 
            className="object-cover blur-[80px]" 
            priority
          />
        </div>
      </section>

      {/* Products Section */}
      <section className="bg-[#0e0e10] pt-24 pb-48">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-8 mb-16">
            <div className="space-y-4">
              <span className="text-[#ffb800] font-black tracking-widest text-sm uppercase">Лучшие предложения</span>
              <h2 className="text-4xl font-black uppercase">Популярные пакеты</h2>
            </div>
            <div className="flex items-center gap-4">
                <span className="text-zinc-500 text-sm">Сортировка по популярности</span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {products.map((product) => (
              <div 
                key={product.id} 
                className="group relative bg-[#141416] border border-white/5 rounded-3xl p-8 hover:border-[#ffb800]/30 transition-all flex flex-col gap-8 shadow-2xl"
              >
                <div className="flex flex-col gap-2">
                    <span className="text-[10px] font-black tracking-widest text-zinc-500 uppercase">{product.type}</span>
                    <h3 className="text-xl font-bold tracking-tight">{product.name}</h3>
                </div>
                
                <div className="flex items-baseline gap-2">
                  <span className="text-5xl font-black text-[#ffb800] tracking-tighter">{product.robux}</span>
                  <span className="text-sm font-bold text-zinc-400">ROBUX</span>
                </div>

                <div className="h-px w-full bg-white/5" />

                <div className="flex items-center justify-between">
                    <span className="text-zinc-500 font-medium">К оплате</span>
                    <span className="text-2xl font-black tracking-tight">{product.rub} ₽</span>
                </div>

                <Link 
                  href={`/checkout?productId=${product.id}`}
                  className="w-full h-14 bg-white/10 hover:bg-[#ffb800] hover:text-black rounded-2xl flex items-center justify-center font-bold transition-all"
                >
                  ВЫБРАТЬ
                </Link>

                <div className="absolute top-4 right-6 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Check className="w-5 h-5 text-[#ffb800]" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/5 py-12 bg-black text-center space-y-6">
          <div className="container mx-auto px-4">
            <p className="text-zinc-500 text-sm font-medium">
              ROBUX-VADI не связан с Roblox Corporation.
            </p>
            <p className="text-zinc-600 text-[10px] mt-4 max-w-xl mx-auto">
              Roblox, логотип Roblox и Powering Imagination являются зарегистрированными торговыми марками Roblox Corporation в США и других странах.
            </p>
          </div>
      </footer>
    </main>
  );
}
