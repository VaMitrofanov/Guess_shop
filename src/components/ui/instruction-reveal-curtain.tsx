"use client";

/**
 * InstructionRevealCurtain
 * ------------------------
 * Reveal-wrapper для секции инструкции после успешной валидации WB-кода.
 *
 * Визуальный стиль вдохновлён CinematicFooter (clip-path занавес, aurora-glow,
 * сетка-фон, гигантский фоновый текст), но без GSAP/ScrollTrigger.
 * Используем framer-motion (уже в зависимостях) — это легче, чем тянуть GSAP.
 *
 * Производительность:
 *   - На мобильных и при `prefers-reduced-motion` рендерится без curtain-эффекта,
 *     обычный fade/slide. clip-path и большие blur очень дороги на мобилках.
 *   - aurora и grid рендерятся через CSS (transform/opacity), не requestAnimationFrame.
 *   - `will-change` объявляется только на время анимации reveal, потом сбрасывается.
 *   - Контент (children) монтируется только когда `revealed === true`,
 *     что предотвращает прогрев тяжёлых дочерних компонентов до триггера.
 */

import { motion, useReducedMotion, AnimatePresence } from "framer-motion";
import { useEffect, useState, type ReactNode } from "react";

type Props = {
  active: boolean;          // включить reveal (после валидации кода)
  children: ReactNode;       // содержимое инструкции
  giantText?: string;        // фоновый текст-водяной знак
  className?: string;
};

/** Грубое определение «лёгкого» режима без шейдеров и clip-path. */
function useLiteMode(): boolean {
  const [lite, setLite] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const narrow = window.innerWidth < 900;
    setLite(coarse || narrow);
  }, []);
  return lite;
}

export default function InstructionRevealCurtain({
  active,
  children,
  giantText = "INSTRUCTION",
  className = "",
}: Props) {
  const reduced = useReducedMotion();
  const lite = useLiteMode();
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    if (!active) {
      setRevealed(false);
      return;
    }
    // Микро-задержка, чтобы curtain успел отыграть до монтирования тяжёлых детей
    const t = setTimeout(() => setRevealed(true), reduced || lite ? 0 : 650);
    return () => clearTimeout(t);
  }, [active, reduced, lite]);

  // -------- Lite / reduced-motion path --------
  if (reduced || lite) {
    return (
      <div className={`relative ${className}`}>
        <AnimatePresence>
          {active && (
            <motion.div
              key="lite-reveal"
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduced ? 0.01 : 0.4, ease: "easeOut" }}
            >
              {children}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  // -------- Full cinematic path (desktop, motion-OK) --------
  return (
    <div className={`relative isolate overflow-hidden ${className}`}>
      {/* Фон: сетка + aurora — только во время reveal-фазы и после, чтобы не мешать LCP */}
      <AnimatePresence>
        {active && (
          <motion.div
            key="bg-aurora"
            className="pointer-events-none absolute inset-0 -z-10"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.9, ease: "easeOut" }}
            aria-hidden
          >
            {/* Сетка */}
            <div
              className="absolute inset-0 opacity-[0.07]"
              style={{
                backgroundImage:
                  "linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)",
                backgroundSize: "48px 48px",
                maskImage:
                  "radial-gradient(ellipse at 50% 30%, black 40%, transparent 75%)",
              }}
            />
            {/* Aurora */}
            <motion.div
              className="absolute -inset-[10%] blur-3xl"
              style={{
                background:
                  "radial-gradient(40% 30% at 30% 30%, rgba(16,185,129,0.35), transparent 60%), radial-gradient(35% 28% at 70% 60%, rgba(234,179,8,0.22), transparent 65%), radial-gradient(45% 35% at 50% 90%, rgba(59,130,246,0.18), transparent 70%)",
              }}
              animate={{
                x: ["0%", "2%", "-1%", "0%"],
                y: ["0%", "-1.5%", "1%", "0%"],
              }}
              transition={{
                duration: 22,
                repeat: Infinity,
                ease: "easeInOut",
              }}
            />
            {/* Гигантский фоновый текст */}
            <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 select-none text-center">
              <motion.h2
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 0.06, scale: 1 }}
                transition={{ duration: 1.2, ease: "easeOut" }}
                className="font-black tracking-tighter text-white"
                style={{
                  fontSize: "clamp(80px, 16vw, 240px)",
                  lineHeight: 0.9,
                  letterSpacing: "-0.04em",
                }}
              >
                {giantText}
              </motion.h2>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Curtain — две панели, расходятся по диагонали через clip-path */}
      <AnimatePresence>
        {active && !revealed && (
          <>
            <motion.div
              key="curtain-top"
              className="pointer-events-none absolute inset-0 z-20 bg-gradient-to-br from-[#0a0e1a] via-[#0a0e1a] to-[#10172a]"
              initial={{ clipPath: "polygon(0 0, 100% 0, 100% 100%, 0 100%)" }}
              animate={{ clipPath: "polygon(0 0, 100% 0, 100% 0, 0 0)" }}
              exit={{ clipPath: "polygon(0 0, 100% 0, 100% 0, 0 0)" }}
              transition={{ duration: 0.8, ease: [0.65, 0, 0.35, 1] }}
              style={{ willChange: "clip-path" }}
              aria-hidden
            />
            <motion.div
              key="curtain-bottom"
              className="pointer-events-none absolute inset-0 z-20 bg-gradient-to-tr from-[#10172a] via-[#0a0e1a] to-[#0a0e1a]"
              initial={{ clipPath: "polygon(0 100%, 100% 100%, 100% 100%, 0 100%)" }}
              animate={{ clipPath: "polygon(0 100%, 100% 100%, 100% 100%, 0 100%)" }}
              transition={{ duration: 0.8, ease: [0.65, 0, 0.35, 1] }}
              style={{ willChange: "clip-path" }}
              aria-hidden
            />
            {/* Тонкая разделительная линия пока занавес уходит */}
            <motion.div
              key="curtain-line"
              className="pointer-events-none absolute left-0 right-0 top-1/2 z-30 h-px bg-gradient-to-r from-transparent via-emerald-400/70 to-transparent"
              initial={{ scaleX: 0, opacity: 0 }}
              animate={{ scaleX: 1, opacity: [0, 1, 0] }}
              transition={{ duration: 0.8, ease: "easeOut" }}
              aria-hidden
            />
          </>
        )}
      </AnimatePresence>

      {/* Контент — монтируется только после ухода занавеса */}
      <AnimatePresence>
        {revealed && (
          <motion.div
            key="content"
            initial={{ opacity: 0, y: 28 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.55, ease: "easeOut" }}
            className="relative z-10"
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
