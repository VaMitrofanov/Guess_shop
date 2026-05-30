"use client";
import { useState } from "react";
import AnalyticsScreen from "./AnalyticsScreen";
import StocksScreen from "./StocksScreen";
import CodesScreen from "./CodesScreen";
import CalcScreen from "./CalcScreen";

const TABS = [
  { id: "analytics", label: "Аналитика" },
  { id: "stocks",    label: "Склад"     },
  { id: "calc",      label: "Расчёт"    },
  { id: "codes",     label: "Коды"      },
] as const;
type WbTab = typeof TABS[number]["id"];

const C = { accent: "#bf5af2", card: "#2c2c2e", elevated: "#3a3a3c", sec: "#8e8e93" };

export default function WbScreen({ token }: { token: string }) {
  const [tab, setTab] = useState<WbTab>("analytics");

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Segment control */}
      <div style={{
        display: "flex", gap: 6, padding: "10px 16px 0",
        flexShrink: 0,
      }}>
        <div style={{
          display: "flex", background: C.card, borderRadius: 10, padding: 3,
          width: "100%",
        }}>
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                flex: 1, padding: "7px 4px", border: "none", cursor: "pointer",
                borderRadius: 8, fontSize: 13, fontWeight: tab === t.id ? 600 : 400,
                background: tab === t.id ? C.accent : "transparent",
                color: tab === t.id ? "#fff" : C.sec,
                transition: "all 0.15s",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch" as any, marginTop: 10 }}>
        {tab === "analytics" && <AnalyticsScreen token={token} />}
        {tab === "stocks"    && <StocksScreen    token={token} />}
        {tab === "calc"      && <CalcScreen      token={token} />}
        {tab === "codes"     && <CodesScreen     token={token} />}
      </div>
    </div>
  );
}
