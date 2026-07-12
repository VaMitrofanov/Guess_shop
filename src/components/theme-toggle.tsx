"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { ThemePreference, useTheme } from "@/components/theme-provider";
import { cn } from "@/lib/utils";

const OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Светлая", icon: Sun },
  { value: "dark", label: "Тёмная", icon: Moon },
  { value: "auto", label: "Как в системе", icon: Monitor },
];

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { preference, resolvedTheme, setPreference } = useTheme();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const ActiveIcon = resolvedTheme === "dark" ? Moon : Sun;

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={cn("theme-toggle-button", compact && "theme-toggle-button-compact")}
        aria-label="Выбрать тему оформления"
        aria-expanded={open}
      >
        <ActiveIcon size={16} />
        {!compact && <span className="hidden xl:inline">Тема</span>}
      </button>
      {open && (
        <div className="theme-toggle-menu" role="menu">
          <div className="theme-toggle-title">Оформление</div>
          {OPTIONS.map(({ value, label, icon: Icon }) => (
            <button key={value} type="button" role="menuitemradio" aria-checked={preference === value} onClick={() => { setPreference(value); setOpen(false); }}>
              <Icon size={16} />
              <span>{label}</span>
              {preference === value && <Check size={15} className="ml-auto" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
