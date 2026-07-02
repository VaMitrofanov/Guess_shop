/* ─────────────────────────────────────────────────────────────────────────────
   theme.ts — single source of truth for the Telegram admin app (TWA).

   Apple-style dark: layered greys, vibrant accents at limited contrast,
   hairlines instead of borders. Every screen should import { C } from here
   instead of redefining a local palette. Values are the superset of what the
   individual screens used, taking OrdersScreen's refined tokens as canonical.
   ───────────────────────────────────────────────────────────────────────── */

export const C = {
  /* Surfaces */
  bg:         "#1c1c1e",
  bgElevated: "#242426",
  card:       "#2c2c2e",
  cardTop:    "rgba(255,255,255,0.04)",   // inner top-edge highlight
  elevated:   "#3a3a3c",
  hairline:   "rgba(255,255,255,0.07)",
  border:     "#3a3a3c",

  /* Text */
  textPrimary:   "#f2f2f7",
  textSecondary: "#98989d",
  textTertiary:  "#636366",
  muted:         "#48484a",

  /* Accents — iOS system palette */
  accent: "#bf5af2",
  green:  "#30d158",
  red:    "#ff453a",
  yellow: "#ffd60a",
  orange: "#ff9f0a",
  blue:   "#0a84ff",
} as const;

export const RADIUS = { sm: 10, md: 12, lg: 14, xl: 18, pill: 999 } as const;

export const SHADOW = {
  card: "0 1px 0 rgba(255,255,255,0.04) inset, 0 6px 20px rgba(0,0,0,0.18)",
  pop:  "0 8px 30px rgba(0,0,0,0.30)",
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
