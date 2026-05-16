"use client";
import { useState, useEffect } from "react";
import BottomNav from "./BottomNav";
import Dashboard from "./screens/Dashboard";
import DynamicsScreen from "./screens/DynamicsScreen";
import StocksScreen from "./screens/StocksScreen";
import AdvertScreen from "./screens/AdvertScreen";
import CodesScreen from "./screens/CodesScreen";

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        ready: () => void;
        expand: () => void;
        initData: string;
        colorScheme: "dark" | "light";
        themeParams: Record<string, string>;
        close: () => void;
      };
    };
  }
}

type Screen = "dashboard" | "dynamics" | "stocks" | "advert" | "codes";

export default function TwaApp() {
  const [auth, setAuth] = useState<"loading" | "ok" | "error">("loading");
  const [token, setToken] = useState<string | null>(null);
  const [firstName, setFirstName] = useState("Admin");
  const [screen, setScreen] = useState<Screen>("dashboard");

  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    tg?.ready();
    tg?.expand();

    const stored = localStorage.getItem("twa_token");
    const initData = tg?.initData ?? "";

    async function doAuth(id: string) {
      const res = await fetch("/api/twa/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData: id }),
      });
      if (!res.ok) { setAuth("error"); return; }
      const data = await res.json();
      localStorage.setItem("twa_token", data.token);
      setToken(data.token);
      setFirstName(data.firstName ?? "Admin");
      setAuth("ok");
    }

    if (stored) {
      // Quick verify stored token
      fetch("/api/twa/dashboard", { headers: { Authorization: `Bearer ${stored}` } })
        .then(r => {
          if (r.ok) { setToken(stored); setAuth("ok"); }
          else if (initData) doAuth(initData);
          else { localStorage.removeItem("twa_token"); setAuth("error"); }
        })
        .catch(() => setAuth("error"));
    } else if (initData) {
      doAuth(initData);
    } else {
      // Dev: no initData — still allow if token exists
      setAuth("error");
    }
  }, []);

  if (auth === "loading") {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100dvh", background: "#1c1c1e", color: "#8e8e93", fontSize: 14 }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🟣</div>
          <div>Загрузка дашборда…</div>
        </div>
      </div>
    );
  }

  if (auth === "error") {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100dvh", background: "#1c1c1e", color: "#ff453a", fontSize: 14, padding: 24 }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🔒</div>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Доступ запрещён</div>
          <div style={{ color: "#8e8e93", fontSize: 13 }}>Открывайте из Telegram-бота</div>
        </div>
      </div>
    );
  }

  const screenProps = { token: token! };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100dvh", background: "#1c1c1e", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", color: "#fff" }}>
      {/* Header */}
      <div style={{ padding: "12px 16px 8px", borderBottom: "1px solid #2c2c2e", flexShrink: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 16, color: "#bf5af2" }}>WB Dashboard</div>
        <div style={{ fontSize: 12, color: "#8e8e93", marginTop: 2 }}>
          {firstName} · {new Date().toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
        {screen === "dashboard" && <Dashboard {...screenProps} />}
        {screen === "dynamics"  && <DynamicsScreen {...screenProps} />}
        {screen === "stocks"    && <StocksScreen {...screenProps} />}
        {screen === "advert"    && <AdvertScreen {...screenProps} />}
        {screen === "codes"     && <CodesScreen {...screenProps} />}
      </div>

      {/* Bottom Nav */}
      <BottomNav active={screen} onChange={setScreen} />
    </div>
  );
}
