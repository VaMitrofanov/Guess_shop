import Navbar from "@/components/navbar";
import { Metadata } from "next";
import { AlertTriangle, CheckCircle2, ExternalLink, ArrowRight } from "lucide-react";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Инструкция по созданию геймпасса | Roblox Bank",
  description: "Пошаговая инструкция по созданию геймпасса в Roblox для получения Robux",
};

const STEPS = [
  {
    num: "01",
    title: "Открой Creator Hub",
    desc: "Зайди на create.roblox.com и авторизуйся в аккаунт Roblox.",
    detail: "Это официальный портал для создателей. Здесь управляешь играми и монетизацией.",
    warn: null,
  },
  {
    num: "02",
    title: "Перейди в «Creations»",
    desc: "В левом меню нажми «Creations» → выбери любую игру или создай новую.",
    detail: "Если игры нет — создай пустую через «Create Experience». Название и контент не важны.",
    warn: null,
  },
  {
    num: "03",
    title: "Открой раздел «Passes»",
    desc: "В настройках игры: «Monetization» → «Passes» → «Create a Pass».",
    detail: "Геймпасс — это то, через что происходит передача Robux на твой аккаунт.",
    warn: null,
  },
  {
    num: "04",
    title: "Загрузи иконку и название",
    desc: "Загрузи любое изображение (мин. 150×150px) и придумай название: «VIP», «Donate» и т.д.",
    detail: "Иконка должна соответствовать правилам Roblox — без брендинга и контента 18+.",
    warn: null,
  },
  {
    num: "05",
    title: "Установи цену",
    desc: "После создания → настройки пасса → включи «For Sale» → установи цену в Robux.",
    detail: "Цена пасса = желаемая сумма ÷ 0.7. Если хочешь получить 1000 R$ — ставь 1430 R$.",
    warn: "Цена пасса = нужная сумма ÷ 0.7. Пример: хочешь 1000 R$ → ставишь 1430 R$",
  },
  {
    num: "06",
    title: "Скопируй ID геймпасса",
    desc: "В URL страницы пасса найди числовой ID: roblox.com/game-pass/XXXXXXXX/название",
    detail: "Именно этот ID вставляй при поиске на нашем сайте при оформлении заказа.",
    warn: null,
  },
];

const TABLE = [
  [100, 143, "~55 ₽"],
  [500, 715, "~275 ₽"],
  [1000, 1430, "~550 ₽"],
  [2000, 2858, "~1100 ₽"],
  [5000, 7143, "~2750 ₽"],
];

const FAQ = [
  {
    q: "Сколько времени занимает весь процесс?",
    a: "Создание пасса — 5 минут. Обработка заказа — до 24 часов. Зачисление R$ от Roblox — 5–7 дней.",
  },
  {
    q: "Можно ли удалить геймпасс после оплаты?",
    a: "Нет. Не удаляй и не меняй цену до получения уведомления о завершении заказа.",
  },
  {
    q: "Что если у меня нет игры в Roblox?",
    a: "Создай пустую через Creator Hub — 1 минута. Публиковать и наполнять контентом не нужно.",
  },
  {
    q: "Почему цена пасса выше нужной суммы?",
    a: "Roblox берёт 30% с каждой продажи. Калькулятор на нашем сайте учитывает это автоматически.",
  },
];

