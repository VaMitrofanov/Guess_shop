"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import Navbar from "@/components/navbar";
import {
  AlertTriangle, CheckCircle2, ExternalLink, ArrowRight, ChevronRight,
  Globe, Gamepad2, Ticket, Tag, Search, ShoppingCart,
  User, Link2, Hash, Lock, Send, ShoppingBag,
} from "lucide-react";

// ─── Step data ────────────────────────────────────────────────────────────────

const STEPS = [
  {
    num: "01", icon: Globe,
    title: "Открой Creator Hub",
    desc: "Зайди на create.roblox.com и войди в аккаунт.",
    detail: "Официальный портал для создателей. Работает в любом браузере — на компьютере или телефоне. Никаких программ скачивать не нужно.",
    tip: null, warn: null,
  },
  {
    num: "02", icon: Gamepad2,
    title: "Выбери или создай игру",
    desc: "Нажми «Creations» → выбери игру. Нет игр — создай пустую.",
    detail: "Кнопка «Create Experience» в правом верхнем углу. Введи любое название — оно не важно. Игру не нужно публиковать или наполнять.",
    tip: "Игра нужна только как контейнер для геймпасса — название и содержимое не важны.",
    warn: null,
  },
  {
    num: "03", icon: Ticket,
    title: "Создай геймпасс",
    desc: "В настройках игры: «Monetization» → «Passes» → «Create a Pass».",
    detail: "Придумай любое название: «VIP», «Donate», «Premium». Иконку загружать необязательно — Roblox подставит стандартную. Нажми «Save».",
    tip: null, warn: null,
  },
  {
    num: "04", icon: Tag,
    title: "Установи цену",
    desc: "Настройки пасса → включи «For Sale» → укажи цену → сохрани.",
    detail: "Цена пасса должна быть выше нужной суммы — Roblox берёт 30% комиссии. Используй формулу: цена = нужная сумма ÷ 0.7",
    tip: null,
    warn: "Хочешь получить 1000 R$ → ставь цену 1430 R$. Формула: нужная сумма ÷ 0.7",
  },
  {
    num: "05", icon: Search,
    title: "Найди свой геймпасс",
    desc: "Зайди на robloxbank.ru → нажми «Купить» → найди пасс одним из 3 способов.",
    detail: "Выбери любой удобный вариант — все они работают одинаково.",
    tip: "Самый быстрый способ — вставить ссылку прямо из адресной строки браузера.",
    warn: null,
    methods: [
      { icon: User,  label: "По никнейму", desc: "Введи свой Roblox-никнейм — система найдёт все твои пассы автоматически." },
      { icon: Link2, label: "По ссылке",   desc: "Вставь URL страницы пасса: roblox.com/game-pass/123456789/название" },
      { icon: Hash,  label: "По ID пасса", desc: "Введи числовой ID из URL. Он виден в Creator Hub → Basic Settings." },
    ],
  },
  {
    num: "06", icon: ShoppingCart,
    title: "Оформи заказ",
    desc: "Выбери пасс из списка → нажми «Оформить» → оплати через Tinkoff.",
    detail: "После оплаты система автоматически купит твой геймпасс в течение 24ч. Robux поступят на баланс через 5–7 дней — стандартное время зачисления по правилам Roblox.",
    tip: null,
    warn: "Не удаляй геймпасс и не меняй цену до получения уведомления о завершении заказа.",
  },
];

const TABLE = [
  [100, 143, "~55 ₽"],   [300, 429, "~165 ₽"],  [500, 715, "~275 ₽"],
  [800, 1143, "~440 ₽"], [1000, 1430, "~550 ₽"], [1500, 2143, "~825 ₽"],
  [2000, 2858, "~1100 ₽"],[3000, 4286, "~1650 ₽"],[5000, 7143, "~2750 ₽"],
];

