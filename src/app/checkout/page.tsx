"use client";

import { useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import Navbar from "@/components/navbar";
import {
    User, Gamepad2, Info, ArrowRight, Loader2, Search,
    CheckCircle2, ChevronRight, LayoutGrid,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { usePricing } from "@/hooks/usePricing";
import { Checkbox } from "@/components/ui/checkbox";

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

    // Place selection state
    const [places, setPlaces] = useState<any[]>([]);
    const [selectedPlace, setSelectedPlace] = useState<any>(null);

    const [gamepasses, setGamepasses] = useState<any[]>([]);
    const [selectedGp, setSelectedGp] = useState<any>(null);
    const [searching, setSearching] = useState(false);
    const [loadingPasses, setLoadingPasses] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    // Mandatory consent — ст. 26.1 ЗоЗПП + ФЗ-152. Acts as legal acceptance
    // of the public offer; without it we cannot lawfully process the
    // payment, so handlePay() short-circuits below and the button is
    // disabled in the UI as well (defence in depth).
    const [agreedToTerms, setAgreedToTerms] = useState(false);

    const [robux, setRobux] = useState(Math.max(0, parseInt(amountStr) || 0));
    const price = getPrice(robux);

    const handlePay = async () => {
        if (!username) { setError("Введите ваш никнейм в Roblox"); return; }
        if (method === "Gamepass" && !gamepassId) { setError("Выберите геймпасс"); return; }
        if (robux < 100) { setError("Минимальная сумма — 100 Robux"); return; }
        if (!agreedToTerms) {
            setError("Необходимо согласие с офертой и политикой конфиденциальности");
            return;
        }
        setError(""); setLoading(true);
        try {
            const res = await fetch("/api/orders/create", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username, amountRobux: robux, productId, method, gamepassId, agreedToTerms }),
            });
            const data = await res.json();
            if (data.success && data.paymentUrl) window.location.href = data.paymentUrl;
            else setError(data.error || "Ошибка инициализации оплаты");
        } catch { setError("Ошибка сети. Попробуйте еще раз."); }
        finally { setLoading(false); }
    };

    // Detect if query is a direct gamepass ID or URL
    function isDirectQuery(q: string): boolean {
        const trimmed = q.trim();
        if (/^\d+$/.test(trimmed)) return true;
        return /game-pass(?:es)?\/\d+/i.test(trimmed) ||
            /catalog\/\d+/i.test(trimmed) ||
            /library\/\d+/i.test(trimmed);
    }

    const handleSearch = async () => {
        if (!searchQuery) return;
        setSearching(true);
        setGamepasses([]); setPlaces([]); setSelectedPlace(null); setSelectedGp(null);
        setGamepassId(""); setError("");

        if (isDirectQuery(searchQuery)) {
            // Direct ID or URL → bypass place selection, find gamepass directly
            try {
                const res = await fetch(`/api/roblox/gamepasses?query=${encodeURIComponent(searchQuery)}`);
                const data = await res.json();
                if (data.success) {
                    setGamepasses(data.gamepasses);
                    if (data.gamepasses.length === 0) setError("Геймпасс не найден. Проверьте ссылку или ID.");
                    else if (data.gamepasses[0]?.creatorName) setUsername(data.gamepasses[0].creatorName);
                } else {
                    setError("Ошибка поиска геймпасса");
                }
            } catch { setError("Ошибка при поиске"); }
            finally { setSearching(false); }
            return;
        }

        // Username → show places first
        try {
            const res = await fetch(`/api/roblox/games?username=${encodeURIComponent(searchQuery.trim())}`);
            const data = await res.json();
            if (data.success && data.games.length > 0) {
                setPlaces(data.games);
                setUsername(searchQuery.trim());
            } else if (data.success && data.games.length === 0) {
                setError("Игры не найдены. Проверьте никнейм или вставьте ссылку/ID на геймпасс.");
            } else {
                setError("Пользователь не найден");
            }
        } catch { setError("Ошибка при поиске"); }
        finally { setSearching(false); }
    };

    const handleSelectPlace = async (place: any) => {
        setSelectedPlace(place);
        setGamepasses([]); setSelectedGp(null); setGamepassId(""); setError("");
        setLoadingPasses(true);
        try {
            const res = await fetch(`/api/roblox/games?universeId=${place.universeId}`);
            const data = await res.json();
            if (data.success) {
                setGamepasses(data.gamepasses);
                if (data.gamepasses.length === 0)
                    setError("В этой игре нет геймпассов. Выберите другую или создайте пасс.");
            } else {
                setError("Не удалось загрузить геймпассы");
            }
        } catch { setError("Ошибка при загрузке геймпассов"); }
        finally { setLoadingPasses(false); }
    };

    return (
        <div className="container mx-auto px-4 pt-10 pb-24 max-w-2xl">

            {/* ── Header ── */}
            <div className="flex items-start justify-between mb-10">
                <div className="space-y-3">
                    <div className="font-pixel text-[10px] text-[#00b06f]/60 tracking-wider">
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
                            <span className="text-xs font-black uppercase tracking-widest">По геймпассу</span>
                            {method === "Gamepass" && (
                                <span className="font-pixel text-[9px] text-[#00b06f]">ВЫБРАНО</span>
                            )}
                        </button>
                        <button className="pixel-card p-5 flex flex-col gap-3 text-left opacity-30 cursor-not-allowed border-2 border-[#1e2a45]">
                            <User className="w-6 h-6 text-zinc-600" />
                            <span className="text-xs font-black uppercase tracking-widest text-zinc-600">Через группу</span>
                            <span className="font-pixel text-[9px] text-zinc-600">СКОРО</span>
                        </button>
                    </div>

                    {/* Search — step indicator */}
                    <div className="space-y-3">
                        {/* Mini step line */}
                        <div className="flex items-center gap-2">
                            {[
                              { n: "1", label: "Ник / ссылка", done: !!username },
                              { n: "2", label: "Игра",          done: !!selectedPlace || (gamepasses.length > 0 && !selectedPlace) },
                              { n: "3", label: "Геймпасс",      done: !!gamepassId },
                            ].map((s, i) => (
                              <div key={i} className="flex items-center gap-1.5">
                                <div className={`w-5 h-5 flex items-center justify-center font-black text-[9px] transition-all ${s.done ? "bg-[#00b06f] text-white" : "border border-[#1e2a45] text-zinc-500"}`}>{s.n}</div>
                                <span className={`text-[10px] font-bold uppercase tracking-widest transition-colors ${s.done ? "text-[#00b06f]" : "text-zinc-600"}`}>{s.label}</span>
                                {i < 2 && <div className="w-4 h-px bg-[#1e2a45]" />}
                              </div>
                            ))}
                        </div>

                        <label className="text-xs font-black text-zinc-400 uppercase tracking-[0.2em] flex items-center gap-1.5">
                            <Search className="w-3.5 h-3.5" /> Никнейм или ссылка на пасс
                        </label>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => { setSearchQuery(e.target.value); }}
                                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                                placeholder="PlayerNick123 или roblox.com/game-pass/..."
                                className="flex-1 h-14 bg-[#080c18] border-2 border-[#1e2a45] focus:border-[#00b06f]/50 rounded-none px-4 outline-none transition-all font-bold text-sm text-white placeholder:text-zinc-600"
                            />
                            <button
                                onClick={handleSearch}
                                disabled={searching || !searchQuery.trim()}
                                className="h-14 px-5 gold-gradient font-black text-[10px] uppercase tracking-widest text-white hover:opacity-90 active:scale-[0.98] transition-all rounded-none flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Search className="w-4 h-4" /><span className="hidden sm:inline">НАЙТИ</span></>}
                            </button>
                        </div>
                        <p className="text-[11px] text-zinc-600 font-medium leading-relaxed">
                            По нику: выберешь игру → пасс. По ссылке/ID — сразу найдём пасс.
                        </p>
                    </div>

                    {/* Detected username */}
                    {username && !searching && (
                        <div className="flex items-center gap-3 p-4 border-l-2 border-[#00b06f] bg-[#00b06f]/5">
                            <div className="w-8 h-8 bg-[#00b06f]/20 border border-[#00b06f]/30 flex items-center justify-center font-black text-[#00b06f] text-xs rounded-none">
                                {username[0].toUpperCase()}
                            </div>
                            <div>
                                <p className="text-xs font-black text-zinc-400 uppercase tracking-widest">Аккаунт</p>
                                <p className="text-sm font-black uppercase">{username}</p>
                            </div>
                            <span className="ml-auto font-pixel text-[7px] text-[#00b06f]">OK</span>
                        </div>
                    )}

                    {/* ── Places grid (step 2) ── */}
                    {places.length > 0 && !selectedPlace && gamepasses.length === 0 && (
                        <div className="space-y-2 animate-in fade-in slide-in-from-bottom-2 duration-200">
                            <div className="flex items-center gap-2 pb-1">
                                <LayoutGrid className="w-3.5 h-3.5 text-[#00b06f]" />
                                <label className="text-xs font-black text-zinc-300 uppercase tracking-[0.2em]">
                                    Выберите игру
                                </label>
                                <span className="ml-auto font-pixel text-[9px] text-zinc-500">{places.length} шт.</span>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-64 overflow-y-auto pr-1">
                                {places.map((place) => (
                                    <button
                                        key={place.universeId}
                                        onClick={() => handleSelectPlace(place)}
                                        className="pixel-card p-3 text-left flex gap-3 items-center border-2 border-[#1e2a45] hover:border-[#00b06f]/50 hover:bg-[#00b06f]/5 transition-all group"
                                    >
                                        {place.image ? (
                                            <div className="w-10 h-10 border border-[#1e2a45] overflow-hidden flex-shrink-0 rounded-sm">
                                                <img src={place.image} alt={place.name} className="w-full h-full object-cover" />
                                            </div>
                                        ) : (
                                            <div className="w-10 h-10 border border-[#1e2a45] bg-[#080c18] flex items-center justify-center flex-shrink-0">
                                                <Gamepad2 className="w-4 h-4 text-zinc-600" />
                                            </div>
                                        )}
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-black truncate uppercase group-hover:text-white transition-colors">{place.name}</p>
                                            <p className="text-xs text-zinc-600 font-medium mt-0.5">ID: {place.rootPlaceId}</p>
                                        </div>
                                        <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-[#00b06f] transition-colors flex-shrink-0" />
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Loading passes */}
                    {loadingPasses && (
                        <div className="flex items-center gap-3 p-5 border border-[#1e2a45] text-zinc-400">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span className="text-sm font-bold">Загружаю геймпассы...</span>
                        </div>
                    )}

                    {/* Selected place breadcrumb */}
                    {selectedPlace && gamepasses.length > 0 && (
                        <div className="flex items-center gap-2 text-xs text-zinc-500 font-bold">
                            <button
                                onClick={() => {
                                    setSelectedPlace(null);
                                    setGamepasses([]);
                                    setSelectedGp(null);
                                    setGamepassId("");
                                }}
                                className="hover:text-white transition-colors underline underline-offset-2"
                            >
                                {username}
                            </button>
                            <ChevronRight className="w-3 h-3" />
                            <span className="text-white font-black uppercase truncate max-w-[180px]">{selectedPlace.name}</span>
                        </div>
                    )}

                    {/* Gamepasses grid */}
                    {gamepasses.length > 0 && (
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <label className="text-xs font-black text-zinc-400 uppercase tracking-[0.2em]">
                                    Выберите геймпасс
                                </label>
                                <span className="font-pixel text-[9px] text-zinc-500">{gamepasses.length} шт.</span>
                            </div>
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
                                                "pixel-card p-4 text-left flex gap-4 transition-all relative",
                                                selected
                                                    ? "border-2 border-[#00b06f] bg-[#00b06f]/8 shadow-[0_0_0_1px_#00b06f33]"
                                                    : "border-2 border-[#1e2a45] hover:border-[#00b06f]/30 hover:bg-[#00b06f]/3"
                                            )}
                                        >
                                            {selected && (
                                                <div className="absolute top-0 right-0 bg-[#00b06f] px-2 py-1 flex items-center gap-1">
                                                    <CheckCircle2 className="w-3 h-3 text-white" />
                                                    <span className="font-pixel text-[8px] text-white leading-none">ВЫБРАН</span>
                                                </div>
                                            )}
                                            <div className={cn(
                                                "w-12 h-12 overflow-hidden flex-shrink-0 rounded-none border",
                                                selected ? "border-[#00b06f]/40" : "border-[#1e2a45]"
                                            )}>
                                                <img src={gp.image} alt={gp.name} className="w-full h-full object-cover" />
                                            </div>
                                            <div className="flex-1 min-w-0 space-y-1.5 pr-1">
                                                <p className={cn(
                                                    "text-sm font-black truncate uppercase",
                                                    selected ? "text-white" : "text-zinc-200"
                                                )}>{gp.name}</p>
                                                <p className="text-sm font-bold text-zinc-400">
                                                    Цена: <span className="text-[#00b06f]">{gp.price} R$</span>
                                                </p>
                                                <div className={cn(
                                                    "inline-flex items-center gap-1 px-2 py-0.5 border",
                                                    selected
                                                        ? "bg-[#00b06f]/20 border-[#00b06f]/40"
                                                        : "bg-[#00b06f]/10 border-[#00b06f]/20"
                                                )}>
                                                    <RobuxIcon className="w-3 h-3 text-[#00b06f]" />
                                                    <span className="font-pixel text-[9px] text-[#00b06f]">
                                                        {netRobux} R$ ≈ {priceLoading ? "..." : `${netPrice}₽`}
                                                    </span>
                                                </div>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>

                            {/* Selected summary */}
                            {selectedGp && (
                                <div className="flex items-center gap-4 p-4 border-2 border-[#00b06f] bg-[#00b06f]/5 mt-1">
                                    <CheckCircle2 className="w-5 h-5 text-[#00b06f] flex-shrink-0" />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-xs font-black text-[#00b06f] uppercase tracking-widest mb-0.5">Выбран пасс</p>
                                        <p className="text-sm font-black uppercase truncate">{selectedGp.name}</p>
                                    </div>
                                    <div className="text-right flex-shrink-0">
                                        <p className="font-pixel text-[9px] text-zinc-500">получишь</p>
                                        <p className="text-base font-black text-[#00b06f]">
                                            {Math.floor(selectedGp.price * 0.7)} R$
                                        </p>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Error */}
                    {error && (
                        <div className="border-l-2 border-red-500 bg-red-500/5 px-4 py-3">
                            <p className="text-xs font-black text-red-400 uppercase tracking-widest">{error}</p>
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
                                <p className="text-xs font-black text-zinc-400 uppercase tracking-widest">Вы получите</p>
                                <div className="flex items-center gap-2">
                                    <RobuxIcon className="w-5 h-5 text-[#00b06f]" />
                                    <span className="text-3xl font-black">{robux.toLocaleString()}</span>
                                </div>
                                <p className="font-pixel text-[9px] text-zinc-500">чистых R$</p>
                            </div>
                            <div className="bg-[#080c18] border border-[#1e2a45] p-5 space-y-2">
                                <p className="text-xs font-black text-zinc-400 uppercase tracking-widest">К оплате</p>
                                <span className="text-3xl font-black text-[#00b06f]">
                                    {priceLoading ? "..." : `${price.toLocaleString()}₽`}
                                </span>
                                <p className="font-pixel text-[9px] text-zinc-500">{rubPerRobux} ₽/R$</p>
                            </div>
                        </div>
                    </div>

                    {/* Instructions */}
                    <div className="border-2 border-[#00b06f]/20 bg-[#00b06f]/3 p-5 space-y-4">
                        <div className="flex items-center gap-2">
                            <Info className="w-4 h-4 text-[#00b06f]" />
                            <span className="font-pixel text-[10px] text-[#00b06f] tracking-wider">ВАЖНО</span>
                        </div>
                        <div className="space-y-3">
                            {[
                                "Заказ уходит в обработку сразу после оплаты. Писать в поддержку не нужно.",
                                "Не удаляй геймпасс и не меняй цену до завершения заказа (обычно 24ч).",
                                "Roblox зачисляет R$ через 5–7 дней после покупки.",
                            ].map((text, i) => (
                                <div key={i} className="flex gap-3 items-start">
                                    <span className="font-pixel text-[9px] text-[#00b06f]/60 mt-0.5 flex-shrink-0">0{i + 1}</span>
                                    <p className="text-sm text-zinc-300 font-medium leading-relaxed">{text}</p>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Error */}
                    {error && (
                        <div className="border-l-2 border-red-500 bg-red-500/5 px-4 py-3">
                            <p className="text-xs font-black text-red-400 uppercase tracking-widest">{error}</p>
                        </div>
                    )}

                    {/* Mandatory consent — must be ticked before payment.
                        Required by ст. 437–438 ГК РФ (acceptance of offer)
                        and ФЗ-152 (informed consent for personal data
                        processing). The checkbox label is the legal
                        equivalent of a wet signature. */}
                    <label className="flex items-start gap-3 p-4 border border-[#1e2a45] bg-[#080c18] cursor-pointer select-none hover:border-[#00b06f]/40 transition-colors">
                        <Checkbox
                            checked={agreedToTerms}
                            onChange={(e) => setAgreedToTerms(e.target.checked)}
                            aria-describedby="terms-consent-text"
                            className="mt-0.5"
                        />
                        <span id="terms-consent-text" className="text-xs text-zinc-300 leading-relaxed">
                            Я согласен с условиями{" "}
                            <Link
                                href="/legal/offer"
                                target="_blank"
                                onClick={(e) => e.stopPropagation()}
                                className="text-[#00b06f] underline underline-offset-2 hover:opacity-80"
                            >
                                оферты
                            </Link>
                            {" "}и{" "}
                            <Link
                                href="/legal/policy"
                                target="_blank"
                                onClick={(e) => e.stopPropagation()}
                                className="text-[#00b06f] underline underline-offset-2 hover:opacity-80"
                            >
                                политикой конфиденциальности
                            </Link>
                            . Подтверждаю, что ознакомлен с тем, что цифровой товар надлежащего качества возврату и обмену не подлежит после момента передачи кода активации (ст. 26.1 ЗоЗПП).
                        </span>
                    </label>

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
                            disabled={loading || !agreedToTerms}
                            className={cn(
                                "flex-[2] h-14 font-black text-xs uppercase tracking-widest text-white transition-all rounded-none flex items-center justify-center gap-3",
                                agreedToTerms && !loading
                                    ? "gold-gradient hover:opacity-90 active:scale-[0.98] cursor-pointer"
                                    : "bg-[#1e2a45] text-zinc-500 cursor-not-allowed",
                            )}
                            title={!agreedToTerms ? "Необходимо согласие с офертой и политикой конфиденциальности" : undefined}
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
