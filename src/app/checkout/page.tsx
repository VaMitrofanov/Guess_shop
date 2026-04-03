"use client";

import { useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Image from "next/image";
import Navbar from "@/components/navbar";
import { User, Wallet, Gamepad2, Info, ArrowRight, Loader2, Search, ChevronRight, Diamond } from "lucide-react";
import { cn } from "@/lib/utils";

function CheckoutContent() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const amountStr = searchParams.get("amount") || "0";
    const productId = searchParams.get("productId") || null;

    const [step, setStep] = useState<"form" | "confirm">("form");
    const [searchQuery, setSearchQuery] = useState("");
    const [username, setUsername] = useState("");
    const [method, setMethod] = useState("Gamepass");
    const [gamepassId, setGamepassId] = useState("");
    const [gamepasses, setGamepasses] = useState<any[]>([]);
    const [selectedGp, setSelectedGp] = useState<any>(null);
    const [searching, setSearching] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    const robuxRaw = parseInt(amountStr) || (productId ? 0 : 0);
    const [robux, setRobux] = useState(Math.max(0, robuxRaw));
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

    const handleSearch = async () => {
        if (!searchQuery) return;
        setSearching(true);
        setGamepasses([]);
        setError("");
        try {
            const res = await fetch(`/api/roblox/gamepasses?query=${encodeURIComponent(searchQuery)}`);
            const data = await res.json();
            if (data.success) {
                setGamepasses(data.gamepasses);
                if (data.gamepasses.length === 0) {
                    setError("Геймпассы не найдены. Проверьте ссылку или никнейм.");
                } else if (data.gamepasses.length === 1 && data.gamepasses[0].creatorName) {
                    // Auto-set username if found via direct link/ID
                    setUsername(data.gamepasses[0].creatorName);
                } else if (data.detectedUsername) {
                    // Search was by username — save it
                    setUsername(data.detectedUsername);
                } else if (!searchQuery.includes('/') && !searchQuery.match(/^\d+$/) && data.gamepasses.length > 0) {
                    // Looks like a username search, use the query as username
                    setUsername(searchQuery.trim());
                }
            }
        } catch (err) {
            console.error(err);
            setError("Ошибка при поиске");
        } finally {
            setSearching(false);
        }
    };

    return (
        <div className="container mx-auto px-4 pt-12 pb-32 max-w-4xl">
            <div className="max-w-2xl mx-auto">
                {/* Progress Header */}
                <div className="flex items-center justify-between mb-12">
                    <div className="space-y-3">
                        <h1 className="text-5xl font-black tracking-tighter uppercase tracking-[-0.05em] animate-in fade-in slide-in-from-left-4 duration-700">
                            {step === "form" ? "Оформление" : "Проверка"}
                        </h1>
                        <div className="flex items-center gap-2">
                            <div className={cn("h-1 w-10 rounded-full transition-all duration-500", step === "form" ? "bg-[#00f2fe] shadow-[0_0_10px_#00f2fe]" : "bg-white/10")} />
                            <div className={cn("h-1 w-10 rounded-full transition-all duration-500", step === "confirm" ? "bg-[#00f2fe] shadow-[0_0_10px_#00f2fe]" : "bg-white/10")} />
                        </div>
                    </div>
                    <div className="text-right hidden sm:block">
                        <p className="text-[10px] font-black text-zinc-600 uppercase tracking-widest leading-none">ШАГ {step === "form" ? "01" : "02"}</p>
                        <p className="text-xs font-black text-white uppercase tracking-widest mt-1 opacity-20">{step === "form" ? "ДАННЫЕ" : "ИТОГО"}</p>
                    </div>
                </div>

                {step === "form" ? (
                    /* ШАГ 1: ВВОД ДАННЫХ */
                    <div className="space-y-10 animate-in fade-in slide-in-from-bottom-8 duration-700">
                        <div className="grid grid-cols-2 gap-4">
                            <button
                                onClick={() => setMethod("Gamepass")}
                                className={cn(
                                    "group p-6 rounded-3xl border transition-all relative overflow-hidden",
                                    method === "Gamepass" ? "bg-[#00f2fe]/10 border-[#00f2fe]/40 text-[#00f2fe]" : "bg-white/[0.02] border-white/5 text-zinc-600"
                                )}
                            >
                                {method === "Gamepass" && <div className="absolute inset-0 bg-gradient-to-br from-[#00f2fe]/5 to-transparent animate-pulse" />}
                                <Gamepad2 className={cn("w-8 h-8 mb-4 relative z-10", method === "Gamepass" ? "drop-shadow-[0_0_8px_#00f2fe]" : "")} />
                                <span className="text-[10px] font-black uppercase tracking-widest block relative z-10">По геймпассу</span>
                            </button>
                            <button
                                className="p-6 rounded-3xl border border-white/5 bg-white/[0.02] text-zinc-600 opacity-40 cursor-not-allowed flex flex-col items-center"
                            >
                                <User className="w-8 h-8 mb-4" />
                                <span className="text-[10px] font-black uppercase tracking-widest block">Через группу (Скоро)</span>
                            </button>
                        </div>

                        <div className="space-y-8">
                            <div className="space-y-4">
                                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] ml-1">Данные для поиска</label>
                                <div className="flex gap-3">
                                    <div className="relative flex-1 group">
                                        <div className="absolute -inset-1 bg-gradient-to-r from-[#00f2fe]/20 to-[#4facfe]/20 rounded-3xl blur opacity-0 group-focus-within:opacity-100 transition-all duration-500" />
                                        <div className="relative">
                                            <Search className="absolute left-6 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500 group-focus-within:text-[#00f2fe] transition-colors" />
                                            <input
                                                type="text"
                                                value={searchQuery}
                                                onChange={(e) => setSearchQuery(e.target.value)}
                                                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                                                placeholder="Никнейм или ссылка на пас..."
                                                className="w-full h-16 bg-[#05070a]/90 backdrop-blur-xl border border-white/5 rounded-2xl pl-16 pr-6 outline-none focus:border-[#00f2fe]/40 transition-all font-bold text-lg"
                                            />
                                        </div>
                                    </div>
                                    <button
                                        onClick={handleSearch}
                                        disabled={searching}
                                        className="h-16 px-8 gold-gradient text-black font-black text-xs uppercase rounded-2xl hover:scale-[1.05] active:scale-95 transition-all flex items-center justify-center gap-3"
                                    >
                                        {searching ? <Loader2 className="w-5 h-5 animate-spin" /> : "НАЙТИ"}
                                    </button>
                                </div>
                            </div>

                            {username && (
                                <div className="flex items-center gap-4 p-4 rounded-2xl bg-white/[0.02] border border-white/5 animate-in slide-in-from-left-4">
                                    <div className="w-10 h-10 rounded-full bg-[#00f2fe]/10 flex items-center justify-center text-[#00f2fe] font-black text-xs">{username[0].toUpperCase()}</div>
                                    <div>
                                        <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest leading-none mb-1">Распознан аккаунт</p>
                                        <p className="text-sm font-black uppercase text-white">{username}</p>
                                    </div>
                                </div>
                            )}

                            {gamepasses.length > 0 && (
                                <div className="space-y-6 pt-4">
                                    <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1">📦 Выберите геймпасс</label>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-h-[420px] overflow-y-auto pr-2 custom-scrollbar">
                                        {gamepasses.map((gp) => (
                                            <button
                                                key={gp.id}
                                                onClick={() => {
                                                    setGamepassId(gp.id.toString());
                                                    setSelectedGp(gp);
                                                    const amount = Math.floor(gp.price * 0.7);
                                                    setRobux(amount);
                                                }}
                                                className={cn(
                                                    "p-5 rounded-3xl border text-left flex items-center gap-5 transition-all group/item relative overflow-hidden",
                                                    gamepassId === gp.id.toString() ? "bg-[#00f2fe]/10 border-[#00f2fe] ring-1 ring-[#00f2fe]/20" : "bg-white/[0.02] border-white/5 hover:border-white/10"
                                                )}
                                            >
                                                <div className="w-14 h-14 rounded-2xl bg-black/60 overflow-hidden flex-shrink-0 border border-white/5">
                                                    <img src={gp.image} alt={gp.name} className="w-full h-full object-cover" />
                                                </div>
                                                <div className="flex-1 min-w-0 space-y-2">
                                                    <p className="text-sm font-black truncate uppercase tracking-tight">{gp.name}</p>
                                                    <p className="text-sm font-black text-white">Цена: <span className="text-[#00f2fe]">{gp.price} R$</span></p>
                                                    <p className="text-xs font-black text-emerald-400 bg-emerald-400/10 px-2.5 py-1 rounded-lg inline-block border border-emerald-400/20">→ Вы получите: {Math.floor(gp.price * 0.7)} R$</p>
                                                </div>
                                                {gamepassId === gp.id.toString() && (
                                                    <div className="absolute top-4 right-4 w-2 h-2 bg-[#00f2fe] rounded-full shadow-[0_0_10px_#00f2fe]" />
                                                )}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="pt-4">
                            {error && <p className="text-red-500 text-[10px] font-black mb-4 uppercase tracking-widest text-center animate-pulse">{error}</p>}
                            <button
                                onClick={() => {
                                    if (!username || !gamepassId) {
                                        setError("Укажите ник и выберите геймпасс");
                                        return;
                                    }
                                    setStep("confirm");
                                }}
                                className="w-full h-20 gold-gradient text-black font-black text-sm uppercase tracking-[0.2em] rounded-3xl hover:scale-[1.02] active:scale-[0.98] transition-all shadow-2xl shadow-[#00f2fe]/10 flex items-center justify-center gap-3"
                            >
                                ПЕРЕЙТИ К ПРОВЕРКЕ <ArrowRight className="w-5 h-5" />
                            </button>
                        </div>
                    </div>
                ) : (
                    /* ШАГ 2: ПОДТВЕРЖДЕНИЕ */
                    <div className="animate-in fade-in slide-in-from-right-8 duration-700 space-y-10">
                        <div className="glass p-10 rounded-[3rem] border border-white/5 space-y-10 relative overflow-hidden backdrop-blur-2xl">
                            <div className="absolute top-0 right-0 w-64 h-64 bg-[#00f2fe]/5 blur-[100px] rounded-full -translate-y-1/2 translate-x-1/2" />

                            <div className="flex flex-col sm:flex-row items-center gap-8 relative z-10">
                                <div className="w-32 h-32 rounded-[2rem] bg-black border border-white/10 overflow-hidden shadow-2xl">
                                    <img src={selectedGp?.image} className="w-full h-full object-cover" />
                                </div>
                                <div className="text-center sm:text-left space-y-3">
                                    <h3 className="text-3xl font-black uppercase tracking-tight leading-none">{selectedGp?.name}</h3>
                                    <div className="flex flex-wrap justify-center sm:justify-start items-center gap-3">
                                        <span className="text-[10px] font-black text-[#00f2fe] uppercase tracking-widest bg-[#00f2fe]/10 px-3 py-1 rounded-full border border-[#00f2fe]/30">ID: {gamepassId}</span>
                                        <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">АККАУНТ: {username}</span>
                                    </div>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                                <div className="bg-white/[0.03] p-8 rounded-[2rem] border border-white/5 space-y-2">
                                    <span className="text-[10px] font-black text-zinc-600 uppercase tracking-widest block">Сумма к получению</span>
                                    <div className="flex items-center gap-3">
                                        <Diamond className="w-6 h-6 text-[#00f2fe]" />
                                        <span className="text-4xl font-black text-white">{robux.toLocaleString()}</span>
                                    </div>
                                </div>
                                <div className="bg-white/[0.03] p-8 rounded-[2rem] border border-white/5 space-y-2">
                                    <span className="text-[10px] font-black text-zinc-600 uppercase tracking-widest block">Итого к оплате</span>
                                    <div className="flex items-center gap-2">
                                        <span className="text-4xl font-black text-[#00f2fe]">{price.toLocaleString()} ₽</span>
                                    </div>
                                </div>
                            </div>

                            <div className="p-8 rounded-3xl bg-[#00f2fe]/5 border border-[#00f2fe]/20 space-y-4">
                                <h4 className="text-[10px] font-black text-[#00f2fe] uppercase tracking-widest flex items-center gap-3">
                                    <Info className="w-5 h-5" /> ИНФОРМАЦИЯ ПО ВЫКУПУ
                                </h4>
                                <div className="space-y-4 text-[11px] text-zinc-400 font-bold uppercase tracking-tight leading-relaxed">
                                    <div className="flex gap-4">
                                        <span className="w-6 h-6 rounded-full bg-[#00f2fe]/10 text-[#00f2fe] flex items-center justify-center shrink-0">1</span>
                                        <p>Заказ переходит в очередь выкупа <span className="text-white">СРАЗУ ПОСЛЕ ОПЛАТЫ</span>. Не нужно писать в поддержку.</p>
                                    </div>
                                    <div className="flex gap-4">
                                        <span className="w-6 h-6 rounded-full bg-[#00f2fe]/10 text-[#00f2fe] flex items-center justify-center shrink-0">2</span>
                                        <p><span className="text-white font-black underline decoration-[#00f2fe]">НЕ УДАЛЯЙТЕ</span> геймпасс и не меняйте его цену до завершения заказа (обычно 24ч).</p>
                                    </div>
                                    <div className="flex gap-4">
                                        <span className="w-6 h-6 rounded-full bg-[#00f2fe]/10 text-[#00f2fe] flex items-center justify-center shrink-0">3</span>
                                        <p>Roblox начисляет валюту через <span className="text-white">5-7 ДНЕЙ</span> после покупки геймпасса нашим ботом.</p>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="flex flex-col sm:flex-row gap-4">
                            <button
                                onClick={() => setStep("form")}
                                className="flex-1 h-16 bg-white/[0.03] border border-white/5 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-white/10 transition-all flex items-center justify-center gap-2"
                            >
                                ОТМЕНА
                            </button>
                            <button
                                onClick={handlePay}
                                disabled={loading}
                                className="flex-[2] h-16 gold-gradient text-black font-black text-xs uppercase tracking-[0.2em] rounded-2xl hover:scale-[1.02] shadow-2xl shadow-[#00f2fe]/10 flex items-center justify-center gap-3"
                            >
                                {loading ? <Loader2 className="w-6 h-6 animate-spin" /> : <>ПОДТВЕРДИТЬ И ОПЛАТИТЬ <ArrowRight className="w-4 h-4" /></>}
                            </button>
                        </div>
                    </div>
                )}
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
