"use client";

import { useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Image from "next/image";
import Navbar from "@/components/navbar";
import { User, Wallet, Gamepad2, Info, ArrowRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

function CheckoutContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const amountStr = searchParams.get("amount") || "0";
  const productId = searchParams.get("productId") || null;

  const [username, setUsername] = useState("");
  const [method, setMethod] = useState("Gamepass");
  const [gamepassId, setGamepassId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const robux = parseInt(amountStr) || (productId ? 0 : 0);
  const price = Math.round(robux * 0.85);

  const handlePay = async () => {
    if (!username) {
        setError("Введите ваш никнейм в Roblox");
        return;
    }
    if (method === 'Gamepass' && !gamepassId) {
        setError("Введите ID вашего Gamepass");
        return;
    }
    
    setError("");
    setLoading(true);

    try {
        const res = await fetch("/api/orders/create", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                username,
                amountRobux: robux,
                productId,
                method,
                gamepassId,
            }),
        });
        
        const data = await res.json();
        
        if (data.success && data.paymentUrl) {
            window.location.href = data.paymentUrl;
        } else {
            setError(data.error || "Ошибка инициализации оплаты");
        }
    } catch (err) {
        setError("Ошибка сети. Попробуйте еще раз.");
    } finally {
        setLoading(false);
    }
  };

  return (
    <div className="container mx-auto px-4 pt-12 pb-32 max-w-4xl">
      <div className="flex flex-col md:flex-row gap-8 items-start">
        {/* Left Side: Order Form */}
        <div className="flex-1 space-y-8">
            <div className="space-y-2">
                <h1 className="text-3xl font-black uppercase italic gold-gradient bg-clip-text text-transparent">Оформление заказа</h1>
                <p className="text-zinc-500 font-medium">Пожалуйста, укажите верные данные для быстрой доставки.</p>
            </div>

            <div className="space-y-6">
                <div>
                    <label className="text-sm font-bold text-zinc-400 mb-3 block">НИКНЕЙМ ROBLOX</label>
                    <div className="relative">
                        <User className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-600" />
                        <input 
                            type="text" 
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            placeholder="Напр., Builderman"
                            className="w-full h-14 bg-white/5 border border-white/5 rounded-xl pl-12 pr-4 outline-none focus:border-[#ffb800]/40 transition-all font-bold"
                        />
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <button 
                        onClick={() => setMethod("Gamepass")}
                        className={cn(
                            "flex flex-col items-center gap-3 p-6 rounded-2xl border transition-all",
                            method === "Gamepass" ? "bg-[#ffb800]/10 border-[#ffb800] text-[#ffb800]" : "bg-white/5 border-white/5 text-zinc-600"
                        )}
                    >
                        <Gamepad2 className="w-8 h-8" />
                        <span className="text-xs font-bold uppercase tracking-widest leading-none">Gamepass</span>
                    </button>
                    <button 
                         onClick={() => setMethod("Group")}
                        className={cn(
                            "flex flex-col items-center gap-3 p-6 rounded-2xl border transition-all opacity-50 cursor-not-allowed",
                            method === "Group" ? "bg-[#ffb800]/10 border-[#ffb800] text-[#ffb800]" : "bg-white/5 border-white/5 text-zinc-600"
                        )}
                    >
                        <User className="w-8 h-8" />
                        <span className="text-xs font-bold uppercase tracking-widest leading-none">Группа (Скоро)</span>
                    </button>
                </div>

                {method === "Gamepass" && (
                    <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                        <label className="text-sm font-bold text-zinc-400 mb-3 block">ID ГЕЙМПАССА</label>
                        <input 
                            type="text" 
                            value={gamepassId}
                            onChange={(e) => setGamepassId(e.target.value)}
                            placeholder="Напр., 12345678"
                            className="w-full h-14 bg-white/5 border border-white/5 rounded-xl px-6 outline-none focus:border-[#ffb800]/40 transition-all font-bold"
                        />
                        <div className="mt-4 p-4 rounded-xl bg-blue-500/10 border border-blue-500/20 flex gap-3">
                            <Info className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
                            <p className="text-xs text-blue-300/80 leading-relaxed">
                                Убедитесь, что ваш геймпасс публичный и его цена соответствует сумме, которую вы хотите получить (с учетом налога Roblox).
                            </p>
                        </div>
                    </div>
                )}
            </div>
        </div>

        {/* Right Side: Summary Card */}
        <div className="w-full md:w-80 glass p-8 rounded-3xl border border-white/5 sticky top-24">
            <h2 className="text-sm font-black text-zinc-500 uppercase tracking-widest mb-6">ИТОГО</h2>
            
            <div className="space-y-4">
                <div className="flex justify-between items-center">
                    <span className="text-zinc-400 text-sm">Вы получите</span>
                    <span className="font-bold">{robux} Robux</span>
                </div>
                <div className="flex justify-between items-center">
                    <span className="text-zinc-400 text-sm">Метод доставки</span>
                    <span className="font-bold">{method === 'Gamepass' ? 'Геймпасс' : 'Группа'}</span>
                </div>
                <div className="h-px w-full bg-white/5 my-2" />
                <div className="flex justify-between items-center pt-2">
                    <span className="text-zinc-300 font-bold uppercase">Общая сумма</span>
                    <span className="text-3xl font-black text-[#ffb800] tracking-tight">{price} ₽</span>
                </div>
            </div>

            {error && (
                <div className="mt-6 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 text-xs font-medium text-center">
                    {error}
                </div>
            )}

            <button 
                onClick={handlePay}
                disabled={loading}
                className="w-full mt-8 h-14 gold-gradient rounded-xl flex items-center justify-center gap-3 font-bold text-black hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 disabled:hover:scale-100"
            >
                {loading ? <Loader2 className="w-6 h-6 animate-spin" /> : <>ПЕРЕЙТИ К ОПЛАТЕ <ArrowRight className="w-5 h-5" /></>}
            </button>
            
            <div className="mt-8 flex items-center justify-center gap-4 text-zinc-600">
                <Wallet className="w-4 h-4" />
                <span className="text-[10px] font-bold uppercase tracking-widest">Безопасно через Тинькофф</span>
            </div>
        </div>
      </div>
    </div>
  );
}

export default function CheckoutPage() {
  return (
    <main className="min-h-screen">
      <Navbar />
      <Suspense fallback={<div className="h-screen flex items-center justify-center"><Loader2 className="w-10 h-10 animate-spin text-[#ffb800]" /></div>}>
        <CheckoutContent />
      </Suspense>
    </main>
  );
}
