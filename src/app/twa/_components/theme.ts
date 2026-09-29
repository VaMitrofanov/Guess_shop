/* ─────────────────────────────────────────────────────────────────────────────
   theme.ts — single source of truth for the Telegram admin app (TWA).

   Liquid Glass / Ultraviolet: deep graphite-violet canvas, translucent layers,
   restrained blur and iOS system accents. The card values intentionally use
   alpha so the static ambient background can show through without adding a
   backdrop-filter to every repeated order card (important on older iPhones).
   ───────────────────────────────────────────────────────────────────────── */

export const C = {
  /* Surfaces */
  bg:         "#120f1c",
  bgElevated: "rgba(31,25,45,0.90)",
  card:       "rgba(41,34,57,0.76)",
  cardTop:    "rgba(255,255,255,0.065)",
  elevated:   "rgba(255,255,255,0.10)",
  hairline:   "rgba(255,255,255,0.09)",
  border:     "rgba(255,255,255,0.12)",

  /* Text */
  textPrimary:   "#f7f5ff",
  textSecondary: "#aaa4b8",
  textTertiary:  "#777181",
  muted:         "#575161",

  /* Accents — iOS system palette */
  accent: "#a78bfa",
  green:  "#30d158",
  red:    "#ff453a",
  yellow: "#ffd60a",
  orange: "#ff9f0a",
  blue:   "#0a84ff",
  /* ❄️ Заморозка заказа. iOS systemCyan — единственный незанятый оттенок:
     зелёный уже WB и «К выкупу», синий — прямой, оранжевый — Авито, красный —
     ошибка, жёлтая звезда — избранное. Заморозка обязана читаться с одного
     взгляда, поэтому делит цвет ни с чем. */
  ice:    "#64d2ff",
} as const;

export const RADIUS = { sm: 11, md: 14, lg: 17, xl: 22, pill: 999 } as const;

export const SHADOW = {
  card: "0 1px 0 rgba(255,255,255,0.06) inset, 0 14px 34px rgba(3,0,12,0.18)",
  pop:  "0 18px 50px rgba(3,0,12,0.42)",
} as const;

/* Apple's "snappy" motion curves */
export const EASING = {
  spring: "cubic-bezier(0.22, 1, 0.36, 1)",
  out:    "cubic-bezier(0.16, 1, 0.3, 1)",
} as const;

export const tabular = { fontVariantNumeric: "tabular-nums" as const };

export const FONT_STACK = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
export const MONO       = "ui-monospace, SFMono-Regular, Menlo, monospace";

/* tint(hex, 0.11) → "#bf5af21c" — translucent wash behind a colored pill.
   Accepts #rrggbb; alpha is 0..1. Mirrors the `${color}1c` idiom previously
   scattered inline, but readable and reusable. */
export function tint(hex: string, alpha: number): string {
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, "0");
  return `${hex}${a}`;
}
