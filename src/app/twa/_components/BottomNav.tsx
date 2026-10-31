"use client";

import { DONOR_ENABLED } from "@/lib/donor-mode";
import { useRef, useState } from "react";
import {
  Activity,
  CircleUserRound,
  ClipboardList,
  Copy,
  Ellipsis,
  Plus,
  Search,
  Settings,
  ShieldAlert,
  ShoppingBag,
  Sun,
  Ticket,
  Truck,
  Wallet,
  X,
  Zap,
} from "lucide-react";
import BottomSheet from "./BottomSheet";
import { haptic } from "./haptics";
import { C } from "./theme";

type Screen = "dashboard" | "orders" | "wb" | "delivery" | "account" | "settings" | "system" | "economics" | "risks";

const LEFT_TABS = [
  { id: "dashboard" as const, label: "Сегодня", Icon: Sun },
  { id: "orders" as const, label: "Заказы", Icon: ClipboardList },
];
const RIGHT_TABS = [
  { id: "delivery" as const, label: "Доставка", Icon: Truck },
];

/** Что умеет центральная «＋». Обработчик — в TwaApp: он знает экраны. */
export type QuickAction =
  | { kind: "create"; mode: "manual" | "direct" }
  | { kind: "buyout" }
  | { kind: "search" }
  | { kind: "export" }
  | { kind: "codes" }
  | { kind: "open"; code: string };

/* Недавно открытые заказы — пишет шторка заказа (OrdersScreen), читают
   «＋» и поиск. Только удобство одного устройства: localStorage. */
export const RECENT_KEY = "twa_recent_orders";
export function readRecentOrders(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(list) ? list.filter((x: unknown) => typeof x === "string").slice(0, 8) : [];
  } catch { return []; }
}

