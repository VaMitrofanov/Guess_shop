import Navbar from "@/components/navbar";
import { Metadata } from "next";
import {
  AlertTriangle, CheckCircle2, ExternalLink, ArrowRight, ChevronRight,
  Globe, Gamepad2, Ticket, Tag, Search, ShoppingCart,
  User, Link2, Hash,
} from "lucide-react";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Инструкция по созданию геймпасса | Roblox Bank",
  description: "Пошаговая инструкция по созданию геймпасса в Roblox для получения Robux",
};

const STEPS = [
  {
    num: "01",
    icon: Globe,
    title: "Открой Creator Hub",
    desc: "Зайди на create.roblox.com и войди в аккаунт.",
    detail: "Официальный портал для создателей. Работает в любом браузере — на компьютере или телефоне. Никаких программ скачивать не нужно.",
    tip: null,
    warn: null,
  },
  {
    num: "02",
    icon: Gamepad2,
    title: "Выбери или создай игру",
    desc: "Нажми «Creations» → выбери игру. Нет игр — создай пустую.",
    detail: "Кнопка «Create Experience» в правом верхнем углу. Введи любое название — оно не важно. Игру не нужно публиковать или наполнять.",
    tip: "Игра нужна только как контейнер для геймпасса — название и содержимое не важны.",
    warn: null,
  },
  {
    num: "03",
    icon: Ticket,
    title: "Создай геймпасс",
    desc: "В настройках игры: «Monetization» → «Passes» → «Create a Pass».",
    detail: "Придумай любое название: «VIP», «Donate», «Premium». Иконку загружать необязательно — Roblox подставит стандартную. Нажми «Save».",
    tip: null,
    warn: null,
  },
  {
    num: "04",
    icon: Tag,
    title: "Установи цену",
    desc: "Настройки пасса → включи «For Sale» → укажи цену → сохрани.",
    detail: "Цена пасса должна быть выше нужной суммы — Roblox берёт 30% комиссии. Используй формулу: цена = нужная сумма ÷ 0.7",
    tip: null,
    warn: "Хочешь получить 1000 R$ → ставь цену 1430 R$. Формула: нужная сумма ÷ 0.7",
  },
  {
    num: "05",
    icon: Search,
    title: "Найди свой геймпасс",
    desc: "Зайди на robloxbank.ru → нажми «Купить» → найди пасс одним из 3 способов.",
    detail: "Выбери любой удобный вариант — все они работают одинаково.",
    tip: "Самый быстрый способ — вставить ссылку прямо из адресной строки браузера.",
    warn: null,
    methods: [
      {
        icon: User,
        label: "По никнейму",
        desc: "Введи свой Roblox-никнейм — система найдёт все твои пассы автоматически.",
      },
      {
        icon: Link2,
        label: "По ссылке",
        desc: "Вставь URL страницы пасса: roblox.com/game-pass/123456789/название",
      },
      {
        icon: Hash,
        label: "По ID пасса",
        desc: "Введи числовой ID из URL. Он виден в Creator Hub → Basic Settings.",
      },
    ],
  },
  {
    num: "06",
    icon: ShoppingCart,
    title: "Оформи заказ",
    desc: "Выбери пасс из списка → нажми «Оформить» → оплати через Tinkoff.",
    detail: "После оплаты система автоматически купит твой геймпасс в течение 24ч. Robux поступят на баланс через 5–7 дней — стандартное время зачисления по правилам Roblox.",
    tip: null,
    warn: "Не удаляй геймпасс и не меняй цену до получения уведомления о завершении заказа.",
  },
];

const TABLE = [
  [100, 143, "~55 ₽"],
  [300, 429, "~165 ₽"],
  [500, 715, "~275 ₽"],
  [800, 1143, "~440 ₽"],
  [1000, 1430, "~550 ₽"],
  [1500, 2143, "~825 ₽"],
  [2000, 2858, "~1100 ₽"],
  [3000, 4286, "~1650 ₽"],
  [5000, 7143, "~2750 ₽"],
];

