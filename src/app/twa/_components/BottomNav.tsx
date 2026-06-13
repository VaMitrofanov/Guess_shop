"use client";
import React from "react";
import { haptic } from "./haptics";
import { C, tint } from "./theme";

type Screen = "dashboard" | "orders" | "wb" | "bossrobux" | "settings" | "system";

const HomeIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5z"/>
    <path d="M9 21V12h6v9"/>
  </svg>
);

const OrdersIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>
    <rect x="9" y="3" width="6" height="4" rx="1"/>
    <line x1="9"  y1="12" x2="15" y2="12"/>
    <line x1="9"  y1="16" x2="13" y2="16"/>
  </svg>
);

const WbIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
  </svg>
);

const BossrobuxIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="9" cy="21" r="1"/>
    <circle cx="20" cy="21" r="1"/>
    <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
  </svg>
);

const SettingsIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
  </svg>
);

const TABS: { id: Screen; label: string; Icon: () => React.ReactElement }[] = [
  { id: "orders",     label: "Заказы",   Icon: OrdersIcon      },
  { id: "wb",         label: "WB",       Icon: WbIcon          },
  { id: "bossrobux",  label: "Выкуп",    Icon: BossrobuxIcon   },
  { id: "dashboard",  label: "Главная",  Icon: HomeIcon        },
  { id: "settings",   label: "Настройки",Icon: SettingsIcon    },
];

export default function BottomNav({
  active, onChange, ordersBadge = 0,
}: {
  active: Screen;
  onChange: (s: Screen) => void;
  ordersBadge?: number;
}) {
  return (
    <nav style={{
      display: "flex",
      borderTop: `1px solid ${C.hairline}`,
      background: C.bg,
      flexShrink: 0,
      paddingBottom: "env(safe-area-inset-bottom)",
    }}>
      {TABS.map(({ id, label, Icon }) => {
        const isActive = active === id || (id === "settings" && active === "system");
        const badge = id === "orders" && ordersBadge > 0 ? ordersBadge : 0;
        return (
          <button
            key={id}
            className="twa-press"
            onClick={() => { if (!isActive) haptic.select(); onChange(id); }}
            style={{
              flex: 1, padding: "8px 1px 7px", border: "none", background: "none",
              cursor: "pointer", display: "flex", flexDirection: "column",
              alignItems: "center", gap: 3,
              color: isActive ? C.accent : C.textTertiary,
              transition: "color 0.15s",
              position: "relative",
            }}
          >
            <div style={{
              position: "relative",
              display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
              background: isActive ? tint(C.accent, 0.15) : "transparent",
              borderRadius: 14,
              padding: "5px 14px",
              transition: "background 0.15s",
            }}>
              <div style={{ position: "relative" as const }}>
                <Icon />
                {badge > 0 && (
                  <div style={{
                    position: "absolute", top: -4, right: -6,
                    background: C.red, color: "#fff",
                    fontSize: 9, fontWeight: 700, lineHeight: 1,
                    padding: "2px 4px", borderRadius: 8, minWidth: 14,
                    textAlign: "center" as const,
                  }}>
                    {badge > 99 ? "99+" : badge}
                  </div>
                )}
              </div>
              <span style={{ fontSize: 10, fontWeight: isActive ? 600 : 400, letterSpacing: 0.1 }}>
                {label}
              </span>
            </div>
          </button>
        );
      })}
    </nav>
  );
}
