"use client";

/**
 * Animated background — CSS-only aurora glow.
 * ───────────────────────────────────────────
 * Раньше тут жил GLSL-шейдер на three.js (~150 KB gzip + ~600 KB raw в
 * node_modules). На сервере 4 GB RAM сборка с three.js упиралась в OOM
 * на этапе webpack chunking, плюс в рантайме это лишние мегабайты для
 * мобильного клиента.
 *
 * Замена даёт визуально близкий aurora-эффект чисто на CSS:
 *   • 3 больших radial-gradient слоя с разной скоростью / траекторией
 *   • blur(60px), composite на dark базе
 *   • keyframes на transform — GPU композитинг, никакого RAF в JS
 *   • prefers-reduced-motion → статичный gradient без движения
 *   • никакого WebGL, IntersectionObserver, requestAnimationFrame
 *   • никакого three.js, никакого dynamic chunk → деплой устойчивее
 *
 * Стилей на ~40 строк. Total cost: ~0 KB JS bundle, нулевой CPU после mount.
 */

import * as React from "react";

interface ShaderBackgroundProps {
  className?: string;
}

export default function ShaderBackground({ className }: ShaderBackgroundProps) {
  return (
    <div
      aria-hidden
      className={className}
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        background: "#060814",
        pointerEvents: "none",
      }}
    >
      {/* Базовый dark slate — gradient вместо плоского цвета даёт глубину */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(120% 80% at 50% 0%, rgba(10,16,32,1) 0%, rgba(6,8,20,1) 70%)",
        }}
      />

      {/* Aurora blob #1 — emerald, движется по диагонали медленно */}
      <div className="aurora-blob aurora-emerald" />
      {/* Aurora blob #2 — soft gold, более узкая орбита */}
      <div className="aurora-blob aurora-gold" />
      {/* Aurora blob #3 — slate-blue фоновый */}
      <div className="aurora-blob aurora-slate" />

      {/* Лёгкая сетка-noise через CSS gradient — добавляет «текстуру» */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0.03,
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
          maskImage:
            "radial-gradient(ellipse at 50% 30%, black 30%, transparent 75%)",
        }}
      />

      <style jsx>{`
        .aurora-blob {
          position: absolute;
          width: 60vw;
          height: 60vw;
          max-width: 900px;
          max-height: 900px;
          border-radius: 50%;
          filter: blur(80px);
          will-change: transform;
        }
        .aurora-emerald {
          background: radial-gradient(
            circle,
            rgba(0, 176, 111, 0.55) 0%,
            rgba(0, 176, 111, 0) 70%
          );
          top: -10%;
          left: -10%;
          animation: aurora-drift-1 28s ease-in-out infinite alternate;
        }
        .aurora-gold {
          background: radial-gradient(
            circle,
            rgba(201, 168, 76, 0.35) 0%,
            rgba(201, 168, 76, 0) 70%
          );
          top: 20%;
          right: -15%;
          width: 50vw;
          height: 50vw;
          animation: aurora-drift-2 34s ease-in-out infinite alternate;
        }
        .aurora-slate {
          background: radial-gradient(
            circle,
            rgba(59, 130, 246, 0.22) 0%,
            rgba(59, 130, 246, 0) 70%
          );
          bottom: -20%;
          left: 25%;
          width: 70vw;
          height: 70vw;
          animation: aurora-drift-3 40s ease-in-out infinite alternate;
        }

        @keyframes aurora-drift-1 {
          0%   { transform: translate(0, 0) scale(1); }
          100% { transform: translate(15vw, 10vh) scale(1.15); }
        }
        @keyframes aurora-drift-2 {
          0%   { transform: translate(0, 0) scale(1); }
          100% { transform: translate(-20vw, 15vh) scale(0.9); }
        }
        @keyframes aurora-drift-3 {
          0%   { transform: translate(0, 0) scale(1); }
          100% { transform: translate(10vw, -12vh) scale(1.1); }
        }

        /* Респектим системную настройку «уменьшить анимации» */
        @media (prefers-reduced-motion: reduce) {
          .aurora-blob {
            animation: none !important;
          }
        }

        /* На совсем мобилках уменьшаем blur (60px → 40px) — он жрёт GPU */
        @media (max-width: 768px) {
          .aurora-blob {
            filter: blur(50px);
          }
        }
      `}</style>
    </div>
  );
}
