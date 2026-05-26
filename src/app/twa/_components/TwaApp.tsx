"use client";
import { useState, useEffect } from "react";
import BottomNav from "./BottomNav";
import Dashboard from "./screens/Dashboard";
import WbScreen from "./screens/WbScreen";
import OrdersScreen from "./screens/OrdersScreen";
import BossrobuxScreen from "./screens/BossrobuxScreen";
import SettingsScreen from "./screens/SettingsScreen";

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        ready: () => void;
        expand: () => void;
        initData: string;
        initDataUnsafe: { user?: { id: number; first_name?: string; username?: string } };
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
  const [auth,         setAuth]         = useState<"loading" | "ok" | "error">("loading");
  const [token,        setToken]        = useState<string | null>(null);
  const [screen,       setScreen]       = useState<Screen>("dashboard");
  const [debugMsg,     setDebugMsg]     = useState("");
  const [ordersBadge,  setOrdersBadge]  = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function waitForInitData(maxMs = 3000): Promise<string> {
      const deadline = Date.now() + maxMs;
      while (Date.now() < deadline) {
        const id = window.Telegram?.WebApp?.initData;
        if (id) return id;
        await new Promise(r => setTimeout(r, 100));
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
      const stored = localStorage.getItem("twa_token");

      if (stored) {
        const r = await fetch("/api/twa/dashboard", { headers: { Authorization: `Bearer ${stored}` } }).catch(() => null);
        if (cancelled) return;
        if (r?.ok) {
          setToken(stored);
          setAuth("ok");
          window.Telegram?.WebApp?.ready();
          window.Telegram?.WebApp?.expand();
          return;
        }
        localStorage.removeItem("twa_token");
      }

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

      if (!cancelled) {
        const sdk = window.Telegram?.WebApp;
        setDebugMsg(`SDK:${sdk ? "ok" : "no"} initData:"${sdk?.initData ?? ""}" unsafe:${JSON.stringify(sdk?.initDataUnsafe?.user ?? null)}`);
        setAuth("error");
      }
    })();

    return () => { cancelled = true; };
  }, []);

  // Fetch urgent orders count for badge after auth
  useEffect(() => {
    if (auth !== "ok" || !token) return;
    const refresh = () => {
      fetch("/api/twa/orders?status=PENDING&limit=1", { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.ok ? r.json() : null)
        .then(d => {
          if (!d) return;
          const urgent = (d.counts?.PENDING ?? 0) + (d.counts?.IN_PROGRESS ?? 0);
          setOrdersBadge(urgent);
        })
        .catch(() => {});
    };
    refresh();
    const iv = setInterval(refresh, 30_000);
    return () => clearInterval(iv);
  }, [auth, token]);

  if (auth === "loading") {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100dvh", background: "#1c1c1e", color: "#8e8e93" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>🟣</div>
          <div style={{ fontSize: 14 }}>Загрузка…</div>
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
        {screen === "orders"     && <OrdersScreen   {...sp} onGoToBossrobux={() => setScreen("bossrobux")} />}
        {screen === "wb"         && <WbScreen       {...sp} />}
        {screen === "bossrobux"  && <BossrobuxScreen {...sp} />}
        {screen === "settings"   && <SettingsScreen  {...sp} />}
      </div>

      <BottomNav active={screen} onChange={setScreen} ordersBadge={ordersBadge} />
    </div>
  );
}
