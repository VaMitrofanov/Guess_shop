"use client";

const TABS = [
  { id: "dashboard", icon: "🏠", label: "Главная" },
  { id: "dynamics",  icon: "📈", label: "Динамика" },
  { id: "stocks",    icon: "📦", label: "Склад" },
  { id: "advert",    icon: "📣", label: "Реклама" },
  { id: "codes",     icon: "🗃",  label: "Коды" },
] as const;

type Screen = typeof TABS[number]["id"];

export default function BottomNav({ active, onChange }: { active: Screen; onChange: (s: Screen) => void }) {
  return (
    <nav style={{
      display: "flex", borderTop: "1px solid #2c2c2e",
      background: "#1c1c1e", flexShrink: 0,
      paddingBottom: "env(safe-area-inset-bottom)",
    }}>
      {TABS.map(t => (
        <button key={t.id} onClick={() => onChange(t.id)} style={{
          flex: 1, padding: "8px 4px 6px", border: "none", background: "none", cursor: "pointer",
          display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
          color: active === t.id ? "#bf5af2" : "#636366",
          transition: "color 0.15s",
        }}>
          <span style={{ fontSize: 20 }}>{t.icon}</span>
          <span style={{ fontSize: 10, fontWeight: active === t.id ? 600 : 400 }}>{t.label}</span>
        </button>
      ))}
    </nav>
  );
}