export default function GuidePage() {
  return (
    <main className="min-h-screen">
      <Navbar />

      <div className="container mx-auto px-4 pt-16 pb-24 max-w-3xl">

        {/* Header */}
        <div className="mb-10 space-y-4">
          <div className="font-pixel text-[9px] text-[#00b06f]/60 tracking-wider">TUTORIAL</div>
          <h1 className="text-4xl md:text-6xl font-black uppercase tracking-[-0.03em] leading-none">
            Создай<br />
            <span className="gold-text">геймпасс</span>
          </h1>
          <p className="text-zinc-400 font-medium leading-relaxed max-w-md">
            Для получения Robux нужен геймпасс в Roblox. Это займёт{" "}
            <span className="text-white font-bold">5 минут</span>.
          </p>
        </div>

        {/* Quick stats */}
        <div className="grid grid-cols-3 gap-3 mb-8">
          {[
            { label: "Время", value: "5 мин" },
            { label: "Сложность", value: "Легко" },
            { label: "Наша комиссия", value: "0 ₽" },
          ].map(({ label, value }) => (
            <div key={label} className="pixel-card border-2 border-[#1e2a45] p-4 text-center space-y-1">
              <div className="font-pixel text-[10px] text-[#00b06f]">{value}</div>
              <div className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">{label}</div>
            </div>
          ))}
        </div>

        {/* Warning */}
        <div className="border-l-2 border-amber-500/60 bg-amber-500/5 px-5 py-4 mb-10 flex gap-3">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-[9px] font-black text-amber-400 uppercase tracking-widest mb-1">Важно</p>
            <p className="text-xs text-amber-200/60 font-medium leading-relaxed">
              Не удаляй и не меняй цену геймпасса после оформления заказа — до получения уведомления о завершении.
            </p>
          </div>
        </div>

        <div className="accent-line mb-10" />

        {/* Steps */}
        <div className="space-y-3 mb-10">
          {STEPS.map((step, i) => (
            <div key={step.num} className="pixel-card border-2 border-[#1e2a45] hover:border-[#00b06f]/20 transition-colors">
              <div className="p-6 flex gap-5">
                {/* Number */}
                <div className="flex flex-col items-center gap-2 flex-shrink-0">
                  <div className="w-10 h-10 border-2 border-[#00b06f]/30 bg-[#00b06f]/10 flex items-center justify-center">
                    <span className="font-pixel text-[8px] text-[#00b06f]">{step.num}</span>
                  </div>
                  {i < STEPS.length - 1 && (
                    <div className="w-px flex-1 min-h-[20px] bg-[#1e2a45]" />
                  )}
                </div>

                <div className="space-y-2 flex-1 pb-2">
                  <h2 className="font-black uppercase tracking-tight">{step.title}</h2>
                  <p className="text-sm text-white/80 font-medium leading-relaxed">{step.desc}</p>
                  <p className="text-xs text-zinc-500 font-medium leading-relaxed">{step.detail}</p>
                  {step.warn && (
                    <div className="flex gap-2 mt-3 border-l-2 border-amber-500/40 pl-3 py-1">
                      <p className="text-[10px] text-amber-400/80 font-bold leading-relaxed">{step.warn}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Done */}
        <div className="pixel-card border-2 border-[#00b06f]/30 bg-[#00b06f]/5 p-6 flex flex-col sm:flex-row items-center gap-5 mb-10">
          <div className="w-12 h-12 bg-[#00b06f]/20 border border-[#00b06f]/30 flex items-center justify-center flex-shrink-0">
            <CheckCircle2 className="w-6 h-6 text-[#00b06f]" />
          </div>
          <div className="text-center sm:text-left space-y-1">
            <p className="font-pixel text-[9px] text-[#00b06f]">ГОТОВО</p>
            <p className="text-sm text-zinc-300 font-medium">Геймпасс создан! Возвращайся на главную и оформляй заказ.</p>
          </div>
          <Link
            href="/checkout"
            className="ml-auto h-10 px-6 gold-gradient font-black text-[10px] uppercase tracking-widest text-white hover:opacity-90 transition-all rounded-none flex items-center gap-2 flex-shrink-0"
          >
            Купить R$ <ArrowRight className="w-3 h-3" />
          </Link>
        </div>

        {/* Price table */}
        <div className="pixel-card border-2 border-[#1e2a45] p-6 mb-10">
          <div className="font-pixel text-[9px] text-[#00b06f]/60 tracking-wider mb-4">PRICE TABLE</div>
          <h3 className="font-black uppercase tracking-tight mb-5">Правильная цена геймпасса</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-[#1e2a45]">
                <th className="text-left py-2 text-[9px] font-black text-zinc-500 uppercase tracking-widest">Хочу получить</th>
                <th className="text-left py-2 text-[9px] font-black text-zinc-500 uppercase tracking-widest">Цена пасса</th>
                <th className="text-left py-2 text-[9px] font-black text-zinc-500 uppercase tracking-widest">В рублях</th>
              </tr>
            </thead>
            <tbody>
              {TABLE.map(([get, price, rub]) => (
                <tr key={get} className="border-b border-[#1e2a45]/50 hover:bg-[#00b06f]/3 transition-colors">
                  <td className="py-3 font-black text-[#00b06f]">{get} R$</td>
                  <td className="py-3 font-bold text-white">{price} R$</td>
                  <td className="py-3 font-bold text-zinc-400">{rub}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-4 font-pixel text-[7px] text-zinc-600">
            ФОРМУЛА: ЦЕНА ПАССА = НУЖНАЯ СУММА ÷ 0.7
          </p>
        </div>

        {/* FAQ */}
        <div className="space-y-3 mb-10">
          <div className="font-pixel text-[9px] text-[#00b06f]/60 tracking-wider mb-6">FAQ</div>
          {FAQ.map((item) => (
            <div key={item.q} className="pixel-card border-2 border-[#1e2a45] p-5 space-y-2">
              <h3 className="font-black uppercase tracking-tight text-sm">{item.q}</h3>
              <p className="text-xs text-zinc-400 font-medium leading-relaxed">{item.a}</p>
            </div>
          ))}
        </div>

        {/* Creator Hub link */}
        <a
          href="https://create.roblox.com"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-between p-5 pixel-card border-2 border-[#1e2a45] hover:border-[#00b06f]/30 transition-colors group"
        >
          <div>
            <p className="font-pixel text-[8px] text-zinc-500 tracking-wider mb-1">OFFICIAL SITE</p>
            <p className="font-black uppercase">Roblox Creator Hub</p>
          </div>
          <ExternalLink className="w-5 h-5 text-zinc-500 group-hover:text-[#00b06f] transition-colors" />
        </a>
      </div>
    </main>
  );
}
