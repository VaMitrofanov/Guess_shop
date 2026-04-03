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
  const [gamepasses, setGamepasses] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const robuxRaw = parseInt(amountStr) || (productId ? 0 : 0);
  const robux = Math.max(0, robuxRaw);
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
    
    if (robux < 100) {
        setError("Минимальная сумма — 100 Robux");
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

  const handleUsernameSearch = async () => {
    if (!username) return;
    setSearching(true);
    setGamepasses([]);
    try {
        const res = await fetch(`/api/roblox/gamepasses?username=${username}`);
        const data = await res.json();
        if (data.success) {
            setGamepasses(data.gamepasses);
            if (data.gamepasses.length === 0) {
                setError("У этого пользователя нет публичных геймпассов");
            }
        }
    } catch (err) {
        console.error(err);
    } finally {
        setSearching(false);
    }
  };

  return (
    <div className="container mx-auto px-4 pt-12 pb-32 max-w-4xl">
      <div className="flex flex-col md:flex-row gap-8 items-start">
        {/* Left Side: Order Form */}
        <div className="flex-1 space-y-8">
            <div className="space-y-2">
                <h1 className="text-3xl font-black uppercase italic gold-text">Оформление заказа</h1>
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
                            method === "Gamepass" ? "bg-[#00f2fe]/10 border-[#00f2fe] text-[#00f2fe]" : "bg-white/5 border-white/5 text-zinc-600"
                        )}
                    >
                        <Gamepad2 className="w-8 h-8" />
                        <span className="text-xs font-bold uppercase tracking-widest leading-none">Gamepass</span>
                    </button>
                    <button 
                         onClick={() => setMethod("Group")}
                        className={cn(
                            "flex flex-col items-center gap-3 p-6 rounded-2xl border transition-all opacity-50 cursor-not-allowed",
                            method === "Group" ? "bg-[#00f2fe]/10 border-[#00f2fe] text-[#00f2fe]" : "bg-white/5 border-white/5 text-zinc-600"
                        )}
                    >
                        <User className="w-8 h-8" />
                        <span className="text-xs font-bold uppercase tracking-widest leading-none">Группа (Скоро)</span>
                    </button>
                </div>

                {method === "Gamepass" && (
                    <div className="animate-in fade-in slide-in-from-top-2 duration-300 space-y-6">
                        <div className="flex items-end gap-3">
                            <div className="flex-1 space-y-2">
                                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1">Никнейм или ID</label>
                                <div className="relative">
                                    <User className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-600" />
                                    <input 
                                        type="text" 
                                        value={username}
                                        onChange={(e) => setUsername(e.target.value)}
                                        placeholder="Напр., Builderman"
                                        className="w-full h-14 bg-white/5 border border-white/5 rounded-xl pl-12 pr-4 outline-none focus:border-[#00f2fe]/40 transition-all font-bold"
                                    />
                                </div>
                            </div>
                            <button 
                                onClick={handleUsernameSearch}
                                disabled={searching}
                                className="h-14 px-6 glass border-white/5 rounded-xl font-bold text-xs uppercase hover:bg-white/10 transition-all flex items-center justify-center gap-2"
                            >
                                {searching ? <Loader2 className="w-5 h-5 animate-spin" /> : "НАЙТИ"}
                            </button>
                        </div>

                        {gamepasses.length > 0 && (
                            <div className="space-y-4">
                                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1">Выберите геймпасс</label>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[300px] overflow-y-auto pr-2 scrollbar-hide">
                                    {gamepasses.map((gp) => (
                                        <button
                                            key={gp.id}
                                            onClick={() => setGamepassId(gp.id)}
                                            className={cn(
                                                "p-4 rounded-xl border text-left flex items-center gap-4 transition-all hover:scale-[1.02]",
                                                gamepassId === gp.id.toString() || gamepassId === gp.id ? "bg-[#00f2fe]/10 border-[#00f2fe] text-[#00f2fe]" : "bg-white/5 border-white/5"
                                            )}
                                        >
                                            <div className="w-12 h-12 rounded-lg bg-black/40 overflow-hidden flex-shrink-0">
                                                <img src={gp.image} alt={gp.name} className="w-full h-full object-cover" />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-xs font-bold truncate uppercase tracking-tighter">{gp.name}</p>
                                                <p className="text-[10px] text-zinc-500 font-bold">{gp.price || 0} R$</p>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className="p-4 rounded-xl bg-[#00f2fe]/5 border border-[#00f2fe]/10 flex gap-4 shadow-xl">
                            <Info className="w-6 h-6 text-[#00f2fe] shrink-0 mt-0.5" />
                            <p className="text-xs text-[#00f2fe]/80 leading-relaxed font-medium">
                                Найдите свой никнейм и выберите нужный геймпасс. Цена на геймпассе должна соответствовать сумме к получению (с учетом 30% налога Roblox).
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
                    <span className="text-3xl font-black text-[#00f2fe] tracking-tight">{price} ₽</span>
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
      <Suspense fallback={<div className="h-screen flex items-center justify-center"><Loader2 className="w-10 h-10 animate-spin text-[#00f2fe]" /></div>}>
        <CheckoutContent />
      </Suspense>
    </main>
  );
}
