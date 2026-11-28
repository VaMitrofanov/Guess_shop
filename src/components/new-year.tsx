"use client";

import { useEffect, useRef } from "react";
import styles from "./new-year.module.css";

/**
 * 🎄 Новогоднее оформление главной (15.11.2026, владелец: «ёлки, снег,
 * пиздатые анимации — с 1 декабря, а посмотреть сейчас»). Сезон решает
 * сервер (`isNewYearSeason`), предпросмотр — `/?ny=1`.
 *
 * Снег — один canvas поверх страницы, клики проходят насквозь; при «уменьшить
 * движение» снежинки стоят на месте, во фоновой вкладке анимация спит.
 */

export function Snowfall() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let width = 0;
    let height = 0;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    resize();
    const count = width < 640 ? 45 : 90;
    const flakes = Array.from({ length: count }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      r: 1 + Math.random() * 2.6,
      speed: 0.35 + Math.random() * 0.9,
      drift: Math.random() * Math.PI * 2,
      alpha: 0.45 + Math.random() * 0.5,
    }));
    let frame = 0;
    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      for (const flake of flakes) {
        if (!still) {
          flake.y += flake.speed;
          flake.drift += 0.012;
          flake.x += Math.sin(flake.drift) * 0.45;
          if (flake.y > height + 4) { flake.y = -4; flake.x = Math.random() * width; }
          if (flake.x > width + 4) flake.x = -4;
          if (flake.x < -4) flake.x = width + 4;
        }
        ctx.beginPath();
        ctx.arc(flake.x, flake.y, flake.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${flake.alpha})`;
        ctx.fill();
      }
      if (!still) frame = window.requestAnimationFrame(draw);
    };
    draw();
    const onVisibility = () => {
      if (document.hidden) window.cancelAnimationFrame(frame);
      else if (!still) frame = window.requestAnimationFrame(draw);
    };
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
  return <canvas ref={ref} className={styles.snow} aria-hidden="true" />;
}

const BULBS = ["#ff5a5a", "#ffd36b", "#45d6aa", "#8cc8ff", "#ff8ad8"];

/** Гирлянда: провод волной и лампочки, мигают по очереди. */
export function Garland({ count = 18 }: { count?: number }) {
  return (
    <div className={styles.garland} aria-hidden="true">
      <svg className={styles.wire} viewBox="0 0 1000 40" preserveAspectRatio="none">
        <path d="M0 6 Q 125 34 250 10 T 500 10 T 750 10 T 1000 8" fill="none" stroke="currentColor" strokeWidth="2.5" />
      </svg>
      {Array.from({ length: count }).map((_, index) => (
        <i
          key={index}
          className={styles.bulb}
          style={{
            left: `${(index + 0.5) * (100 / count)}%`,
            top: `${12 + Math.abs(Math.sin(((index + 0.5) / count) * Math.PI * 4)) * 14}px`,
            background: BULBS[index % BULBS.length],
            color: BULBS[index % BULBS.length],
            animationDelay: `${(index % 5) * 0.35}s`,
          }}
        />
      ))}
    </div>
  );
}

/** Ёлки и сугроб — декорация первого экрана. */
export function NewYearScene() {
  return (
    <div className={styles.scene} aria-hidden="true">
      <svg viewBox="0 0 600 220" preserveAspectRatio="xMidYMax meet" className={styles.trees}>
        <defs>
          <linearGradient id="nyTree" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#3ccf8e" />
            <stop offset="1" stopColor="#1d7d55" />
          </linearGradient>
        </defs>
        <g className={styles.treeA}>
          <path d="M90 40 l46 70 h-22 l34 52 h-24 l30 44 h-128 l30 -44 h-24 l34 -52 h-22 z" fill="url(#nyTree)" />
          <rect x="83" y="206" width="14" height="14" fill="#8a5a2b" />
          <path d="M90 26 l5 10 11 2 -8 8 2 11 -10 -5 -10 5 2 -11 -8 -8 11 -2 z" fill="#ffd36b" className={styles.star} />
          <circle cx="78" cy="122" r="4.5" fill="#ff5a5a" /><circle cx="104" cy="150" r="4.5" fill="#ffd36b" /><circle cx="70" cy="186" r="4.5" fill="#8cc8ff" /><circle cx="118" cy="192" r="4.5" fill="#ff8ad8" />
        </g>
        <g className={styles.treeB}>
          <path d="M520 70 l36 56 h-17 l27 40 h-19 l24 36 h-102 l24 -36 h-19 l27 -40 h-17 z" fill="url(#nyTree)" />
          <rect x="514" y="202" width="12" height="14" fill="#8a5a2b" />
          <circle cx="508" cy="146" r="4" fill="#ffd36b" /><circle cx="536" cy="178" r="4" fill="#ff5a5a" /><circle cx="498" cy="192" r="4" fill="#45d6aa" />
        </g>
        <g className={styles.gift}>
          <rect x="280" y="170" width="54" height="44" rx="5" fill="#7556e8" />
          <rect x="302" y="170" width="10" height="44" fill="#ffd36b" />
          <rect x="274" y="160" width="66" height="14" rx="4" fill="#9a80ff" />
          <rect x="302" y="160" width="10" height="14" fill="#ffd36b" />
          <path d="M307 160 c-12 -16 -26 -4 0 0 c26 -4 12 -16 0 0" stroke="#ffd36b" strokeWidth="4" fill="none" />
        </g>
        <path d="M0 214 Q 150 196 300 210 T 600 206 V 220 H 0 Z" fill="#ffffff" opacity=".92" />
      </svg>
    </div>
  );
}
