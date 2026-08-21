"use client";

import { useState } from "react";
import {
  CircleUserRound,
  ClipboardList,
  Ellipsis,
  House,
  Settings,
  Truck,
  Warehouse,
  Wallet,
  X,
} from "lucide-react";
import { haptic } from "./haptics";
import { C } from "./theme";

type Screen = "dashboard" | "orders" | "wb" | "delivery" | "account" | "settings" | "system" | "economics";

const MAIN_TABS = [
  { id: "dashboard" as const, label: "Главная", Icon: House },
  { id: "orders" as const, label: "Заказы", Icon: ClipboardList },
  { id: "account" as const, label: "Аккаунт", Icon: CircleUserRound },
];

export default function BottomNav({
  active,
  onChange,
  ordersBadge = 0,
  dbsBadge = 0,
}: {
  active: Screen;
  onChange: (screen: Screen) => void;
  ordersBadge?: number;
  dbsBadge?: number;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreActive = active === "wb" || active === "delivery" || active === "settings" || active === "system" || active === "economics";

  function navigate(screen: Screen) {
    if (screen !== active) haptic.select();
    setMoreOpen(false);
    onChange(screen);
  }

  return (
    <div className="twa-nav-zone">
      {moreOpen && (
        <div className="twa-more-sheet twa-glass-strong twa-fade-up">
          <div className="twa-more-sheet-head">
            <div>
              <span>Разделы</span>
              <strong>Ещё</strong>
            </div>
            <button
              type="button"
              className="twa-icon-button twa-press-sm"
              aria-label="Закрыть меню"
              onClick={() => { haptic.select(); setMoreOpen(false); }}
            >
              <X size={18} />
            </button>
          </div>
          <button type="button" className="twa-more-row twa-press-sm" onClick={() => navigate("economics")}>
            <span className="twa-more-icon"><Wallet size={19} /></span>
            <span><strong>Экономика</strong><small>Прямые заказы, робуксы и бонусы</small></span>
            <span aria-hidden="true">›</span>
          </button>
          <button type="button" className="twa-more-row twa-press-sm" onClick={() => navigate("delivery")}>
            <span className="twa-more-icon"><Truck size={19} /></span>
            <span><strong>WB Доставка</strong><small>DBS-заказы, чаты и коды выдачи</small></span>
            <span aria-hidden="true">›</span>
          </button>
          <button type="button" className="twa-more-row twa-press-sm" onClick={() => navigate("wb")}>
            <span className="twa-more-icon"><Warehouse size={19} /></span>
            <span><strong>Wildberries</strong><small>Аналитика, склад и коды</small></span>
            <span aria-hidden="true">›</span>
          </button>
          <button type="button" className="twa-more-row twa-press-sm" onClick={() => navigate("settings")}>
            <span className="twa-more-icon"><Settings size={19} /></span>
            <span><strong>Настройки</strong><small>Система, курсы и автобай</small></span>
            <span aria-hidden="true">›</span>
          </button>
        </div>
      )}

      <nav className="twa-liquid-tabbar" aria-label="Основная навигация">
        {MAIN_TABS.map(({ id, label, Icon }) => {
          const selected = active === id;
          const badge = id === "orders" && ordersBadge > 0 ? ordersBadge : 0;
          return (
            <button
              key={id}
              type="button"
              className={`twa-tab twa-press${selected ? " is-selected" : ""}`}
              aria-current={selected ? "page" : undefined}
              onClick={() => navigate(id)}
            >
              <span className="twa-tab-icon">
                <Icon size={21} strokeWidth={selected ? 2.2 : 1.8} />
                {badge > 0 && <b style={{ background: C.red }}>{badge > 99 ? "99+" : badge}</b>}
              </span>
              <span>{label}</span>
            </button>
          );
        })}
        <button
          type="button"
          className={`twa-tab twa-press${moreActive || moreOpen ? " is-selected" : ""}`}
          aria-expanded={moreOpen}
          onClick={() => { haptic.select(); setMoreOpen(open => !open); }}
        >
          <span className="twa-tab-icon">
            <Ellipsis size={22} />
            {dbsBadge > 0 && <b style={{ background: C.accent }}>{dbsBadge > 99 ? "99+" : dbsBadge}</b>}
          </span>
          <span>Ещё</span>
        </button>
      </nav>
    </div>
  );
}