const FAQ = [
  { q: "Сколько времени занимает создание?",      a: "Около 5 минут. Создать игру (1 мин) → создать пасс (2 мин) → установить цену (1 мин) → скопировать ID (30 сек)." },
  { q: "Когда придут Robux после оплаты?",         a: "Заказ обрабатывается до 24 часов. После покупки пасса Roblox зачисляет средства через 5–7 дней — это стандартная политика платформы." },
  { q: "Можно удалить геймпасс после оплаты?",     a: "Нет! Не удаляй и не меняй цену до получения подтверждения о завершении. Иначе заказ не выполнится и придётся делать возврат." },
  { q: "Нет игры в Roblox — что делать?",          a: "Создай пустую через Creator Hub за 1 минуту. Публиковать и наполнять контентом не нужно — игра нужна только как контейнер для пасса." },
  { q: "Почему цена пасса выше нужной суммы?",     a: "Roblox удерживает 30% с каждой продажи. Чтобы получить 1000 R$ — пасс должен стоить 1430 R$. Калькулятор на главной учитывает это автоматически." },
  { q: "Геймпасс не находится при поиске по нику?", a: "Убедись что игра с пассом существует. Можно вставить прямую ссылку на пасс или его числовой ID — поиск поддерживает все форматы." },
];

const MISTAKES = [
  { wrong: "Цена пасса = нужная сумма",       right: "Цена пасса = нужная сумма ÷ 0.7" },
  { wrong: "Удаляю пасс сразу после оплаты",  right: "Жду уведомления о завершении заказа" },
  { wrong: "Меняю цену пока идёт заказ",       right: "Цена неизменна до завершения" },
  { wrong: "Robux придут сразу",               right: "Roblox зачисляет R$ через 5–7 дней" },
];

// ─── Sub-components ────────────────────────────────────────────────────────────

