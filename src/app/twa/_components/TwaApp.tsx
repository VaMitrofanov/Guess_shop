"use client";
import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import BottomNav from "./BottomNav";
import OrdersScreen from "./screens/OrdersScreen";

// Dynamically load non-default screens so the initial JS bundle is just
// the OrdersScreen (default tab) + TwaApp shell. BossrobuxScreen alone is
// ~580 LoC + framer-motion dependency; deferring it cuts cold-start time
// for the 95 % of sessions that open Orders.
const Dashboard       = dynamic(() => import("./screens/Dashboard"),      { ssr: false, loading: () => <ScreenSkeleton /> });
const WbScreen        = dynamic(() => import("./screens/WbScreen"),       { ssr: false, loading: () => <ScreenSkeleton /> });
const BossrobuxScreen = dynamic(() => import("./screens/BossrobuxScreen"), { ssr: false, loading: () => <ScreenSkeleton /> });
const SettingsScreen  = dynamic(() => import("./screens/SettingsScreen"), { ssr: false, loading: () => <ScreenSkeleton /> });

function ScreenSkeleton() {
  return (
    <div style={{ padding: "32px 16px", color: "#636366", fontSize: 13, textAlign: "center" }}>
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
        close: () => void;
      };
    };
  }
}

type Screen = "dashboard" | "orders" | "wb" | "bossrobux" | "settings";

const SCREEN_TITLES: Record<Screen, string> = {
  dashboard:  "Главная",
  orders:     "Заказы",
  wb:         "Wildberries",
  bossrobux:  "Boss Robux",
  settings:   "Настройки",
};

export default function TwaApp() {
  const [auth,               setAuth]               = useState<"loading" | "ok" | "error">("loading");
  const [token,              setToken]              = useState<string | null>(null);
  const [screen,             setScreen]             = useState<Screen>("orders");
  const [debugMsg,           setDebugMsg]           = useState("");
  const [ordersBadge,        setOrdersBadge]        = useState(0);
  const [bossrobuxPreloadId, setBossrobuxPreloadId] = useState<string | undefined>(undefined);
  // Pre-focus the Orders search when launched via admin notification deep-link.
  // Accepts either ?q=... in the URL (works with InlineKeyboardButton.web_app
  // URLs) or Telegram's start_param (works with Direct Link Apps via startapp).
  const [orderQueryPreload,  setOrderQueryPreload]  = useState<string>(() => {
    if (typeof window === "undefined") return "";
    const fromUrl = new URLSearchParams(window.location.search).get("q") ?? "";
    const fromStartParam = window.Telegram?.WebApp?.initDataUnsafe?.start_param ?? "";
    return (fromUrl || fromStartParam || "").trim();
  });

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
          setToken(stored);
          setAuth("ok");
          return;
        }
        localStorage.removeItem("twa_token");
      }

      // Fast path: initData or initDataUnsafe already populated.
      const unsafeUserEarly = window.Telegram?.WebApp?.initDataUnsafe?.user;
      const initDataEarly   = window.Telegram?.WebApp?.initData;
      if (initDataEarly) {
        doAuth({ initData: initDataEarly });
        return;
      }
      if (unsafeUserEarly?.id) {
        doAuth({ userId: unsafeUserEarly.id, firstName: unsafeUserEarly.first_name });
        return;
      }

      // Poll — SDK may still be hydrating after async beforeInteractive load.
      const initData = await waitForInitData();
      if (cancelled) return;

      if (initData) {
        doAuth({ initData });
        return;
      }

      const unsafeUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
      if (unsafeUser?.id) {
        doAuth({ userId: unsafeUser.id, firstName: unsafeUser.first_name });
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
      // entirely. The bot embeds ?uid=<adminId> in the web_app URL.
      const urlUid = new URLSearchParams(window.location.search).get("uid");
      if (urlUid) {
        doAuth({ userId: Number(urlUid) });
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

  // Fetch urgent orders count for badge after auth.
  // Uses the lightweight /urgent-count endpoint (single COUNT on indexed
  // status column) instead of the full Orders pipeline.
  useEffect(() => {
    if (auth !== "ok" || !token) return;
    const refresh = () => {
      fetch("/api/twa/orders/urgent-count", { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.ok ? r.json() : null)
        .then(d => {
          if (!d) return;
          setOrdersBadge(d.count ?? 0);
        })
        .catch(() => {});
    };
    refresh();
    const iv = setInterval(refresh, 30_000);
    return () => clearInterval(iv);
  }, [auth, token]);

  if (auth === "loading") {
    // Skeleton matches the post-auth chrome (title bar + content + bottom nav)
    // so the visual transition to the real Orders screen is a fade-in,
    // not a layout pop. Cuts perceived load time even when the JWT verify
    // takes its usual ~150 ms.
    return (
      <div style={{
        display: "flex", flexDirection: "column", height: "100dvh",
        background: "#1c1c1e", color: "#fff",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      }}>
        <div style={{ padding: "14px 16px 10px", borderBottom: "1px solid #2c2c2e" }}>
          <div style={{ width: 90, height: 18, borderRadius: 5, background: "#2c2c2e" }} />
          <div style={{ width: 60, height: 11, borderRadius: 4, background: "#2c2c2e", marginTop: 4 }} />
        </div>
        <div style={{ flex: 1, padding: "16px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
          {[0, 1, 2, 3].map(i => (
            <div key={i} style={{
              height: 96, borderRadius: 18, background: "#2c2c2e",
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
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100dvh", background: "#1c1c1e", color: "#ff453a", padding: 24 }}>
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
    <div style={{
      display: "flex", flexDirection: "column", height: "100dvh",
      background: "#1c1c1e",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      color: "#fff",
    }}>
      {/* Title bar */}
      <div style={{ padding: "14px 16px 10px", borderBottom: "1px solid #2c2c2e", flexShrink: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 18, letterSpacing: -0.3 }}>{SCREEN_TITLES[screen]}</div>
        <div style={{ fontSize: 12, color: "#636366", marginTop: 1 }}>
          {new Date().toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch" as any }}>
        {screen === "dashboard"  && <Dashboard      {...sp} />}
        {screen === "orders"     && <OrdersScreen   {...sp} onGoToBossrobux={(gpId) => { setBossrobuxPreloadId(gpId); setScreen("bossrobux"); }} initialQuery={orderQueryPreload} onInitialQueryConsumed={() => setOrderQueryPreload("")} />}
        {screen === "wb"         && <WbScreen       {...sp} />}
        {screen === "bossrobux"  && <BossrobuxScreen {...sp} preloadGamepassId={bossrobuxPreloadId} onPreloadConsumed={() => setBossrobuxPreloadId(undefined)} />}
        {screen === "settings"   && <SettingsScreen  {...sp} />}
      </div>

      <BottomNav active={screen} onChange={setScreen} ordersBadge={ordersBadge} />
    </div>
  );
}
