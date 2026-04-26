"use client";

/**
 * ScrollFeatureTeaser
 * -------------------
 * Мини-секция-тизер между формой ввода кода и сеткой шагов.
 * 4 «слайда» с короткими бенефитами/тизерами процесса.
 *
 * Desktop: sticky scroll-story — высота секции 280vh, внутри sticky-контейнер 100vh,
 *          смена слайдов по IntersectionObserver на скрытых якорях (никакого
 *          scroll-listener'а на window, никакого scroll-jacking'а).
 * Mobile / coarse pointer: обычный вертикальный стек карточек, fade-in по
 *          IntersectionObserver. Никаких 280vh, иначе UX на телефоне ломается.
 *
 * Производительность:
 *   - Никаких window scroll listeners — только IntersectionObserver.
 *   - Анимации полностью на transform/opacity (компоненты GPU-композитинга).
 *   - prefers-reduced-motion → сразу отображаем все слайды без переходов.
 */

import { motion, useReducedMotion, AnimatePresence } from "framer-motion";
import { useEffect, useRef, useState } from "react";
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
  accent: string; // tailwind text/bg accent
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

function useLite(): boolean {
  const [lite, setLite] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const narrow = window.innerWidth < 900;
    setLite(coarse || narrow);
  }, []);
  return lite;
}

/* -------------------------------------------------- Mobile / lite stack */
function MobileStack({ reduced }: { reduced: boolean }) {
  return (
    <div className="space-y-4 px-4 py-12">
      <header className="mb-6 text-center">
        <h2 className="text-2xl font-bold text-white">Как это работает</h2>
        <p className="mt-2 text-sm text-white/60">
          Четыре простых факта о нашей системе
        </p>
      </header>
      {SLIDES.map((s, i) => (
        <motion.article
          key={s.id}
          initial={reduced ? false : { opacity: 0, y: 16 }}
          whileInView={reduced ? undefined : { opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: 0.4, delay: i * 0.05, ease: "easeOut" }}
          className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm"
        >
          <div className={`mb-3 inline-flex rounded-xl bg-white/10 p-2 ${s.accent}`}>
            <s.Icon className="h-5 w-5" strokeWidth={2} />
          </div>
          <h3 className="text-lg font-semibold text-white">{s.title}</h3>
          <p className="mt-1.5 text-sm leading-relaxed text-white/70">{s.body}</p>
        </motion.article>
      ))}
    </div>
  );
}

/* -------------------------------------------------- Desktop sticky story */
function DesktopStory({ reduced }: { reduced: boolean }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const anchorRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (reduced) return;
    const anchors = anchorRefs.current.filter(Boolean) as HTMLDivElement[];
    if (anchors.length === 0) return;

    const io = new IntersectionObserver(
      (entries) => {
        // Берём самый «глубокий» якорь (макс intersectionRatio), чьё центр-сечение пересекает 50% viewport
        let best = -1;
        let bestRatio = 0;
        entries.forEach((e) => {
          if (e.isIntersecting && e.intersectionRatio > bestRatio) {
            bestRatio = e.intersectionRatio;
            const idx = anchors.indexOf(e.target as HTMLDivElement);
            if (idx >= 0) best = idx;
          }
        });
        if (best >= 0) setActive(best);
      },
      {
        // Триггер-полоса в середине экрана (узкая, чтобы был чёткий «защёлк» между слайдами)
        rootMargin: "-45% 0px -45% 0px",
        threshold: [0, 0.01, 0.5, 1],
      }
    );

    anchors.forEach((a) => io.observe(a));
    return () => io.disconnect();
  }, [reduced]);

  return (
    <section ref={containerRef} className="relative" style={{ height: "320vh" }}>
      {/* Скрытые якоря — равномерно распределены по высоте секции */}
      {SLIDES.map((s, i) => (
        <div
          key={`anchor-${s.id}`}
          ref={(el) => {
            anchorRefs.current[i] = el;
          }}
          aria-hidden
          className="pointer-events-none absolute left-0 right-0"
          style={{ top: `${(i / SLIDES.length) * 100 + 5}%`, height: "1px" }}
        />
      ))}

      <div className="sticky top-0 flex h-screen items-center justify-center overflow-hidden">
        <div className="mx-auto grid w-full max-w-6xl grid-cols-2 gap-12 px-8">
          {/* Левая колонка — заголовок секции + табы-индикатор */}
          <div className="flex flex-col justify-center">
            <p className="mb-3 text-sm font-medium uppercase tracking-widest text-emerald-400">
              Как это работает
            </p>
            <h2 className="text-4xl font-bold text-white lg:text-5xl">
              Четыре причины, почему это удобно
            </h2>
            <ol className="mt-8 space-y-3">
              {SLIDES.map((s, i) => {
                const isActive = i === active;
                return (
                  <li key={`tab-${s.id}`} className="flex items-center gap-3">
                    <motion.span
                      animate={{
                        backgroundColor: isActive
                          ? "rgba(16,185,129,1)"
                          : "rgba(255,255,255,0.15)",
                        scale: isActive ? 1 : 0.8,
                      }}
                      transition={{ duration: 0.3 }}
                      className="block h-2 w-8 rounded-full"
                    />
                    <span
                      className={`text-sm transition-colors ${
                        isActive ? "text-white" : "text-white/40"
                      }`}
                    >
                      {s.title}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>

          {/* Правая колонка — активный слайд */}
          <div className="relative flex items-center justify-center">
            <AnimatePresence mode="wait">
              {SLIDES.map((s, i) =>
                i === active ? (
                  <motion.article
                    key={s.id}
                    initial={{ opacity: 0, y: 20, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -20, scale: 0.98 }}
                    transition={{ duration: 0.35, ease: "easeOut" }}
                    className="absolute inset-0 flex flex-col justify-center rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.06] to-white/[0.02] p-10 backdrop-blur-md"
                  >
                    <div className={`mb-6 inline-flex w-fit rounded-2xl bg-white/10 p-3 ${s.accent}`}>
                      <s.Icon className="h-7 w-7" strokeWidth={2} />
                    </div>
                    <h3 className="text-3xl font-bold text-white">{s.title}</h3>
                    <p className="mt-4 text-base leading-relaxed text-white/70">
                      {s.body}
                    </p>
                    <div className="mt-8 text-xs uppercase tracking-widest text-white/30">
                      {String(i + 1).padStart(2, "0")} / {String(SLIDES.length).padStart(2, "0")}
                    </div>
                  </motion.article>
                ) : null
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------- Public component */
export default function ScrollFeatureTeaser({
  className = "",
}: {
  className?: string;
}) {
  const reduced = useReducedMotion() ?? false;
  const lite = useLite();

  return (
    <section className={className}>
      {lite ? <MobileStack reduced={reduced} /> : <DesktopStory reduced={reduced} />}
    </section>
  );
}
