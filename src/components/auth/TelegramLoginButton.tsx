"use client";

import { useState } from "react";
import { Loader2, Send } from "lucide-react";

export default function TelegramLoginButton({
  mode = "login",
  className,
  returnTo,
}: {
  mode?: "login" | "link";
  className?: string;
  returnTo?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const begin = async () => {
    setBusy(true);
    setMessage(null);
    try {
      if (mode === "login" && returnTo) sessionStorage.setItem("rb_auth_return", returnTo);
      const response = await fetch(`/api/auth/telegram/start?mode=${mode}`, {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || typeof data.href !== "string") {
        throw new Error(data.error ?? "Не удалось открыть Telegram");
      }
      window.location.assign(data.href);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ошибка Telegram");
      setBusy(false);
    }
  };

  return (
    <div className="w-full">
      <button
        type="button"
        onClick={() => void begin()}
        disabled={busy}
        className={className ?? "flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#229ED9] px-4 text-sm font-black text-white transition hover:bg-[#168fca] disabled:cursor-wait disabled:opacity-65"}
        aria-label={mode === "login" ? "Войти через Telegram" : "Привязать Telegram"}
      >
        {busy ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
        <span>{busy ? "Открываем Telegram…" : mode === "login" ? "Telegram" : "Привязать Telegram"}</span>
      </button>
      {message && <p className="mt-2 text-xs font-bold text-[#d95770]" role="alert">{message}</p>}
    </div>
  );
}
