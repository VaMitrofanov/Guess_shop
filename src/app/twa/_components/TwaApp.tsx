"use client";
import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import BottomNav from "./BottomNav";
import { ToastHost } from "./Toast";
import { C } from "./theme";
import { haptic } from "./haptics";

const Dashboard       = dynamic(() => import("./screens/Dashboard"),      { ssr: false, loading: () => <ScreenSkeleton /> });
const OrdersScreen    = dynamic(() => import("./screens/OrdersScreen"),   { ssr: false, loading: () => <ScreenSkeleton /> });
const WbScreen        = dynamic(() => import("./screens/WbScreen"),       { ssr: false, loading: () => <ScreenSkeleton /> });
const WbDeliveryScreen = dynamic(() => import("./screens/WbDeliveryScreen"), { ssr: false, loading: () => <ScreenSkeleton /> });
const AccountScreen   = dynamic(() => import("./screens/BossrobuxScreen"), { ssr: false, loading: () => <ScreenSkeleton /> });
const SettingsScreen  = dynamic(() => import("./screens/SettingsScreen"), { ssr: false, loading: () => <ScreenSkeleton /> });
const SystemScreen    = dynamic(() => import("./screens/SystemScreen"),   { ssr: false, loading: () => <ScreenSkeleton /> });
const EconomicsScreen = dynamic(() => import("./screens/EconomicsScreen"), { ssr: false, loading: () => <ScreenSkeleton /> });

function ScreenSkeleton() {
  return (
    <div style={{ padding: "32px 16px", color: C.textSecondary, fontSize: 13, textAlign: "center" }}>
      Загружаем экран…
    </div>
  );
}

declare global {
  interface Window {
    __tgHash?: string;
    Telegram?: {
      WebApp?: {
        ready: () => void;
        expand: () => void;
        initData: string;
        initDataUnsafe: {
          user?: { id: number; first_name?: string; username?: string };
          start_param?: string;
        };
        colorScheme: "dark" | "light";
        themeParams: Record<string, string>;
        platform?: string;
        close: () => void;
        BackButton?: {
          show: () => void;
          hide: () => void;
          onClick: (callback: () => void) => void;
          offClick: (callback: () => void) => void;
        };
      };
    };
  }
}

type Screen = "dashboard" | "orders" | "wb" | "delivery" | "account" | "settings" | "system" | "economics";

const SCREEN_TITLES: Record<Screen, string> = {
  dashboard:  "Главная",
  orders:     "Заказы",
  wb:         "Wildberries",
  delivery:   "WB Доставка",
  account:    "Аккаунт",
  settings:   "Настройки",
  system:     "Система",
  economics:  "Экономика",
};

// Drill-down screens reachable from a parent tab (not in the bottom nav).
// The title bar shows a back chevron to the parent instead of the date.
const SCREEN_PARENT: Partial<Record<Screen, Screen>> = {
  system: "settings",
  delivery: "wb",
};

