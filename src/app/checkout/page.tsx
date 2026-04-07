"use client";

import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Navbar from "@/components/navbar";
import { User, Gamepad2, Info, ArrowRight, Loader2, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePricing } from "@/hooks/usePricing";

function RobuxIcon({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none">
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

function CheckoutContent() {
    const searchParams = useSearchParams();
    const amountStr = searchParams.get("amount") || "0";
    const productId = searchParams.get("productId") || null;

    const { rubPerRobux, loading: priceLoading, getPrice } = usePricing();

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

    const [robux, setRobux] = useState(Math.max(0, parseInt(amountStr) || 0));
    const price = getPrice(robux);

    const handlePay = async () => {
        if (!username) { setError("Введите ваш никнейм в Roblox"); return; }
        if (method === "Gamepass" && !gamepassId) { setError("Выберите геймпасс"); return; }
        if (robux < 100) { setError("Минимальная сумма — 100 Robux"); return; }
        setError(""); setLoading(true);
        try {
            const res = await fetch("/api/orders/create", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username, amountRobux: robux, productId, method, gamepassId }),
            });
            const data = await res.json();
            if (data.success && data.paymentUrl) window.location.href = data.paymentUrl;
            else setError(data.error || "Ошибка инициализации оплаты");
        } catch { setError("Ошибка сети. Попробуйте еще раз."); }
        finally { setLoading(false); }
    };

    const handleSearch = async () => {
        if (!searchQuery) return;
        setSearching(true); setGamepasses([]); setError("");
        try {
            const res = await fetch(`/api/roblox/gamepasses?query=${encodeURIComponent(searchQuery)}`);
            const data = await res.json();
            if (data.success) {
                setGamepasses(data.gamepasses);
                if (data.gamepasses.length === 0) setError("Геймпассы не найдены. Проверьте ссылку или никнейм.");
                else if (data.gamepasses.length === 1 && data.gamepasses[0].creatorName) setUsername(data.gamepasses[0].creatorName);
                else if (data.detectedUsername) setUsername(data.detectedUsername);
                else if (!searchQuery.includes("/") && !searchQuery.match(/^\d+$/) && data.gamepasses.length > 0) setUsername(searchQuery.trim());
            }
        } catch { setError("Ошибка при поиске"); }
        finally { setSearching(false); }
    };

    return (
        <div className="container mx-auto px-4 pt-10 pb-24 max-w-2xl">

            {/* ── Header ── */}
            <div className="flex items-start justify-between mb-10">
                <div className="space-y-3">
                    <div className="font-pixel text-[9px] text-[#00b06f]/60 tracking-wider">
                        {step === "form" ? "STEP 01 / 02" : "STEP 02 / 02"}
                    </div>
                    <h1 className="text-4xl font-black uppercase tracking-[-0.03em]">
                        {step === "form" ? "Оформление" : "Подтверждение"}
                    </h1>
                </div>
                <div className="flex gap-2 mt-2">
                    <div className={cn("h-1 w-12 transition-all duration-500", step === "form" ? "bg-[#00b06f]" : "bg-[#1e2a45]")} />
                    <div className={cn("h-1 w-12 transition-all duration-500", step === "confirm" ? "bg-[#00b06f]" : "bg-[#1e2a45]")} />
                </div>
            </div>

            {step === "form" ? (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">

                    {/* Method selector */}
                    <div className="grid grid-cols-2 gap-3">
                        <button
                            onClick={() => setMethod("Gamepass")}
                            className={cn(
                                "pixel-card p-5 flex flex-col gap-3 text-left transition-all border-2",
                                method === "Gamepass" ? "border-[#00b06f] bg-[#00b06f]/5" : "border-[#1e2a45]"
                            )}
                        >
                            <Gamepad2 className={cn("w-6 h-6", method === "Gamepass" ? "text-[#00b06f]" : "text-zinc-600")} />
                            <span className="text-[10px] font-black uppercase tracking-widest">По геймпассу</span>
                            {method === "Gamepass" && (
                                <span className="font-pixel text-[7px] text-[#00b06f]">ВЫБРАНО</span>
                            )}
                        </button>
                        <button className="pixel-card p-5 flex flex-col gap-3 text-left opacity-30 cursor-not-allowed border-2 border-[#1e2a45]">
                            <User className="w-6 h-6 text-zinc-600" />
                            <span className="text-[10px] font-black uppercase tracking-widest text-zinc-600">Через группу</span>
                            <span className="font-pixel text-[7px] text-zinc-600">СКОРО</span>
                        </button>
                    </div>

                    {/* Search */}
                    <div className="space-y-2">
                        <label className="text-[9px] font-black text-zinc-500 uppercase tracking-[0.25em] flex items-center gap-1.5">
                            <Search className="w-3 h-3" /> Поиск геймпасса
                        </label>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                                placeholder="Никнейм или ссылка на пасс..."
                                className="flex-1 h-14 bg-[#080c18] border-2 border-[#1e2a45] focus:border-[#00b06f]/50 rounded-none px-4 outline-none transition-all font-bold text-sm text-white placeholder:text-zinc-600"
                            />
                            <button
                                onClick={handleSearch}
                                disabled={searching}
                                className="h-14 px-6 gold-gradient font-black text-[10px] uppercase tracking-widest text-white hover:opacity-90 transition-all rounded-none flex items-center gap-2"
                            >
                                {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : "НАЙТИ"}
                            </button>
                        </div>
                    </div>

                    {/* Detected username */}
                    {username && (
                        <div className="flex items-center gap-3 p-4 border-l-2 border-[#00b06f] bg-[#00b06f]/5">
                            <div className="w-8 h-8 bg-[#00b06f]/20 border border-[#00b06f]/30 flex items-center justify-center font-black text-[#00b06f] text-xs rounded-none">
                                {username[0].toUpperCase()}
                            </div>
                            <div>
                                <p className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">Аккаунт</p>
                                <p className="text-sm font-black uppercase">{username}</p>
                            </div>
                            <span className="ml-auto font-pixel text-[7px] text-[#00b06f]">OK</span>
                        </div>
                    )}

                    {/* Gamepasses grid */}
                    {gamepasses.length > 0 && (
                        <div className="space-y-3">
                            <label className="text-[9px] font-black text-zinc-500 uppercase tracking-[0.25em]">
                                Выберите геймпасс
                            </label>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-96 overflow-y-auto">
                                {gamepasses.map((gp) => {
                                    const netRobux = Math.floor(gp.price * 0.7);
                                    const netPrice = getPrice(netRobux);
                                    const selected = gamepassId === gp.id.toString();
                                    return (
                                        <button
                                            key={gp.id}
                                            onClick={() => {
                                                setGamepassId(gp.id.toString());
                                                setSelectedGp(gp);
                                                setRobux(netRobux);
                                            }}
                                            className={cn(
                                                "pixel-card p-4 text-left flex gap-4 transition-all border-2",
                                                selected ? "border-[#00b06f] bg-[#00b06f]/5" : "border-[#1e2a45] hover:border-[#1e2a45]/80"
                                            )}
                                        >
                                            <div className="w-12 h-12 bg-black border border-[#1e2a45] overflow-hidden flex-shrink-0 rounded-none">
                                                <img src={gp.image} alt={gp.name} className="w-full h-full object-cover" />
                                            </div>
                                            <div className="flex-1 min-w-0 space-y-1.5">
                                                <p className="text-xs font-black truncate uppercase">{gp.name}</p>
                                                <p className="text-xs font-bold text-zinc-400">
                                                    Цена: <span className="text-[#00b06f]">{gp.price} R$</span>
                                                </p>
                                                <div className="inline-flex items-center gap-1 bg-[#00b06f]/10 border border-[#00b06f]/20 px-2 py-0.5">
                                                    <RobuxIcon className="w-2.5 h-2.5 text-[#00b06f]" />
                                                    <span className="font-pixel text-[7px] text-[#00b06f]">
                                                        {netRobux} R$ ≈ {priceLoading ? "..." : `${netPrice}₽`}
                                                    </span>
                                                </div>
                                            </div>
                                            {selected && (
                                                <div className="w-2 h-2 bg-[#00b06f] self-start mt-1 flex-shrink-0" />
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Error */}
                    {error && (
                        <div className="border-l-2 border-red-500 bg-red-500/5 px-4 py-3">
                            <p className="text-[10px] font-black text-red-400 uppercase tracking-widest">{error}</p>
                        </div>
                    )}

                    {/* Next step */}
                    <button
                        onClick={() => {
                            if (!username || !gamepassId) { setError("Укажите ник и выберите геймпасс"); return; }
                            setStep("confirm");
                        }}
                        className="w-full h-14 gold-gradient font-black text-sm uppercase tracking-widest text-white hover:opacity-90 active:scale-[0.98] transition-all rounded-none flex items-center justify-center gap-3"
                    >
                        К ПОДТВЕРЖДЕНИЮ <ArrowRight className="w-4 h-4" />
                    </button>
                </div>

            ) : (
                /* ── STEP 2: CONFIRM ── */
                <div className="space-y-5 animate-in fade-in slide-in-from-right-4 duration-300">

                    {/* Gamepass info */}
                    <div className="pixel-card border-2 border-[#1e2a45] p-6 space-y-5">
                        <div className="flex gap-5 items-center">
                            <div className="w-16 h-16 border-2 border-[#1e2a45] overflow-hidden flex-shrink-0">
                                <img src={selectedGp?.image} className="w-full h-full object-cover" />
                            </div>
                            <div className="space-y-2">
                                <h3 className="font-black uppercase tracking-tight">{selectedGp?.name}</h3>
                                <div className="flex flex-wrap gap-2">
                                    <span className="font-pixel text-[7px] text-[#00b06f] border border-[#00b06f]/30 bg-[#00b06f]/10 px-2 py-1">
                                        ID: {gamepassId}
                                    </span>
                                    <span className="font-pixel text-[7px] text-zinc-500 border border-[#1e2a45] px-2 py-1">
                                        {username}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Amount / price */}
                        <div className="grid grid-cols-2 gap-3">
                            <div className="bg-[#080c18] border border-[#1e2a45] p-5 space-y-2">
                                <p className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">Вы получите</p>
                                <div className="flex items-center gap-2">
                                    <RobuxIcon className="w-5 h-5 text-[#00b06f]" />
                                    <span className="text-3xl font-black">{robux.toLocaleString()}</span>
                                </div>
                                <p className="font-pixel text-[7px] text-zinc-600">чистых R$</p>
                            </div>
                            <div className="bg-[#080c18] border border-[#1e2a45] p-5 space-y-2">
                                <p className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">К оплате</p>
                                <span className="text-3xl font-black text-[#00b06f]">
                                    {priceLoading ? "..." : `${price.toLocaleString()}₽`}
                                </span>
                                <p className="font-pixel text-[7px] text-zinc-600">{rubPerRobux} ₽/R$</p>
                            </div>
                        </div>
                    </div>

                    {/* Instructions */}
                    <div className="border-2 border-[#00b06f]/20 bg-[#00b06f]/3 p-5 space-y-4">
                        <div className="flex items-center gap-2">
                            <Info className="w-4 h-4 text-[#00b06f]" />
                            <span className="font-pixel text-[8px] text-[#00b06f] tracking-wider">ВАЖНО</span>
                        </div>
                        <div className="space-y-3">
                            {[
                                "Заказ уходит в обработку сразу после оплаты. Писать в поддержку не нужно.",
                                "Не удаляй геймпасс и не меняй цену до завершения заказа (обычно 24ч).",
                                "Roblox зачисляет R$ через 5–7 дней после покупки.",
                            ].map((text, i) => (
                                <div key={i} className="flex gap-3 items-start">
                                    <span className="font-pixel text-[8px] text-[#00b06f]/60 mt-0.5 flex-shrink-0">0{i + 1}</span>
                                    <p className="text-xs text-zinc-400 font-medium leading-relaxed">{text}</p>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Error */}
                    {error && (
                        <div className="border-l-2 border-red-500 bg-red-500/5 px-4 py-3">
                            <p className="text-[10px] font-black text-red-400 uppercase tracking-widest">{error}</p>
                        </div>
                    )}

                    {/* Actions */}
                    <div className="flex gap-3">
                        <button
                            onClick={() => setStep("form")}
                            className="flex-1 h-14 border-2 border-[#1e2a45] hover:border-[#1e2a45]/60 font-black text-[10px] uppercase tracking-widest transition-all rounded-none"
                        >
                            НАЗАД
                        </button>
                        <button
                            onClick={handlePay}
                            disabled={loading}
                            className="flex-[2] h-14 gold-gradient font-black text-xs uppercase tracking-widest text-white hover:opacity-90 transition-all rounded-none flex items-center justify-center gap-3"
                        >
                            {loading
                                ? <Loader2 className="w-5 h-5 animate-spin" />
                                : <> ОПЛАТИТЬ <ArrowRight className="w-4 h-4" /> </>
                            }
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

export default function CheckoutPage() {
    return (
        <main className="min-h-screen">
            <Navbar />
            <Suspense fallback={
                <div className="h-screen flex items-center justify-center">
                    <Loader2 className="w-8 h-8 animate-spin text-[#00b06f]" />
                </div>
            }>
                <CheckoutContent />
            </Suspense>
        </main>
    );
}