const FAQ = [
  {
    q: "Сколько времени занимает создание?",
    a: "Около 5 минут. Создать игру (1 мин) → создать пасс (2 мин) → установить цену (1 мин) → скопировать ID (30 сек).",
  },
  {
    q: "Когда придут Robux после оплаты?",
    a: "Заказ обрабатывается до 24 часов. После покупки пасса Roblox зачисляет средства через 5–7 дней — это стандартная политика платформы.",
  },
  {
    q: "Можно удалить геймпасс после оплаты?",
    a: "Нет! Не удаляй и не меняй цену до получения подтверждения о завершении. Иначе заказ не выполнится и придётся делать возврат.",
  },
  {
    q: "Нет игры в Roblox — что делать?",
    a: "Создай пустую через Creator Hub за 1 минуту. Публиковать и наполнять контентом не нужно — игра нужна только как контейнер для пасса.",
  },
  {
    q: "Почему цена пасса выше нужной суммы?",
    a: "Roblox удерживает 30% с каждой продажи. Чтобы получить 1000 R$ — пасс должен стоить 1430 R$. Калькулятор на главной учитывает это автоматически.",
  },
  {
    q: "Геймпасс не находится при поиске по нику?",
    a: "Убедись что игра с пассом существует. Можно вставить прямую ссылку на пасс или его числовой ID — поиск поддерживает все форматы.",
  },
];

const MISTAKES = [
  { wrong: "Цена пасса = нужная сумма",        right: "Цена пасса = нужная сумма ÷ 0.7" },
  { wrong: "Удаляю пасс сразу после оплаты",   right: "Жду уведомления о завершении заказа" },
  { wrong: "Меняю цену пока идёт заказ",        right: "Цена неизменна до завершения" },
  { wrong: "Robux придут сразу",                right: "Roblox зачисляет R$ через 5–7 дней" },
];

export default function GuidePage() {
  return (
    <main className="min-h-screen">
      <Navbar />

      {/* ── HERO ─────────────────────────────────────────── */}
      <section className="border-b border-[#1e2a45] bg-[#080c18]">
        <div className="container mx-auto px-6 py-16 max-w-6xl">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">

            {/* Left: headline */}
            <div className="space-y-6">
              <div className="font-pixel text-[10px] text-[#00b06f]/60 tracking-wider">TUTORIAL</div>
              <h1 className="text-6xl md:text-7xl font-black uppercase tracking-[-0.04em] leading-[0.85]">
                Как создать<br />
                <span className="gold-text">геймпасс</span>
              </h1>
              <p className="text-zinc-300 font-medium leading-relaxed text-lg max-w-md">
                Геймпасс — способ получить Robux через наш сервис.
                Создаётся за <span className="text-white font-black">5 минут</span> прямо
                в браузере.
              </p>
              <div className="flex flex-wrap gap-3">
                <Link
                  href="/checkout"
                  className="h-12 px-7 gold-gradient font-black text-[11px] uppercase tracking-widest text-white hover:opacity-90 transition-all rounded-none flex items-center gap-2"
                >
                  Оформить заказ <ArrowRight className="w-4 h-4" />
                </Link>
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
                  { label: "Время",      value: "5 мин" },
                  { label: "Сложность",  value: "Легко" },
                  { label: "Комиссия",   value: "0 ₽"   },
                  { label: "Шагов",      value: "6"     },
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

              {/* Formula highlight */}
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

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {STEPS.map((step) => {
            const StepIcon = step.icon;
            const hasMethods = "methods" in step && Array.isArray(step.methods);
            return (
              <div
                key={step.num}
                className={`pixel-card border-2 border-[#1e2a45] hover:border-[#00b06f]/30 transition-colors group p-6 flex gap-5 ${hasMethods ? "md:col-span-2" : ""}`}
              >
                {/* Step number + icon */}
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

                  {/* 3 ways to search — rendered as a mini-grid */}
                  {hasMethods && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
                      {(step as any).methods.map((m: any) => {
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

        {/* Done */}
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
      </section>

      <div className="accent-line" />

      {/* ── MISTAKES + TABLE ──────────────────────────────── */}
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

      {/* ── FAQ ───────────────────────────────────────────── */}
      <section className="container mx-auto px-6 py-16 max-w-6xl">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">

          {/* Left: heading + CTA */}
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

          {/* Right: FAQ accordion */}
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
    </main>
  );
}
