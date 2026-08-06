/* ─────────────────────────────────────────────────────────────────────────────
   haptics.ts — thin wrapper over Telegram WebApp HapticFeedback.

   Fully feature-detected and guarded: no-ops gracefully outside Telegram
   (browser dev, SSR, tests, older clients without the haptics API). Calling
   any method is always safe.

   Usage:
     haptic.impact("light")   — taps, copies, toggles
     haptic.impact("medium")  — primary actions (take-work, complete)
     haptic.notify("success") — action confirmed by server
     haptic.notify("error")   — action failed / rolled back
     haptic.select()          — filter / tab change (subtle tick)
   ───────────────────────────────────────────────────────────────────────── */

type ImpactStyle = "light" | "medium" | "heavy" | "rigid" | "soft";
type NotifyType  = "success" | "warning" | "error";

function hf(): {
  impactOccurred?: (s: ImpactStyle) => void;
  notificationOccurred?: (t: NotifyType) => void;
  selectionChanged?: () => void;
} | undefined {
  if (typeof window === "undefined") return undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as any).Telegram?.WebApp?.HapticFeedback;
}

export const haptic = {
  impact(style: ImpactStyle = "light") { try { hf()?.impactOccurred?.(style); } catch { /* no-op */ } },
  notify(type: NotifyType = "success") { try { hf()?.notificationOccurred?.(type); } catch { /* no-op */ } },
  select()                             { try { hf()?.selectionChanged?.(); } catch { /* no-op */ } },
};
