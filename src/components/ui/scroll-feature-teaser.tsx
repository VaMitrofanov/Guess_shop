"use client";

/**
 * ScrollFeatureTeaser
 * -------------------
 * Компактная секция с 4 карточками-бенефитами между формой ввода кода
 * и сеткой шагов. Раньше использовала sticky scroll-story 320vh
 * с IntersectionObserver — это было хрупко на деплое (отдельный chunk
 * с 404 при кривой сборке) и ломало UX на нестандартных viewport-ах.
 *
 * Сейчас — простой адаптивный grid с лёгким fade-in.
 *
 * Производительность:
 *   - Никаких sticky-блоков, ResizeObserver или IntersectionObserver.
 *   - Анимации только на opacity/transform (GPU compositing), один проход.
 *   - prefers-reduced-motion → выключаем переходы целиком.
 */

import { motion, useReducedMotion } from "framer-motion";
import {
  ShieldCheck,
  Sparkles,
  Wallet,
  Timer,
  type LucideIcon,
} from "lucide-react";

type Slide = {
  id: string;
  title: string;
  body: string;
  Icon: LucideIcon;
  accent: string; // tailwind text colour
};

const SLIDES: Slide[] = [
  {
    id: "speed",
    title: "Зачисление за минуты",
    body:
      "Автоматическая система фулфилмента запускает доставку Robux сразу после оплаты. В среднем — 3–7 минут.",
    Icon: Timer,
    accent: "text-emerald-400",
  },
  {
    id: "safe",
    title: "Безопасно для аккаунта",
    body:
      "Передача только через официальный механизм Roblox — никаких передач пароля, никаких рисков для аккаунта.",
    Icon: ShieldCheck,
    accent: "text-amber-300",
  },
  {
    id: "price",
    title: "Цена ниже официальной",
    body:
      "Парсим рынок круглосуточно и автоматически держим курс ниже Roblox.com. Платите рублями — получаете больше Robux.",
    Icon: Wallet,
    accent: "text-emerald-300",
  },
  {
    id: "magic",
    title: "Поддержка 24/7",
    body:
      "Если что-то пошло не так — пишите в чат: ответим, проверим заказ и вернём средства, если зачисление не прошло.",
    Icon: Sparkles,
    accent: "text-amber-200",
  },
];

export default function ScrollFeatureTeaser({
  className = "",
}: {
  className?: string;
}) {
  const reducedRaw = useReducedMotion();
  const reduced = reducedRaw ?? false;

  return (
    <section className={className}>
      <div className="container mx-auto max-w-6xl px-4 py-16 sm:py-20">
        <header className="mb-10 text-center sm:mb-14">
          <p className="mb-3 text-xs font-medium uppercase tracking-widest text-emerald-400">
            Как это работает
          </p>
          <h2 className="text-2xl font-bold text-white sm:text-3xl lg:text-4xl">
            Четыре причины, почему это удобно
          </h2>
        </header>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:gap-5">
          {SLIDES.map((s, i) => (
            <motion.article
              key={s.id}
              initial={reduced ? false : { opacity: 0, y: 18 }}
              whileInView={reduced ? undefined : { opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{
                duration: 0.45,
                delay: reduced ? 0 : i * 0.06,
                ease: "easeOut",
              }}
              className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 backdrop-blur-sm transition-colors hover:border-white/20 hover:bg-white/[0.06]"
            >
              <div
                className={`mb-4 inline-flex rounded-xl bg-white/10 p-2.5 ${s.accent}`}
              >
                <s.Icon className="h-5 w-5" strokeWidth={2} />
              </div>
              <h3 className="text-base font-semibold text-white sm:text-lg">
                {s.title}
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-white/65">
                {s.body}
              </p>
              <div className="mt-4 text-[10px] uppercase tracking-widest text-white/25">
                {String(i + 1).padStart(2, "0")} / {String(SLIDES.length).padStart(2, "0")}
              </div>
            </motion.article>
          ))}
        </div>
      </div>
    </section>
  );
}
