"use client";

import { useState } from "react";
import { Loader2, MailCheck } from "lucide-react";

export default function EmailVerificationAction() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Подтверди email, чтобы восстановить доступ при потере пароля.");
  const [error, setError] = useState(false);

  const resend = async () => {
    setBusy(true); setError(false);
    try {
      const response = await fetch("/api/auth/email/resend", { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Не удалось отправить письмо.");
      setMessage("Письмо отправлено. Проверь входящие и спам.");
    } catch (caught) {
      setError(true);
      setMessage(caught instanceof Error ? caught.message : "Не удалось отправить письмо.");
    } finally { setBusy(false); }
  };

  return <div className="mt-3 rounded-xl border border-[var(--rb-border)] bg-[var(--rb-surface-2)] p-3">
    <p className={`!m-0 text-xs leading-relaxed ${error ? "text-[#d95770]" : "text-[var(--rb-muted)]"}`} role="status">{message}</p>
    <button type="button" onClick={() => void resend()} disabled={busy} className="mt-2 flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-[var(--rb-accent)] px-3 text-xs font-black text-white disabled:opacity-60">{busy ? <Loader2 size={16} className="animate-spin" /> : <MailCheck size={16} />} Отправить письмо ещё раз</button>
  </div>;
}
