"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Eye, EyeOff, KeyRound, Loader2, Lock, ShieldCheck } from "lucide-react";
import { useSearchParams } from "next/navigation";
import Navbar from "@/components/navbar";
import styles from "../auth-shell.module.css";

function ResetPasswordContent() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password.length < 10) return setError("Пароль должен быть не короче 10 символов.");
    if (password !== confirm) return setError("Пароли не совпадают.");
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/auth/password/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Не удалось изменить пароль.");
      setSuccess(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось изменить пароль.");
    } finally { setLoading(false); }
  };

  return <main className={styles.page}>
    <Navbar />
    <div className={styles.shell}>
      <section className={styles.featurePanel}><div className={styles.featureContent}><span className={styles.featureBadge}><ShieldCheck size={16} /> Одноразовая ссылка</span><h1 className={styles.featureTitle}>Новый пароль.<br /><span>Новый сеанс.</span></h1><p className={styles.featureText}>После сохранения остальные сессии аккаунта перестанут проходить проверку.</p><div className={styles.featureTrust}><KeyRound size={17} /> Ссылка используется только один раз.</div></div></section>
      <section className={styles.card}>
        {success ? <div className={styles.successCard}><span className={styles.successIcon}><CheckCircle2 size={28} /></span><h1>Пароль изменён</h1><p>Теперь войдите с новым паролем.</p><p className={styles.footer}><Link href="/login">Перейти ко входу <ArrowRight size={14} /></Link></p></div> : <><header className={styles.cardHeader}><span className={styles.kicker}>Восстановление</span><h1>Задайте новый пароль</h1><p>Минимум 10 символов. Не используйте пароль от Roblox.</p></header><form className={styles.form} onSubmit={submit}>
          <label className={styles.label}>Новый пароль<span className={styles.field}><Lock size={18} /><input className={styles.input} type={show ? "text" : "password"} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={10} /><button type="button" className={styles.iconButton} onClick={() => setShow((value) => !value)} aria-label={show ? "Скрыть пароль" : "Показать пароль"}>{show ? <EyeOff size={18} /> : <Eye size={18} />}</button></span></label>
          <label className={styles.label}>Повторите пароль<span className={styles.field}><Lock size={18} /><input className={styles.input} type={show ? "text" : "password"} autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} required minLength={10} /></span></label>
          {error && <p className={styles.error} role="alert">{error}</p>}
          <button className={styles.submit} type="submit" disabled={loading || !token}>{loading ? <Loader2 size={19} className="animate-spin" /> : <>Сохранить пароль <ArrowRight size={18} /></>}</button>
        </form></>}
      </section>
    </div>
  </main>;
}

export default function ResetPasswordPage() { return <Suspense fallback={null}><ResetPasswordContent /></Suspense>; }
