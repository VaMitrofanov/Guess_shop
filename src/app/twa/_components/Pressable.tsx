"use client";
import React from "react";
import { haptic } from "./haptics";

/* ─────────────────────────────────────────────────────────────────────────────
   Pressable — tactile primitive. Adds the `.twa-press` CSS press-state
   (scale-down + brightness on :active, which inline styles cannot express)
   and fires a haptic tick on tap. Use for new interactive elements; existing
   buttons can also opt in by adding className="twa-press" + a haptic.* call.
   ───────────────────────────────────────────────────────────────────────── */

type Variant = "press" | "press-sm" | "card";
type Haptic   = "light" | "medium" | "heavy" | "rigid" | "soft" | "select" | false;

const CLASS: Record<Variant, string> = {
  press:      "twa-press",
  "press-sm": "twa-press twa-press-sm",
  card:       "twa-press twa-card-press",
};

type PressableProps = React.HTMLAttributes<HTMLElement> & {
  as?: "button" | "div" | "a";
  href?: string;
  target?: string;
  rel?: string;
  type?: "button" | "submit";
  variant?: Variant;
  haptic?: Haptic;
  disabled?: boolean;
};

export default function Pressable({
  as = "button",
  variant = "press",
  haptic: h = "light",
  onClick,
  className,
  disabled,
  children,
  ...rest
}: PressableProps) {
  const Tag = as as React.ElementType;
  const cls = `${CLASS[variant]}${className ? " " + className : ""}`;

  const handleClick = (e: React.MouseEvent<HTMLElement>) => {
    if (disabled) return;
    if (h === "select") haptic.select();
    else if (h) haptic.impact(h);
    onClick?.(e);
  };

  return (
    <Tag
      className={cls}
      onClick={handleClick}
      aria-disabled={disabled || undefined}
      disabled={as === "button" ? disabled : undefined}
      type={as === "button" ? (rest.type ?? "button") : undefined}
      {...rest}
    >
      {children}
    </Tag>
  );
}