function StepsGrid() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {STEPS.map((step) => {
        const StepIcon = step.icon;
        const hasMethods = "methods" in step && Array.isArray(step.methods);
        return (
          <div
            key={step.num}
            className={`pixel-card border-2 border-[#1e2a45] hover:border-[#00b06f]/30 transition-colors group p-6 flex gap-5 ${hasMethods ? "md:col-span-2" : ""}`}
          >
            <div className="flex-shrink-0 flex flex-col items-center gap-2">
              <div className="w-12 h-12 border-2 border-[#00b06f]/30 bg-[#00b06f]/10 flex items-center justify-center group-hover:border-[#00b06f]/60 group-hover:bg-[#00b06f]/15 transition-colors">
                <StepIcon className="w-5 h-5 text-[#00b06f]" />
              </div>
              <span className="font-pixel text-[8px] text-[#00b06f]/40">{step.num}</span>
            </div>

            <div className="space-y-3 flex-1 min-w-0">
              <h2 className="text-xl font-black uppercase tracking-tight">{step.title}</h2>
              <p className="text-base text-white/90 font-semibold leading-relaxed">{step.desc}</p>
              <p className="text-sm text-zinc-400 font-medium leading-relaxed">{step.detail}</p>

              {hasMethods && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
                  {(step as { methods: { icon: React.ElementType; label: string; desc: string }[] }).methods.map((m) => {
                    const MethodIcon = m.icon;
                    return (
                      <div key={m.label} className="bg-[#080c18] border border-[#1e2a45] p-4 space-y-2">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 border border-[#00b06f]/30 bg-[#00b06f]/10 flex items-center justify-center flex-shrink-0">
                            <MethodIcon className="w-3.5 h-3.5 text-[#00b06f]" />
                          </div>
                          <span className="font-black text-[11px] uppercase tracking-widest text-white">{m.label}</span>
                        </div>
                        <p className="text-sm text-zinc-400 font-medium leading-relaxed">{m.desc}</p>
                      </div>
                    );
                  })}
                </div>
              )}

              {step.tip && (
                <div className="flex gap-2 items-start bg-[#00b06f]/5 border border-[#00b06f]/15 px-3 py-2 mt-2">
                  <span className="font-pixel text-[9px] text-[#00b06f] mt-0.5 flex-shrink-0">TIP</span>
                  <p className="text-sm text-[#00b06f]/80 font-bold leading-relaxed">{step.tip}</p>
                </div>
              )}
              {step.warn && (
                <div className="flex gap-2 items-start border-l-2 border-amber-500/50 pl-3 py-1 mt-2">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-sm text-amber-300/80 font-bold leading-relaxed">{step.warn}</p>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// WB: вместо калькулятора — блок связи с менеджером
function WBManagerBlock({ denomination }: { denomination?: number }) {
  return (
    <div className="pixel-card border-2 border-amber-500/30 bg-amber-500/5 p-8 mt-4">
      <div className="text-center mb-8">
        <div className="w-16 h-16 border-2 border-amber-500/40 bg-amber-500/10 flex items-center justify-center mx-auto mb-4">
          <ShoppingBag className="w-8 h-8 text-amber-400" />
        </div>
        <div className="font-pixel text-[10px] text-amber-500/60 tracking-wider mb-3">СЛЕДУЮЩИЙ ШАГ</div>
        {denomination ? (
          <div className="inline-flex items-center gap-3 border border-[#c9a84c]/40 bg-[#c9a84c]/10 px-5 py-2 mb-4">
            <span className="font-pixel text-[9px] text-[#c9a84c]/60">НОМИНАЛ</span>
            <span className="text-3xl font-black" style={{ color: "#f0c040" }}>{denomination} R$</span>
          </div>
        ) : null}
        <h3 className="text-3xl font-black uppercase tracking-tight text-amber-200 mb-3">
          Связаться с менеджером
        </h3>
        <p className="text-amber-200/70 font-medium text-base max-w-md mx-auto leading-relaxed">
          Скопируйте ссылку на геймпасс и отправьте её нам для ручной выдачи.
          Менеджер выкупит пасс и пришлёт подтверждение.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 justify-center max-w-sm mx-auto">
        <a
          href="https://t.me/robloxbank_support"
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 h-14 flex items-center justify-center gap-3 bg-[#229ED9] hover:bg-[#1a8ec9] transition-colors font-black text-[11px] uppercase tracking-widest text-white"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8-1.7 8.02c-.12.55-.46.68-.94.42l-2.6-1.92-1.25 1.21c-.14.14-.26.26-.53.26l.19-2.67 4.85-4.38c.21-.19-.05-.29-.32-.1L7.12 14.4l-2.55-.8c-.55-.17-.56-.55.12-.82l9.97-3.84c.46-.17.86.11.98.86z"/>
          </svg>
          Telegram
        </a>
        <a
          href="https://vk.com/robloxbank"
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 h-14 flex items-center justify-center gap-3 bg-[#0077FF] hover:bg-[#0066ee] transition-colors font-black text-[11px] uppercase tracking-widest text-white"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
            <path d="M15.684 0H8.316C1.592 0 0 1.592 0 8.316v7.368C0 22.408 1.592 24 8.316 24h7.368C22.408 24 24 22.408 24 15.684V8.316C24 1.592 22.408 0 15.684 0zm3.692 17.123h-1.744c-.66 0-.864-.525-2.05-1.727-1.033-1-1.49-1.135-1.744-1.135-.356 0-.458.102-.458.593v1.575c0 .424-.135.678-1.253.678-1.846 0-3.896-1.118-5.335-3.202C4.624 10.857 4.03 8.57 4.03 8.096c0-.254.102-.491.593-.491h1.744c.44 0 .61.203.78.677.863 2.49 2.303 4.675 2.896 4.675.22 0 .322-.102.322-.66V9.721c-.068-1.186-.695-1.287-.695-1.71 0-.203.169-.407.44-.407h2.744c.373 0 .508.203.508.643v3.473c0 .372.169.508.271.508.22 0 .407-.136.813-.542 1.253-1.406 2.151-3.574 2.151-3.574.119-.254.322-.491.762-.491h1.744c.525 0 .644.27.525.643-.22 1.017-2.354 4.031-2.354 4.031-.186.305-.254.44 0 .78.186.254.796.779 1.203 1.253.745.847 1.32 1.558 1.473 2.05.17.49-.085.745-.576.745z"/>
          </svg>
          VKontakte
        </a>
      </div>

      <p className="text-center text-amber-500/50 text-xs font-black uppercase tracking-widest mt-6">
        Среднее время ответа — 10 минут
      </p>
    </div>
  );
}

// Стандартное завершение — кнопка к калькулятору
function StandardDoneBlock() {
  return (
    <div className="pixel-card border-2 border-[#00b06f]/40 bg-[#00b06f]/5 p-6 mt-4 flex flex-col sm:flex-row items-center gap-5">
      <div className="w-14 h-14 bg-[#00b06f]/20 border-2 border-[#00b06f]/30 flex items-center justify-center flex-shrink-0">
        <CheckCircle2 className="w-7 h-7 text-[#00b06f]" />
      </div>
      <div className="text-center sm:text-left space-y-1">
        <p className="font-pixel text-[10px] text-[#00b06f]">ГОТОВО!</p>
        <p className="font-black uppercase tracking-tight text-lg">Геймпасс создан — оформляй заказ</p>
        <p className="text-sm text-zinc-400 font-medium">Найди пасс по нику, ссылке или ID — и оплати</p>
      </div>
      <Link
        href="/checkout"
        className="ml-auto h-12 px-8 gold-gradient font-black text-[10px] uppercase tracking-widest text-white hover:opacity-90 transition-all rounded-none flex items-center gap-2 flex-shrink-0"
      >
        Купить R$ <ArrowRight className="w-3.5 h-3.5" />
      </Link>
    </div>
  );
}

// ─── WB Gate Screen ────────────────────────────────────────────────────────────

interface WBGateProps {
  onSuccess: (denomination: number) => void;
}

function WBGate({ onSuccess }: WBGateProps) {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 6);
    setCode(raw);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length < 4) {
      setError("Введите корректный код с карточки");
      inputRef.current?.focus();
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/wb-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data?.error ?? "Ошибка отправки");
      }

      onSuccess(data.denomination ?? 0);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Неизвестная ошибка";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex flex-col">
      <Navbar />

      <div className="flex-1 flex items-center justify-center px-4 py-16 bg-[#080c18]">
        {/* Subtle bg grid */}
        <div
          className="fixed inset-0 opacity-[0.02] pointer-events-none"
          style={{
            backgroundImage: `linear-gradient(rgba(201,168,76,0.8) 1px, transparent 1px),
                              linear-gradient(90deg, rgba(201,168,76,0.8) 1px, transparent 1px)`,
            backgroundSize: "40px 40px",
          }}
        />

        <div className="w-full max-w-md animate-in fade-in zoom-in">
          {/* Card */}
          <div className="pixel-card border-2 border-[#c9a84c]/40 bg-[#0a0c14] p-8 sm:p-10 space-y-8 relative">
            {/* Corner accent */}
            <div className="absolute top-0 left-0 w-12 h-12 border-t-2 border-l-2 border-[#c9a84c]/60" />
            <div className="absolute bottom-0 right-0 w-12 h-12 border-b-2 border-r-2 border-[#c9a84c]/60" />

            {/* Header */}
            <div className="text-center space-y-4 animate-in fade-in zoom-in animate-delay-100">
              <div className="w-16 h-16 border-2 border-[#c9a84c]/50 bg-[#c9a84c]/10 flex items-center justify-center mx-auto">
                <Ticket className="w-8 h-8 text-[#c9a84c]" />
              </div>

              <div>
                <div className="font-pixel text-[9px] text-[#c9a84c]/50 tracking-widest mb-3">
                  WILDBERRIES × ROBLOXBANK
                </div>
                <h1 className="text-2xl font-black uppercase tracking-tight leading-tight text-white">
                  Благодарим за покупку<br />
                  <span style={{ color: "#f0c040" }}>в RobloxBank!</span>
                </h1>
              </div>

              <p className="text-zinc-400 font-medium text-base leading-relaxed">
                Для активации номинала введите уникальный&nbsp;код с&nbsp;карточки.
              </p>
            </div>

            {/* Divider */}
            <div className="h-px bg-gradient-to-r from-transparent via-[#c9a84c]/30 to-transparent" />

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-5 animate-in fade-in zoom-in animate-delay-200">
              <div className="space-y-2">
                <label className="font-pixel text-[9px] text-[#c9a84c]/60 tracking-widest flex items-center gap-2">
                  <Lock className="w-3 h-3" />
                  КОД С КАРТОЧКИ
                </label>
                <input
                  ref={inputRef}
                  type="text"
                  value={code}
                  onChange={handleInput}
                  placeholder="XXXXXX"
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                  className="wb-input"
                  aria-label="Уникальный код с карточки"
                />
                <div className="flex justify-between items-center">
                  <p className="text-[11px] text-zinc-600 font-medium">
                    Код напечатан на карточке в заказе
                  </p>
                  <span className={`text-[11px] font-black tabular-nums ${code.length === 6 ? "text-[#c9a84c]" : "text-zinc-600"}`}>
                    {code.length}/6
                  </span>
                </div>
              </div>

              {/* Error */}
              {error && (
                <div className="flex items-center gap-2 border border-red-500/30 bg-red-500/5 px-3 py-2">
                  <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
                  <p className="text-sm text-red-400 font-medium">{error}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={loading || code.length < 4}
                className="w-full h-14 flex items-center justify-center gap-3 font-black text-[12px] uppercase tracking-widest text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  background: loading || code.length < 4
                    ? "linear-gradient(135deg, #4a3a10, #2a2008)"
                    : "linear-gradient(135deg, #c9a84c 0%, #f0c040 50%, #c9a84c 100%)",
                  color: loading || code.length < 4 ? "#888" : "#0a0c14",
                }}
              >
                {loading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    Проверяем...
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    Получить инструкцию
                  </>
                )}
              </button>
            </form>

            {/* Footer note */}
            <p className="text-center text-[11px] text-zinc-600 font-medium animate-in fade-in zoom-in animate-delay-300">
              Код одноразовый · Хранить не нужно
            </p>
          </div>

          {/* Trust badge below card */}
          <div className="flex items-center justify-center gap-6 mt-6 animate-in fade-in zoom-in animate-delay-300">
            {[
              { label: "Защита данных",  icon: Lock },
              { label: "Ручная выдача",  icon: CheckCircle2 },
              { label: "Поддержка 24/7", icon: ShoppingBag },
            ].map(({ label, icon: Icon }) => (
              <div key={label} className="flex items-center gap-1.5 text-zinc-600">
                <Icon className="w-3.5 h-3.5" />
                <span className="text-[11px] font-black uppercase tracking-wide">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}

// ─── Instruction (shared structure, WB vs Standard endings) ──────────────────

function Instruction({ isWB, denomination }: { isWB: boolean; denomination?: number }) {
  return (
    <main className="min-h-screen">
      <Navbar />

      {/* ── HERO ─────────────────────────────────────────── */}
      <section className="border-b border-[#1e2a45] bg-[#080c18]">
        <div className="container mx-auto px-6 py-16 max-w-6xl">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">

            {/* Left: headline */}
            <div className="space-y-6">
              {isWB && (
                <div className="inline-flex items-center gap-2 px-3 py-1.5 border border-amber-500/30 bg-amber-500/5">
                  <ShoppingBag className="w-3.5 h-3.5 text-amber-400" />
                  <span className="font-pixel text-[9px] text-amber-400/80 tracking-widest">WILDBERRIES</span>
                </div>
              )}
              <div className="font-pixel text-[10px] text-[#00b06f]/60 tracking-wider">TUTORIAL</div>
              <h1 className="text-6xl md:text-7xl font-black uppercase tracking-[-0.04em] leading-[0.85]">
                Как создать<br />
                <span className="gold-text">геймпасс</span>
              </h1>
              <p className="text-zinc-300 font-medium leading-relaxed text-lg max-w-md">
                Геймпасс — способ получить Robux через наш сервис.
                Создаётся за <span className="text-white font-black">5 минут</span> прямо в браузере.
              </p>
              <div className="flex flex-wrap gap-3">
                {isWB ? (
                  <a
                    href="https://t.me/robloxbank_support"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="h-12 px-7 gold-gradient font-black text-[11px] uppercase tracking-widest text-white hover:opacity-90 transition-all rounded-none flex items-center gap-2"
                    style={{ background: "linear-gradient(135deg, #c9a84c, #f0c040)", color: "#0a0c14" }}
                  >
                    Связаться с менеджером <ArrowRight className="w-4 h-4" />
                  </a>
                ) : (
                  <Link
                    href="/checkout"
                    className="h-12 px-7 gold-gradient font-black text-[11px] uppercase tracking-widest text-white hover:opacity-90 transition-all rounded-none flex items-center gap-2"
                  >
                    Оформить заказ <ArrowRight className="w-4 h-4" />
                  </Link>
                )}
                <a
                  href="https://create.roblox.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="h-12 px-7 border-2 border-[#1e2a45] hover:border-[#00b06f]/30 font-black text-[11px] uppercase tracking-widest transition-all rounded-none flex items-center gap-2 text-zinc-300"
                >
                  Creator Hub <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>

            {/* Right: stats + warning */}
            <div className="space-y-4">
              <div className="grid grid-cols-4 gap-2">
                {[
                  { label: "Время",     value: "5 мин" },
                  { label: "Сложность", value: "Легко" },
                  { label: "Комиссия",  value: "0 ₽"   },
                  { label: "Шагов",     value: "6"     },
                ].map(({ label, value }) => (
                  <div key={label} className="pixel-card border-2 border-[#1e2a45] p-4 text-center space-y-2">
                    <div className="font-pixel text-[11px] text-[#00b06f]">{value}</div>
                    <div className="text-xs font-black text-zinc-400 uppercase tracking-wider">{label}</div>
                  </div>
                ))}
              </div>

              <div className="border-2 border-amber-500/30 bg-amber-500/5 p-5 flex gap-4">
                <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="text-xs font-black text-amber-400 uppercase tracking-widest">Важно</p>
                  <p className="text-base text-amber-200/70 font-medium leading-relaxed">
                    После оплаты — <strong className="text-amber-300">не удаляй геймпасс и не меняй цену</strong>{" "}
                    до уведомления о завершении заказа.
                  </p>
                </div>
              </div>

              <div className="pixel-card border-2 border-[#00b06f]/30 bg-[#00b06f]/5 p-5">
                <div className="font-pixel text-[10px] text-[#00b06f]/60 tracking-wider mb-3">ГЛАВНАЯ ФОРМУЛА</div>
                <div className="flex items-center gap-4">
                  <div className="text-center">
                    <div className="text-3xl font-black text-zinc-300">1000</div>
                    <div className="text-xs text-zinc-500 uppercase tracking-widest font-black">Хочу R$</div>
                  </div>
                  <div className="text-zinc-600 font-black text-2xl">÷ 0.7 =</div>
                  <div className="text-center">
                    <div className="text-3xl font-black text-[#00b06f]">1430</div>
                    <div className="text-xs text-zinc-500 uppercase tracking-widest font-black">Цена пасса</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="accent-line" />

      {/* ── STEPS ─────────────────────────────────────────── */}
      <section className="container mx-auto px-6 py-16 max-w-6xl">
        <div className="font-pixel text-[10px] text-[#00b06f]/60 tracking-wider mb-8">ПОШАГОВАЯ ИНСТРУКЦИЯ</div>
        <StepsGrid />

        {/* Done block — differs by mode */}
        {isWB ? <WBManagerBlock denomination={denomination} /> : <StandardDoneBlock />}
      </section>

      {/* WB: no mistakes/table/FAQ sections — keep page focused */}
      {!isWB && (
        <>
          <div className="accent-line" />

          {/* ── MISTAKES + TABLE ────────────────────────────── */}
          <section className="container mx-auto px-6 py-16 max-w-6xl">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
              {/* Mistakes */}
              <div>
                <div className="font-pixel text-[10px] text-[#00b06f]/60 tracking-wider mb-2">ЧАСТЫЕ ОШИБКИ</div>
                <h2 className="text-4xl font-black uppercase tracking-tight mb-6">Чего не делать</h2>
                <div className="space-y-2">
                  {MISTAKES.map(({ wrong, right }) => (
                    <div key={wrong} className="pixel-card border-2 border-[#1e2a45] p-5">
                      <div className="flex gap-3 items-start mb-3">
                        <div className="w-6 h-6 border border-red-500/40 bg-red-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <span className="text-red-400 text-sm font-black leading-none">✕</span>
                        </div>
                        <p className="text-base text-red-400/80 font-medium">{wrong}</p>
                      </div>
                      <div className="flex gap-3 items-start border-t border-[#1e2a45] pt-3">
                        <div className="w-6 h-6 border border-[#00b06f]/40 bg-[#00b06f]/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <span className="text-[#00b06f] text-sm font-black leading-none">✓</span>
                        </div>
                        <p className="text-base text-[#00b06f]/80 font-medium">{right}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Price table */}
              <div>
                <div className="font-pixel text-[10px] text-[#00b06f]/60 tracking-wider mb-2">PRICE TABLE</div>
                <h2 className="text-4xl font-black uppercase tracking-tight mb-2">Таблица цен</h2>
                <p className="text-base text-zinc-500 font-medium mb-5">Цена пасса с учётом 30% комиссии Roblox.</p>
                <div className="pixel-card border-2 border-[#1e2a45] overflow-hidden">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b-2 border-[#1e2a45] bg-[#080c18]">
                        <th className="text-left px-5 py-4 text-xs font-black text-zinc-400 uppercase tracking-wider">Получишь</th>
                        <th className="text-left px-5 py-4 text-xs font-black text-zinc-400 uppercase tracking-wider">Цена пасса</th>
                        <th className="text-left px-5 py-4 text-xs font-black text-zinc-400 uppercase tracking-wider">Стоимость</th>
                      </tr>
                    </thead>
                    <tbody>
                      {TABLE.map(([get, price, rub]) => (
                        <tr key={get} className="border-b border-[#1e2a45]/40 hover:bg-[#00b06f]/3 transition-colors">
                          <td className="px-5 py-3.5 font-black text-[#00b06f] text-base">{get} R$</td>
                          <td className="px-5 py-3.5 font-bold text-white text-base">{price} R$</td>
                          <td className="px-5 py-3.5 font-bold text-zinc-400 text-base">{rub}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="px-5 py-3.5 bg-[#080c18] border-t border-[#1e2a45] flex items-center gap-3">
                    <span className="font-pixel text-[9px] text-[#00b06f] border border-[#00b06f]/20 bg-[#00b06f]/10 px-2 py-1">ФОРМУЛА</span>
                    <span className="text-sm font-bold text-zinc-300">цена пасса = нужная сумма ÷ 0.7</span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <div className="accent-line" />

          {/* ── FAQ ─────────────────────────────────────────── */}
          <section className="container mx-auto px-6 py-16 max-w-6xl">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
              <div className="space-y-6">
                <div>
                  <div className="font-pixel text-[10px] text-[#00b06f]/60 tracking-wider mb-2">FAQ</div>
                  <h2 className="text-4xl font-black uppercase tracking-tight">Частые вопросы</h2>
                </div>
                <p className="text-zinc-400 text-base font-medium leading-relaxed">
                  Не нашёл ответа? Напиши нам в Telegram — ответим в течение 10 минут.
                </p>
                <div className="space-y-2">
                  <a
                    href="https://create.roblox.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between p-5 pixel-card border-2 border-[#1e2a45] hover:border-[#00b06f]/30 transition-colors group"
                  >
                    <div>
                      <p className="font-pixel text-[9px] text-zinc-500 tracking-wider">OFFICIAL</p>
                      <p className="font-black uppercase text-base">Creator Hub</p>
                    </div>
                    <ExternalLink className="w-4 h-4 text-zinc-500 group-hover:text-[#00b06f] transition-colors" />
                  </a>
                  <Link
                    href="/checkout"
                    className="flex items-center justify-between p-5 pixel-card border-2 border-[#00b06f]/20 bg-[#00b06f]/5 hover:border-[#00b06f]/40 transition-colors group"
                  >
                    <div>
                      <p className="font-pixel text-[9px] text-[#00b06f]/60 tracking-wider">READY?</p>
                      <p className="font-black uppercase text-base">Купить Robux</p>
                    </div>
                    <ArrowRight className="w-4 h-4 text-[#00b06f]" />
                  </Link>
                </div>
              </div>

              <div className="lg:col-span-2 space-y-2">
                {FAQ.map((item) => (
                  <details
                    key={item.q}
                    className="pixel-card border-2 border-[#1e2a45] hover:border-[#00b06f]/20 transition-colors group"
                  >
                    <summary className="px-6 py-5 cursor-pointer flex items-center justify-between gap-3 list-none">
                      <h3 className="font-black uppercase tracking-tight text-base">{item.q}</h3>
                      <ChevronRight className="w-4 h-4 text-zinc-500 flex-shrink-0 group-open:rotate-90 transition-transform duration-200" />
                    </summary>
                    <div className="px-6 pb-5 border-t border-[#1e2a45]">
                      <p className="text-base text-zinc-300 font-medium leading-relaxed pt-4">{item.a}</p>
                    </div>
                  </details>
                ))}
              </div>
            </div>
          </section>
        </>
      )}

      {/* Back to home — only for standard users */}
      {!isWB && (
        <section className="border-t border-[#1e2a45] py-8">
          <div className="container mx-auto px-6 max-w-6xl flex justify-center">
            <Link
              href="/"
              className="h-12 px-8 border-2 border-[#1e2a45] hover:border-[#00b06f]/30 font-black text-[11px] uppercase tracking-widest transition-all rounded-none flex items-center gap-2 text-zinc-400 hover:text-white"
            >
              <ArrowRight className="w-4 h-4 rotate-180" />
              На главную к калькулятору
            </Link>
          </div>
        </section>
      )}
    </main>
  );
}

// ─── Main export ───────────────────────────────────────────────────────────────

export default function GuideClient({ isWB }: { isWB: boolean }) {
  const [phase, setPhase] = useState<"gate" | "instruction">(
    isWB ? "gate" : "instruction"
  );
  const [denomination, setDenomination] = useState<number>(0);

  if (phase === "gate") {
    return (
      <WBGate
        onSuccess={(d) => {
          setDenomination(d);
          setPhase("instruction");
        }}
      />
    );
  }

  return <Instruction isWB={isWB} denomination={denomination} />;
}
