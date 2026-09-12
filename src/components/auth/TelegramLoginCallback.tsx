"use client";

import { useEffect, useRef, useState } from "react";
import { signIn } from "next-auth/react";
import { CheckCircle2, Loader2, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { postLoginPath } from "@/lib/auth-navigation";

type CallbackProps = {
  mode: "login" | "link";
  state: string;
  payload: {
    id: string;
    first_name: string;
    last_name?: string;
    username?: string;
    auth_date: string;
    hash: string;
  };
};

export default function TelegramLoginCallback({ mode, state, payload }: CallbackProps) {
  const started = useRef(false);
  const [status, setStatus] = useState<"busy" | "success" | "error">("busy");
  const [message, setMessage] = useState("Проверяем подтверждение Telegram…");

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const complete = async () => {
      try {
        if (mode === "link") {
          const response = await fetch("/api/account/identities/link", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ provider: "TG", state, payload }),
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(data.error ?? "Не удалось привязать Telegram");
          setStatus("success");
          setMessage(data.merged ? "Профили объединены. Открываем кабинет…" : "Telegram привязан. Открываем кабинет…");
          window.setTimeout(() => window.location.replace("/dashboard"), 650);
          return;
        }

        const result = await signIn("telegram-login", { ...payload, state, redirect: false });
        if (!result?.ok) throw new Error("Telegram не подтвердил вход");
        // A1: Telegram — основной вход для админов, поэтому пункт назначения
        // выбирается так же, как на `/login`: админа ведём в Control Center.
        // Просто `returnTo` тут не подходит — `safeReturnPath` намеренно
        // отбрасывает `/admin`, чтобы туда нельзя было направить чужим ретёрном.
        const stored = sessionStorage.getItem("rb_auth_return");
        sessionStorage.removeItem("rb_auth_return");
        const session = await fetch("/api/auth/session", { cache: "no-store" })
          .then((response) => response.json())
          .catch(() => null);
        const target = postLoginPath(session?.user?.role, stored);
        setStatus("success");
        setMessage(
          target.startsWith("/admin")
            ? "Вход подтверждён. Открываем админку…"
            : target.startsWith("/checkout")
              ? "Вход подтверждён. Возвращаем заказ…"
              : "Вход подтверждён. Открываем кабинет…",
        );
        window.setTimeout(() => window.location.replace(target), 450);
      } catch (error) {
        setStatus("error");
        setMessage(error instanceof Error ? error.message : "Не удалось завершить вход");
      }
    };

    void complete();
  }, [mode, payload, state]);

  return (
    <div className="w-full max-w-md rounded-[24px] border border-[var(--rb-border)] bg-[var(--rb-surface)] p-8 text-center shadow-[0_24px_80px_rgba(42,27,76,.14)]">
      <span className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-[var(--rb-accent-soft)] text-[var(--rb-accent)]">
        {status === "busy" ? <Loader2 className="animate-spin" /> : status === "success" ? <CheckCircle2 /> : <TriangleAlert />}
      </span>
      <h1 className="font-[var(--font-display)] text-2xl font-bold tracking-[-.04em]">Вход через Telegram</h1>
      <p className="mt-3 text-sm text-[var(--rb-muted)]" role="status">{message}</p>
      {status === "error" && <Link href="/login" className="mt-6 inline-flex rounded-xl bg-[var(--rb-strong)] px-5 py-3 text-sm font-black text-white">Вернуться ко входу</Link>}
    </div>
  );
}