export default function BottomNav({
  active,
  onChange,
  ordersBadge = 0,
  dbsBadge = 0,
  risksBadge = 0,
  onQuick,
}: {
  active: Screen;
  onChange: (screen: Screen) => void;
  ordersBadge?: number;
  dbsBadge?: number;
  /** Открытые события раздела «Риски» (30.10.2026). */
  risksBadge?: number;
  onQuick: (action: QuickAction) => void;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  /* Долгое нажатие на «＋» — сразу новый заказ, без меню: самое частое. */
  const pressTimer = useRef<number | null>(null);
  const longPressed = useRef(false);
  function quick(action: QuickAction) {
    haptic.select();
    setQuickOpen(false);
    setMoreOpen(false);
    onQuick(action);
  }
  const moreActive = active === "account" || active === "wb" || active === "settings" || active === "system" || active === "economics" || active === "risks";

  function navigate(screen: Screen) {
    if (screen !== active) haptic.select();
    setMoreOpen(false);
    onChange(screen);
  }

  function renderTab({ id, label, Icon }: { id: "dashboard" | "orders" | "delivery"; label: string; Icon: typeof Sun }) {
    const selected = active === id;
    /* Счётчик доставок — на «Доставке». До 20.10 он висел на «Ещё». */
    const badge = id === "orders" ? ordersBadge : id === "delivery" ? dbsBadge : 0;
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
          {badge > 0 && <b style={{ background: id === "delivery" ? C.accent : C.red }}>{badge > 99 ? "99+" : badge}</b>}
        </span>
        <span>{label}</span>
      </button>
    );
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
          {/* Разделы по смыслу, а не списком: контроль, деньги, магазин, система. */}
          <div className="twa-more-group">Контроль</div>
          <button type="button" className="twa-more-row twa-press-sm" onClick={() => navigate("risks")}>
            <span className="twa-more-icon is-red"><ShieldAlert size={19} /></span>
            <span><strong>Риски</strong><small>Плохие отзывы, исправления, возвраты</small></span>
            {risksBadge > 0
              ? <b className="twa-more-badge">{risksBadge > 99 ? "99+" : risksBadge}</b>
              : <span aria-hidden="true">›</span>}
          </button>
          <div className="twa-more-group">Деньги</div>
          <button type="button" className="twa-more-row twa-press-sm" onClick={() => navigate("economics")}>
            <span className="twa-more-icon is-green"><Wallet size={19} /></span>
            <span><strong>Экономика</strong><small>Прямые заказы, робуксы и бонусы</small></span>
            <span aria-hidden="true">›</span>
          </button>
          <button type="button" className="twa-more-row twa-press-sm" onClick={() => navigate("account")}>
            <span className="twa-more-icon is-purple"><CircleUserRound size={19} /></span>
            {DONOR_ENABLED
              ? <span><strong>Аккаунт</strong><small>Донор, автобай и выкуп</small></span>
              : <span><strong>Антон</strong><small>Партнёр: задачи, баланс, сверка</small></span>}
            <span aria-hidden="true">›</span>
          </button>
          <div className="twa-more-group">Магазин</div>
          <button type="button" className="twa-more-row twa-press-sm" onClick={() => navigate("wb")}>
            <span className="twa-more-icon is-pink"><ShoppingBag size={19} /></span>
            <span><strong>Wildberries</strong><small>Продажи, отзывы, склад</small></span>
            <span aria-hidden="true">›</span>
          </button>
          <button type="button" className="twa-more-row twa-press-sm" onClick={() => quick({ kind: "codes" })}>
            <span className="twa-more-icon is-orange"><Ticket size={19} /></span>
            <span><strong>Коды</strong><small>Партии карт, печать, остатки</small></span>
            <span aria-hidden="true">›</span>
          </button>
          <div className="twa-more-group">Система</div>
          <button type="button" className="twa-more-row twa-press-sm" onClick={() => navigate("settings")}>
            <span className="twa-more-icon"><Settings size={19} /></span>
            <span><strong>Настройки</strong><small>Курсы, автобай, тестовые коды</small></span>
            <span aria-hidden="true">›</span>
          </button>
          <button type="button" className="twa-more-row twa-press-sm" onClick={() => navigate("system")}>
            <span className="twa-more-icon"><Activity size={19} /></span>
            <span><strong>Мониторинг</strong><small>Боты, мосты, деплой</small></span>
            <span aria-hidden="true">›</span>
          </button>
        </div>
      )}

      <nav className="twa-liquid-tabbar is-five" aria-label="Основная навигация">
        {LEFT_TABS.map(tab => renderTab(tab))}
        {/* «＋» — быстрые действия: тап открывает меню, долгое нажатие сразу
            создаёт заказ. */}
        <button
          type="button"
          className="twa-fab twa-press"
          aria-label="Быстрые действия"
          aria-haspopup="dialog"
          onPointerDown={() => {
            longPressed.current = false;
            pressTimer.current = window.setTimeout(() => {
              longPressed.current = true;
              haptic.impact("medium");
              quick({ kind: "create", mode: "manual" });
            }, 450);
          }}
          onPointerUp={() => { if (pressTimer.current) window.clearTimeout(pressTimer.current); }}
          onPointerLeave={() => { if (pressTimer.current) window.clearTimeout(pressTimer.current); }}
          onClick={() => {
            if (longPressed.current) { longPressed.current = false; return; }
            haptic.impact("light");
            setMoreOpen(false);
            setRecent(readRecentOrders());
            setQuickOpen(true);
          }}
        >
          <Plus size={26} strokeWidth={2.4} />
        </button>
        {RIGHT_TABS.map(tab => renderTab(tab))}
        <button
          type="button"
          className={`twa-tab twa-press${moreActive || moreOpen ? " is-selected" : ""}`}
          aria-expanded={moreOpen}
          onClick={() => { haptic.select(); setMoreOpen(open => !open); }}
        >
          <span className="twa-tab-icon">
            <Ellipsis size={22} />
            {risksBadge > 0 && <b style={{ background: C.red }}>{risksBadge > 99 ? "99+" : risksBadge}</b>}
          </span>
          <span>Ещё</span>
        </button>
      </nav>

      <BottomSheet open={quickOpen} onClose={() => setQuickOpen(false)} ariaLabel="Быстрые действия" className="twa-quick-sheet">
        <div className="twa-quick">
          <div className="twa-quick-head"><b>Быстрые действия</b><small>Долгое нажатие на «＋» — сразу новый заказ</small></div>
          <div className="twa-quick-grid">
            <button type="button" className="twa-quick-tile is-primary twa-press-sm" onClick={() => quick({ kind: "create", mode: "manual" })}>
              <Plus size={22} /><b>Новый заказ</b><small>код ВБ, ник, пасс</small>
            </button>
            <button type="button" className="twa-quick-tile twa-press-sm" onClick={() => quick({ kind: "create", mode: "direct" })}>
              <Wallet size={22} /><b>Прямой заказ</b><small>оплата у нас</small>
            </button>
            <button type="button" className="twa-quick-tile is-green twa-press-sm" onClick={() => quick({ kind: "buyout" })}>
              <Zap size={22} /><b>Начать выкуп</b><small>очередь «Выкупить»</small>
            </button>
            <button type="button" className="twa-quick-tile twa-press-sm" onClick={() => quick({ kind: "search" })}>
              <Search size={22} /><b>Найти</b><small>код, ник, @, ID пасса</small>
            </button>
            <button type="button" className="twa-quick-tile twa-press-sm" onClick={() => quick({ kind: "export" })}>
              <Copy size={22} /><b>ID очереди</b><small>выгрузить пачкой</small>
            </button>
            <button type="button" className="twa-quick-tile twa-press-sm" onClick={() => quick({ kind: "codes" })}>
              <Ticket size={22} /><b>Коды ВБ</b><small>партии и остатки</small>
            </button>
          </div>
          {recent.length > 0 && (
            <>
              <div className="twa-quick-label">Недавно открывали</div>
              <div className="twa-quick-recent">
                {recent.map(code => (
                  <button key={code} type="button" className="twa-press-sm" onClick={() => quick({ kind: "open", code })}>{code}</button>
                ))}
              </div>
            </>
          )}
        </div>
      </BottomSheet>
    </div>
  );
}
