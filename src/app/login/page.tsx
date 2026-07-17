"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { ArrowRight, Eye, EyeOff, History, Loader2, Lock, Mail, ShieldCheck, Sparkles, UserRoundCheck } from "lucide-react";
import Navbar from "@/components/navbar";
import Link from "next/link";
import VKAuthButton from "@/components/auth/VKAuthButton";
import TelegramLoginButton from "@/components/auth/TelegramLoginButton";
import { normalizeLoginEmail, postLoginPath } from "@/lib/auth-navigation";
import { VK_AUTH_ENABLED } from "@/lib/vk-auth-availability";
import styles from "../auth-shell.module.css";

const benefits = [
  { icon: History, title: "Все заказы рядом", text: "Сайт, Wildberries, Telegram и VK — в одной истории." },
  { icon: Sparkles, title: "Следующий шаг сверху", text: "ЛК сразу покажет, что нужно сделать с активным заказом." },
  { icon: UserRoundCheck, title: "Один профиль", text: "Бонусы и подтверждённые способы входа не теряются." },
];

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const result = await signIn("admin-login", {
        email: normalizeLoginEmail(email),
        password,
        redirect: false,
      });
      if (!result?.ok) throw new Error("Неверный email или пароль");
      const response = await fetch("/api/auth/session", { cache: "no-store" });
      const session = await response.json();
      router.replace(postLoginPath(session?.user?.role));
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось войти. Попробуйте ещё раз.");
      setLoading(false);
    }
  };

  return (
    <main className={styles.page}>
      <Navbar />
      <div className={styles.shell}>
        <section className={styles.featurePanel} aria-label="Возможности личного кабинета">
          <div className={styles.featureContent}>
            <span className={styles.featureBadge}><ShieldCheck size={16} /> Личный сейф</span>
            <h1 className={styles.featureTitle}>Все покупки.<br /><span>Один кабинет.</span></h1>
            <p className={styles.featureText}>Возвращайся к заказам, оплате и бонусам без повторного ввода данных.</p>
            <div className={styles.featureList}>
              {benefits.map(({ icon: Icon, title, text }) => <article key={title} className={styles.featureItem}><span className={styles.featureIcon}><Icon size={20} /></span><span><strong>{title}</strong><small>{text}</small></span></article>)}
            </div>
            <div className={styles.featureTrust}><ShieldCheck size={17} /> Мы не запрашиваем пароль от Roblox.</div>
          </div>
        </section>

        <section className={styles.card} aria-labelledby="login-title">
          <header className={styles.cardHeader}>
            <span className={styles.kicker}>Личный кабинет</span>
            <h1 id="login-title">С возвращением</h1>
            <p>Войди по email или через подтверждённый профиль.</p>
          </header>

          <form onSubmit={handleSubmit} className={styles.form}>
            <label className={styles.label}>Email
              <span className={styles.field}><Mail size={18} /><input className={styles.input} type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.ru" /></span>
            </label>
            <label className={styles.label}>Пароль
              <span className={styles.field}><Lock size={18} /><input className={styles.input} type={showPassword ? "text" : "password"} autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Введите пароль" /><button type="button" className={styles.iconButton} onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></span>
            </label>
            {error && <p className={styles.error} role="alert">{error}</p>}
            <button type="submit" className={styles.submit} disabled={loading}>{loading ? <Loader2 size={20} className="animate-spin" /> : <><span>Войти в кабинет</span><ArrowRight size={18} /></>}</button>
          </form>

          <div className={styles.divider}>или продолжить через</div>
          <div className={styles.providers}>
            <TelegramLoginButton mode="login" className={styles.providerButton} />
            {VK_AUTH_ENABLED && <div className={styles.vkProvider}><VKAuthButton mode="login" /></div>}
          </div>
          <p className={styles.footer}>Нет аккаунта? <Link href="/register">Создать</Link><br /><Link href="/admin/login" className={styles.secondaryLink}>Вход для администратора</Link></p>
        </section>
      </div>
    </main>
  );
}
