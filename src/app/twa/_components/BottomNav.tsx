"use client";
import React from "react";

type Screen = "dashboard" | "analytics" | "stocks" | "codes" | "calc";

const HomeIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5z"/>
    <path d="M9 21V12h6v9"/>
  </svg>
);

const AnalyticsIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="20" x2="18" y2="10"/>
    <line x1="12" y1="20" x2="12" y2="4"/>
    <line x1="6"  y1="20" x2="6"  y2="14"/>
  </svg>
);

const StocksIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
    <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
    <line x1="12" y1="22.08" x2="12" y2="12"/>
  </svg>
);

const CodesIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="3" width="20" height="14" rx="2"/>
    <line x1="8"  y1="21" x2="16" y2="21"/>
    <line x1="12" y1="17" x2="12" y2="21"/>
  </svg>
);

const CalcIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="2" width="16" height="20" rx="2"/>
    <line x1="8"  y1="6"  x2="16" y2="6"/>
    <line x1="8"  y1="12" x2="10" y2="12"/>
    <line x1="12" y1="12" x2="14" y2="12"/>
    <line x1="16" y1="12" x2="16" y2="12"/>
    <line x1="8"  y1="16" x2="8"  y2="16"/>
    <line x1="12" y1="16" x2="12" y2="16"/>
    <line x1="16" y1="16" x2="16" y2="16"/>
  </svg>
);

const TABS: { id: Screen; label: string; Icon: () => React.ReactElement }[] = [
  { id: "dashboard", label: "Главная",    Icon: HomeIcon      },
  { id: "analytics", label: "Аналитика",  Icon: AnalyticsIcon },
  { id: "stocks",    label: "Склад",      Icon: StocksIcon    },
  { id: "codes",     label: "Коды",       Icon: CodesIcon     },
  { id: "calc",      label: "Калькулятор",Icon: CalcIcon      },
];

export default function BottomNav({ active, onChange }: { active: Screen; onChange: (s: Screen) => void }) {
  return (
    <nav style={{
      display: "flex",
      borderTop: "1px solid #2c2c2e",
      background: "#1c1c1e",
      flexShrink: 0,
      paddingBottom: "env(safe-area-inset-bottom)",
    }}>
      {TABS.map(({ id, label, Icon }) => {
        const isActive = active === id;
        return (
          <button
            key={id}
            onClick={() => onChange(id)}
            style={{
              flex: 1, padding: "9px 2px 7px", border: "none", background: "none",
              cursor: "pointer", display: "flex", flexDirection: "column",
              alignItems: "center", gap: 3,
              color: isActive ? "#bf5af2" : "#636366",
              transition: "color 0.15s",
              position: "relative",
            }}
          >
            {isActive && (
              <div style={{
                position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)",
                width: 32, height: 2, background: "#bf5af2", borderRadius: "0 0 2px 2px",
              }} />
            )}
            <Icon />
            <span style={{ fontSize: 10, fontWeight: isActive ? 600 : 400, letterSpacing: 0.1 }}>
              {label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
