"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, CheckCircle2, KeyRound, Loader2, Mail, ShieldCheck } from "lucide-react";
import Navbar from "@/components/navbar";
import { normalizeLoginEmail } from "@/lib/auth-navigation";
import styles from "../auth-shell.module.css";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [deliveryAvailable, setDeliveryAvailable] = useState(true);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    try {
      const response = await fetch("/api/auth/password/request-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizeLoginEmail(email) }),
      });
      const data = await response.json().catch(() => ({}));
      setMessage(data.message ?? "Если такой email есть, ссылка придёт в течение нескольких минут.");
      setDeliveryAvailable(data.deliveryAvailable !== false);
    } catch {
      setMessage("Не удалось связаться с сервером. Попробуйте позже.");
    } finally {
      setLoading(false);
    }
  };

  return <main className={styles.page}>
    <Navbar />
    <div className={styles.shell}>
      <section className={styles.featurePanel}>
        <div className={styles.featureContent}>
          <span className={styles.featureBadge}><ShieldCheck size={16} /> Безопасное восстановление</span>
          <h1 className={styles.featureTitle}>Вернём доступ.<br /><span>Без лишних данных.</span></h1>
          <p className={styles.featureText}>Ссылка одноразовая, действует 30 минут и завершает старые сессии после смены пароля.</p>
          <div className={styles.featureTrust}><KeyRound size={17} /> Мы не сообщаем, зарегистрирован ли введённый адрес.</div>
        </div>
      </section>
      <section className={styles.card}>
        <header className={styles.cardHeader}><span className={styles.kicker}>Доступ к аккаунту</span><h1>Забыли пароль?</h1><p>Введите подтверждённый email аккаунта.</p></header>
        {!message ? <form className={styles.form} onSubmit={submit}>
          <label className={styles.label}>Email<span className={styles.field}><Mail size={18} /><input className={styles.input} type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.ru" /></span></label>
          <button className={styles.submit} type="submit" disabled={loading}>{loading ? <Loader2 size={19} className="animate-spin" /> : <>Получить ссылку <ArrowRight size={18} /></>}</button>
        </form> : <div className={styles.successCard}><span className={styles.successIcon}><CheckCircle2 size={28} /></span><h1>{deliveryAvailable ? "Проверьте почту" : "Почта настраивается"}</h1><p>{deliveryAvailable ? message : "Самостоятельная отправка временно недоступна. Войдите через Telegram или обратитесь в поддержку."}</p></div>}
        <p className={styles.footer}><Link href="/login"><ArrowLeft size={13} /> Вернуться ко входу</Link></p>
      </section>
    </div>
  </main>;
}
