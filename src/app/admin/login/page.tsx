"use client";

import { useState } from "react";
import { signIn, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { ArrowRight, Eye, EyeOff, KeyRound, Loader2, Lock, Mail, ShieldCheck, UserRoundCheck } from "lucide-react";
import Navbar from "@/components/navbar";
import Link from "next/link";
import { normalizeLoginEmail } from "@/lib/auth-navigation";
import styles from "../../auth-shell.module.css";

export default function AdminLoginPage() {
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
      if (session?.user?.role !== "ADMIN") {
        await signOut({ redirect: false });
        throw new Error("У этой учётной записи нет прав администратора");
      }
      router.replace("/admin");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось войти");
      setLoading(false);
    }
  };

  return (
    <main className={styles.page}>
      <Navbar />
      <div className={styles.shell}>
        <section className={`${styles.featurePanel} ${styles.adminPanel}`} aria-label="Защищённая зона">
          <div className={styles.featureContent}>
            <span className={styles.featureBadge}><ShieldCheck size={16} /> Закрытая зона</span>
            <h1 className={styles.featureTitle}>Управление<br /><span>RobloxBank.</span></h1>
            <p className={styles.featureText}>Доступ только для подтверждённых администраторов сервиса.</p>
            <div className={styles.featureList}>
              <article className={styles.featureItem}><span className={styles.featureIcon}><KeyRound size={20} /></span><span><strong>Отдельная проверка роли</strong><small>Обычный пользователь не попадёт в административный контур.</small></span></article>
              <article className={styles.featureItem}><span className={styles.featureIcon}><UserRoundCheck size={20} /></span><span><strong>Защищённая сессия</strong><small>После входа сервер повторно проверяет права на каждом экране.</small></span></article>
            </div>
            <div className={styles.featureTrust}><Lock size={17} /> Попытки входа журналируются инфраструктурой.</div>
          </div>
        </section>

        <section className={styles.card} aria-labelledby="admin-login-title">
          <header className={styles.cardHeader}><span className={styles.kicker}>Администрирование</span><h1 id="admin-login-title">Подтвердите доступ</h1><p>Используйте административную учётную запись.</p></header>
          <form onSubmit={handleSubmit} className={styles.form}>
            <label className={styles.label}>Email
              <span className={styles.field}><Mail size={18} /><input className={styles.input} type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="admin@example.ru" /></span>
            </label>
            <label className={styles.label}>Пароль
              <span className={styles.field}><Lock size={18} /><input className={styles.input} type={showPassword ? "text" : "password"} autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Введите пароль" /><button type="button" className={styles.iconButton} onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></span>
            </label>
            {error && <p className={styles.error} role="alert">{error}</p>}
            <button type="submit" className={styles.submit} disabled={loading}>{loading ? <Loader2 size={20} className="animate-spin" /> : <><span>Войти в админ-панель</span><ArrowRight size={18} /></>}</button>
          </form>
          <p className={styles.footer}><Link href="/login">Вернуться в личный кабинет</Link></p>
        </section>
      </div>
    </main>
  );
}