export default function TwaApp() {
  const [auth,               setAuth]               = useState<"loading" | "ok" | "error">("loading");
  const [token,              setToken]              = useState<string | null>(null);
  const [screen,             setScreen]             = useState<Screen>(() => {
    if (typeof window === "undefined") return "dashboard";
    const q = new URLSearchParams(window.location.search).get("q");
    const start = window.Telegram?.WebApp?.initDataUnsafe?.start_param;
    return q || start ? "orders" : "dashboard";
  });
  const [debugMsg,           setDebugMsg]           = useState("");
  const [ordersBadge,        setOrdersBadge]        = useState(0);
  // Pre-focus the Orders search when launched via admin notification deep-link.
  // Accepts either ?q=... in the URL (works with InlineKeyboardButton.web_app
  // URLs) or Telegram's start_param (works with Direct Link Apps via startapp).
  const [orderQueryPreload,  setOrderQueryPreload]  = useState<string>(() => {
    if (typeof window === "undefined") return "";
    const fromUrl = new URLSearchParams(window.location.search).get("q") ?? "";
    const fromStartParam = window.Telegram?.WebApp?.initDataUnsafe?.start_param ?? "";
    return (fromUrl || fromStartParam || "").trim();
  });
  // Ф2: виджет «Ошибки» дашборда «Свои» открывает Заказы сразу на вкладке ERROR.
  const [ordersTabPreload,   setOrdersTabPreload]   = useState<string>("");
  const [wbTabPreload,       setWbTabPreload]       = useState<"analytics" | "reviews">("analytics");

  useEffect(() => {
    let cancelled = false;

    function extractInitDataFromHash(hash: string): string {
      if (!hash || !hash.includes("tgWebAppData")) return "";
      const params = new URLSearchParams(hash.replace(/^#/, ""));
      return params.get("tgWebAppData") ?? "";
    }

    async function waitForInitData(maxMs = 3000): Promise<string> {
      const deadline = Date.now() + maxMs;
      while (Date.now() < deadline) {
        const id = window.Telegram?.WebApp?.initData;
        if (id) return id;
        await new Promise(r => setTimeout(r, 50));
      }
      return "";
    }

    async function doAuth(payload: Record<string, unknown>) {
      // platform (ios/android/macos/tdesktop…) — для серверного лога
      // [twa-auth]: инструментирование риска #1 (наличие initData).
      payload.platform = window.Telegram?.WebApp?.platform ?? "unknown";
      const res = await fetch("/api/twa/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (!cancelled) {
          setDebugMsg(`HTTP ${res.status}: ${body.error ?? "unknown"}`);
          setAuth("error");
        }
        return;
      }
      const data = await res.json();
      localStorage.setItem("twa_token", data.token);
      if (cancelled) return;
      setToken(data.token);
      setAuth("ok");
      window.Telegram?.WebApp?.ready();
      window.Telegram?.WebApp?.expand();
    }

    (async () => {
      // Signal Telegram that the app is ready — on some iOS versions this
      // triggers the native side to populate initData/initDataUnsafe.
      window.Telegram?.WebApp?.ready();
      window.Telegram?.WebApp?.expand();

      const stored = localStorage.getItem("twa_token");

      if (stored) {
        const r = await fetch("/api/twa/ping", { headers: { Authorization: `Bearer ${stored}` } }).catch(() => null);
        if (cancelled) return;
        if (r?.ok) {
          // U1: TTL сокращён до 2 ч, ping тихо продлевает пропуск при работе.
          const body = await r.json().catch(() => null);
          const fresh = typeof body?.token === "string" ? body.token : stored;
          if (fresh !== stored) localStorage.setItem("twa_token", fresh);
          setToken(fresh);
          setAuth("ok");
          return;
        }
        localStorage.removeItem("twa_token");
      }

      // Fast path: initData already populated.
      //
      // U1: ветки с `initDataUnsafe.user.id` и `?uid=` убраны — они посылали
      // серверу неподписанный Telegram ID, а он не секретен. Запасной путь
      // теперь один: подписанный ботом `?k=` (см. bots/tg/admin/menu.ts).
      const initDataEarly = window.Telegram?.WebApp?.initData;
      if (initDataEarly) {
        doAuth({ initData: initDataEarly });
        return;
      }

      // Poll — SDK may still be hydrating after async beforeInteractive load.
      const initData = await waitForInitData();
      if (cancelled) return;

      if (initData) {
        doAuth({ initData });
        return;
      }

      // Fallback: parse the hash captured by the inline script in layout.tsx
      // before Next.js async script loading had a chance to run.
      const earlyHash = window.__tgHash ?? "";
      const hashInitData = extractInitDataFromHash(earlyHash) || extractInitDataFromHash(location.hash);
      if (hashInitData) {
        doAuth({ initData: hashInitData });
        return;
      }

      // Fallback: iOS Telegram v9.6+ omits tgWebAppData from the hash
      // entirely. Бот подписывает токен запуска и кладёт его в web_app-ссылку
      // как `?k=` — знание публичного Telegram ID больше не даёт входа.
      const linkToken = new URLSearchParams(window.location.search).get("k");
      if (linkToken) {
        doAuth({ linkToken });
        return;
      }

      if (!cancelled) {
        const sdk = window.Telegram?.WebApp;
        setDebugMsg(
          `SDK:${sdk ? "ok" : "no"} initData:"${sdk?.initData ?? ""}" ` +
          `unsafe:${JSON.stringify(sdk?.initDataUnsafe?.user ?? null)} ` +
          `hash:${earlyHash ? earlyHash.slice(0, 80) + "…" : "(empty)"}`
        );
        setAuth("error");
      }
    })();

    return () => { cancelled = true; };
  }, []);

  // ready()+expand() гарантированно после реальной загрузки SDK: путь с
  // сохранённым токеном раньше их пропускал, и на iOS Telegram viewport мог
  // остаться неразвёрнутым (нижний бар за пределами видимой области).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const deadline = Date.now() + 6000;
      while (!cancelled && Date.now() < deadline) {
        const wa = window.Telegram?.WebApp;
        if (wa) {
          try { wa.ready(); wa.expand(); } catch { /* SDK ещё гидрируется */ }
          return;
        }
        await new Promise(r => setTimeout(r, 100));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Fetch urgent orders count for badge after auth.
  // Uses the lightweight /urgent-count endpoint (single COUNT on indexed
  // status column) instead of the full Orders pipeline.
  const refreshBadge = useCallback(() => {
    if (!token) return;
    fetch("/api/twa/orders/urgent-count", { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setOrdersBadge(d.count ?? 0); })
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    if (auth !== "ok" || !token) return;
    refreshBadge();
    const iv = setInterval(refreshBadge, 30_000);
    return () => clearInterval(iv);
  }, [auth, token, refreshBadge]);

  if (auth === "loading") {
    // Skeleton matches the post-auth chrome (title bar + content + bottom nav)
    // so the visual transition to the real Orders screen is a fade-in,
    // not a layout pop. Cuts perceived load time even when the JWT verify
    // takes its usual ~150 ms.
    return (
      <div className="twa-root twa-liquid-root twa-loading-shell" style={{
        display: "flex", flexDirection: "column",
        background: C.bg, color: C.textPrimary,
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      }}>
        <div className="twa-liquid-titlebar">
          <div style={{ width: 118, height: 24, borderRadius: 7, background: C.elevated }} />
          <div style={{ width: 74, height: 12, borderRadius: 5, background: C.elevated, marginTop: 5 }} />
        </div>
        <div style={{ flex: 1, padding: "16px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
          {[0, 1, 2, 3].map(i => (
            <div key={i} style={{
              height: 96, borderRadius: 20, background: C.card,
              boxShadow: "0 1px 0 rgba(255,255,255,0.04) inset",
              opacity: 0.7 - i * 0.12,
            }} />
          ))}
        </div>
      </div>
    );
  }

  if (auth === "error") {
    return (
      <div className="twa-root twa-liquid-root" style={{ display: "flex", alignItems: "center", justifyContent: "center", background: C.bg, color: C.red, padding: 24 }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>🔒</div>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Доступ запрещён</div>
          <div style={{ color: "#8e8e93", fontSize: 13 }}>Открывайте из Telegram-бота</div>
          {debugMsg && <div style={{ color: "#ff9f0a", fontSize: 11, marginTop: 12, fontFamily: "monospace" }}>{debugMsg}</div>}
        </div>
      </div>
    );
  }

  const sp = { token: token! };

  return (
    <div className="twa-root twa-liquid-root" style={{
      display: "flex", flexDirection: "column",
      background: C.bg,
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      color: C.textPrimary,
    }}>
      {/* Title bar — doubles as a context zone: back chevron on drill-down
          screens, date otherwise. */}
      <div className="twa-liquid-titlebar">
        {(() => {
          const parent = SCREEN_PARENT[screen];
          if (parent) {
            return (
              <>
                <button
                  className="twa-press-sm"
                  onClick={() => { haptic.select(); setScreen(parent); }}
                  style={{
                    background: "none", border: "none", padding: 0, cursor: "pointer",
                    display: "flex", alignItems: "center", gap: 3,
                    color: C.accent, fontSize: 14, fontWeight: 500, marginBottom: 2,
                    fontFamily: "inherit",
                  }}
                >
                  <span style={{ fontSize: 19, lineHeight: 1, marginTop: -1 }}>‹</span>
                  {SCREEN_TITLES[parent]}
                </button>
                <div className="twa-liquid-title">{SCREEN_TITLES[screen]}</div>
              </>
            );
          }
          return (
            <>
              <div style={{ fontSize: 13, color: C.textSecondary, marginBottom: 1 }}>
                {new Date().toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}
              </div>
              <div className="twa-liquid-title">{SCREEN_TITLES[screen]}</div>
            </>
          );
        })()}
      </div>

      {/* Content */}
      <div className="twa-liquid-content" style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
        {screen === "dashboard"  && <Dashboard      {...sp}
          onOpenOrders={(query, tab) => { setOrderQueryPreload(query ?? ""); setOrdersTabPreload(tab ?? ""); setScreen("orders"); }}
          onOpenAccount={() => setScreen("account")}
          onOpenInbox={() => { setWbTabPreload("reviews"); setScreen("wb"); }}
        />}
        {screen === "orders"     && <OrdersScreen   {...sp} onActionDone={refreshBadge} initialQuery={orderQueryPreload} initialTab={ordersTabPreload} onInitialQueryConsumed={() => { setOrderQueryPreload(""); setOrdersTabPreload(""); }} />}
        {screen === "wb"         && <WbScreen       {...sp} initialTab={wbTabPreload} />}
        {screen === "delivery"   && <WbDeliveryScreen {...sp} />}
        {screen === "account"    && <AccountScreen  {...sp} onOpenErrors={() => { setOrdersTabPreload("ERROR"); setScreen("orders"); }} />}
        {screen === "settings"   && <SettingsScreen  {...sp} onNavigate={(s) => setScreen(s as Screen)} />}
        {screen === "system"     && <SystemScreen    {...sp} />}
        {screen === "economics"  && <EconomicsScreen {...sp} />}
      </div>

      <BottomNav active={screen} onChange={setScreen} ordersBadge={ordersBadge} />
      <ToastHost />
    </div>
  );
}
