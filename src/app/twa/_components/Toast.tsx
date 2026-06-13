"use client";
import { useEffect, useState } from "react";
import { C, RADIUS, SHADOW } from "./theme";

/* ─────────────────────────────────────────────────────────────────────────────
   Toast — one global, glassy toast layer for the whole TWA. Any component can
   fire one via the module-level `toast()` (no context/provider plumbing). A
   single <ToastHost/> lives in TwaApp.
   ───────────────────────────────────────────────────────────────────────── */

type Tone = "default" | "success" | "error";
interface ToastItem { id: number; msg: string; tone: Tone }

let _id = 0;
const listeners = new Set<(t: ToastItem) => void>();

export function toast(msg: string, tone: Tone = "default") {
  const item: ToastItem = { id: ++_id, msg, tone };
  listeners.forEach(l => l(item));
}

export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const onToast = (t: ToastItem) => {
      setItems(prev => [...prev.slice(-2), t]);
      setTimeout(() => setItems(prev => prev.filter(x => x.id !== t.id)), 2600);
    };
    listeners.add(onToast);
    return () => { listeners.delete(onToast); };
  }, []);

  if (items.length === 0) return null;

  return (
    <div style={{
      position: "fixed", left: 0, right: 0,
      bottom: "calc(env(safe-area-inset-bottom) + 78px)",
      display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
      zIndex: 2000, pointerEvents: "none", padding: "0 16px",
    }}>
      {items.map(t => {
        const color = t.tone === "success" ? C.green : t.tone === "error" ? C.red : C.textPrimary;
        const bg =
          t.tone === "success" ? "rgba(48,209,88,0.16)" :
          t.tone === "error"   ? "rgba(255,69,58,0.16)" :
                                 "rgba(58,58,60,0.94)";
        return (
          <div key={t.id} className="twa-toast-in" style={{
            maxWidth: 440, width: "fit-content",
            background: bg, color,
            backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
            borderRadius: RADIUS.md, padding: "11px 16px",
            fontSize: 13.5, fontWeight: 500, letterSpacing: 0.1,
            boxShadow: SHADOW.pop, border: `1px solid ${C.hairline}`,
            textAlign: "center",
          }}>
            {t.msg}
          </div>
        );
      })}
    </div>
  );
}
