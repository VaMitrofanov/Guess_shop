"use client";

import { useEffect, useRef, useState } from "react";
import { signIn } from "next-auth/react";
import { CheckCircle2, Loader2, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { safeReturnPath } from "@/lib/auth-navigation";

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
        const returnTo = safeReturnPath(sessionStorage.getItem("rb_auth_return"));
        sessionStorage.removeItem("rb_auth_return");
        setStatus("success");
        setMessage(returnTo.startsWith("/checkout") ? "Вход подтверждён. Возвращаем заказ…" : "Вход подтверждён. Открываем кабинет…");
        window.setTimeout(() => window.location.replace(returnTo), 450);
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
