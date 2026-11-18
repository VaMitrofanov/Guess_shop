"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { signIn } from "next-auth/react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { postLoginPath } from "@/lib/auth-navigation";
import css from "./telegram-login-resume.module.css";

/**
 * 🔐 Вход «вернитесь в браузер» (18.11.2026; баг «выбивает после регистрации»).
 * Кнопка «Telegram» кладёт в localStorage ожидающий вход (`rb_tg_pending`).
 * Пока он жив (5 мин), любая вкладка сайта показывает плашку и опрашивает
 * статус; человек нажал в боте «✅ Да, войти» — вкладка входит сама и ведёт
 * туда, откуда начинали. Возврат «Назад» из Telegram (bfcache) тоже ловим.
 */
export const TG_PENDING_KEY = "rb_tg_pending";
type Pending = { state: string; href: string; returnTo: string | null; exp: number };

export function rememberTelegramPending(href: string, returnTo: string | null): void {
  const state = /web_login_([A-Za-z0-9_-]{32})/.exec(decodeURIComponent(href))?.[1];
  if (!state) return;
  try {
    localStorage.setItem(TG_PENDING_KEY, JSON.stringify({ state, href, returnTo, exp: Date.now() + 5 * 60_000 } satisfies Pending));
  } catch { /* приватный режим — останется запасной путь через кнопку в боте */ }
}

function readPending(): Pending | null {
  try {
    const raw = localStorage.getItem(TG_PENDING_KEY);
    const p = raw ? (JSON.parse(raw) as Pending) : null;
    if (!p || typeof p.state !== "string" || p.exp < Date.now()) { if (raw) localStorage.removeItem(TG_PENDING_KEY); return null; }
    return p;
  } catch { return null; }
}
const clearPending = () => { try { localStorage.removeItem(TG_PENDING_KEY); } catch { /* ignore */ } };

export default function TelegramLoginResume() {
  const [pending, setPending] = useState<Pending | null>(null);
  const [done, setDone] = useState(false);
  const busy = useRef(false);

  const check = useCallback(async () => {
    const p = readPending();
    setPending(p);
    if (!p || busy.current || document.visibilityState !== "visible") return;
    busy.current = true;
    try {
      const res = await fetch(`/api/auth/telegram/poll?state=${encodeURIComponent(p.state)}`, { cache: "no-store" });
      const { status } = await res.json().catch(() => ({ status: "waiting" }));
      if (status === "gone") { clearPending(); setPending(null); return; }
      if (status !== "approved") return;
      const result = await signIn("telegram-handoff", { state: p.state, redirect: false });
      clearPending();
      if (!result?.ok) { setPending(null); return; }
      setDone(true);
      const session = await fetch("/api/auth/session", { cache: "no-store" }).then((r) => r.json()).catch(() => null);
      window.setTimeout(() => window.location.replace(postLoginPath(session?.user?.role, p.returnTo)), 700);
    } finally {
      busy.current = false;
    }
  }, []);

  useEffect(() => {
    const first = window.setTimeout(() => void check(), 0);
    const timer = window.setInterval(() => void check(), 2000);
    const wake = () => void check();
    window.addEventListener("pageshow", wake);
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
      window.removeEventListener("pageshow", wake);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
    };
  }, [check]);

  if (!pending && !done) return null;
  return (
    <div className={css.bar} role="status" aria-live="polite">
      <span className={css.icon} aria-hidden="true">
        {done ? <CheckCircle2 size={20} /> : <Loader2 size={20} className={css.spin} />}
      </span>
      <span className={css.text}>
        <span className={css.title}>{done ? "Вход выполнен" : "Ждём подтверждения в Telegram"}</span>
        <span className={css.sub}>{done ? "Открываем…" : "Нажмите в боте «✅ Да, войти» и вернитесь сюда"}</span>
      </span>
      {!done && pending && (
        <span className={css.actions}>
          <a className={css.btn} href={pending.href}>Открыть</a>
          <button type="button" className={css.btn} onClick={() => { clearPending(); setPending(null); }} aria-label="Отменить вход через Telegram">✕</button>
        </span>
      )}
    </div>
  );
}
