"use client";

import { useEffect, useId, useRef, useState } from "react";
import { signIn } from "next-auth/react";

type TelegramPayload = Record<string, string | number>;

export default function TelegramLoginButton({ mode = "login" }: { mode?: "login" | "link" }) {
  const host = useRef<HTMLDivElement>(null);
  const callbackId = `tgLogin_${useId().replace(/[^a-zA-Z0-9_]/g, "")}`;
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const target = host.current;
    if (!target) return;
    const globalWindow = window as typeof window & Record<string, unknown>;
    globalWindow[callbackId] = async (payload: TelegramPayload) => {
      setBusy(true);
      setMessage(null);
      try {
        if (mode === "login") {
          const result = await signIn("telegram-login", { ...payload, redirect: false });
          if (!result?.ok) throw new Error("Telegram не подтвердил вход");
          window.location.href = "/dashboard";
          return;
        }
        const response = await fetch("/api/account/identities/link", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider: "TG", payload }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error ?? "Не удалось связать профили");
        setMessage(data.merged ? "Профили объединены: заказы и бонусы перенесены." : "Telegram привязан.");
        window.setTimeout(() => window.location.reload(), 900);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Ошибка Telegram");
        setBusy(false);
      }
    };

    target.innerHTML = "";
    const script = document.createElement("script");
    script.async = true;
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.dataset.telegramLogin = process.env.NEXT_PUBLIC_TG_BOT_USERNAME ?? "RobloxBankBot";
    script.dataset.size = "large";
    script.dataset.radius = "0";
    script.dataset.requestAccess = "write";
    script.dataset.userpic = "false";
    script.dataset.onauth = `${callbackId}(user)`;
    target.appendChild(script);
    return () => { delete globalWindow[callbackId]; target.innerHTML = ""; };
  }, [callbackId, mode]);

  return (
    <div className="space-y-2">
      <div ref={host} className={busy ? "pointer-events-none opacity-50" : ""} aria-label={mode === "login" ? "Войти через Telegram" : "Привязать Telegram"} />
      {message && <p className="text-xs font-bold text-zinc-300" role="status">{message}</p>}
    </div>
  );
}
