"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, CheckCircle2, Eye, EyeOff, Gift, History, Loader2, Lock, Mail, ShieldCheck, Sparkles, User, Zap } from "lucide-react";
import Navbar from "@/components/navbar";
import Link from "next/link";
import { normalizeLoginEmail, safeReturnPath } from "@/lib/auth-navigation";
import { PASSWORD_MIN_LENGTH } from "@/lib/password-policy";
import { Checkbox } from "@/components/ui/checkbox";
import styles from "../auth-shell.module.css";

const benefits = [
  { icon: Zap, title: "Быстрее оформить", text: "Сохраняем профиль и подставляем данные в новый заказ." },
  { icon: History, title: "Видеть историю", text: "Статусы старых и новых заказов собраны в одном месте." },
  { icon: Gift, title: "Не терять бонусы", text: "Баланс привязан к подтверждённому профилю клиента." },
];

function RegisterContent() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [agreedToPrivacy, setAgreedToPrivacy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [verificationAvailable, setVerificationAvailable] = useState(true);
  const [verificationSent, setVerificationSent] = useState(true);
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = safeReturnPath(searchParams.get("next"));
  const strength = password.length >= 14 ? 3 : password.length >= 10 ? 2 : password.length > 0 ? 1 : 0;
  const strengthLabel = ["", "Слабый", "Хороший", "Надёжный"][strength];

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password.length < PASSWORD_MIN_LENGTH) {
      setError(`Пароль должен быть не короче ${PASSWORD_MIN_LENGTH} символов`);
      return;
    }
    if (!agreedToPrivacy) {
      setError("Подтвердите согласие на обработку персональных данных");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: normalizeLoginEmail(email),
          password,
          name: name.trim(),
          agreedToPrivacy,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        throw new Error(data.error ?? "Не удалось создать аккаунт");
      }
      setVerificationAvailable(data.verificationAvailable !== false);
      setVerificationSent(data.verificationSent !== false);
      setSuccess(true);
      window.setTimeout(() => router.replace(`/login?next=${encodeURIComponent(returnTo)}`), 1600);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Ошибка сети. Попробуйте ещё раз.");
      setLoading(false);
    }
  };

  if (success) {
    return <main className={`${styles.page} grid place-items-center p-5`}><section className={styles.successCard}><span className={styles.successIcon}><CheckCircle2 size={30} /></span><h1>{verificationAvailable && verificationSent ? "Проверьте почту" : "Аккаунт создан"}</h1><p>{verificationAvailable && verificationSent ? "Запрос на отправку принят. Проверьте входящие и спам: окончательная доставка зависит от вашего почтового сервиса. Войти можно уже сейчас." : verificationAvailable ? "Аккаунт создан, но письмо сейчас не отправилось. Войдите в личный кабинет и попробуйте отправить письмо ещё раз." : "Почтовая отправка ещё настраивается. Пока используйте вход через Telegram или сохраните пароль."}</p></section></main>;
  }

  return (
    <main className={styles.page}>
      <Navbar />
      <div className={styles.shell}>
        <section className={styles.featurePanel} aria-label="Преимущества аккаунта">
          <div className={styles.featureContent}>
            <span className={styles.featureBadge}><Sparkles size={16} /> Профиль RobloxBank</span>
            <h1 className={styles.featureTitle}>Создай доступ<br /><span>к своему сейфу.</span></h1>
            <p className={styles.featureText}>Один аккаунт для истории заказов, бонусов и быстрых повторных покупок.</p>
            <div className={styles.featureList}>{benefits.map(({ icon: Icon, title, text }) => <article key={title} className={styles.featureItem}><span className={styles.featureIcon}><Icon size={20} /></span><span><strong>{title}</strong><small>{text}</small></span></article>)}</div>
            <div className={styles.featureTrust}><ShieldCheck size={17} /> Пароль хранится только в виде защищённого хеша.</div>
          </div>
        </section>

        <section className={styles.card} aria-labelledby="register-title">
          <header className={styles.cardHeader}><span className={styles.kicker}>Новый аккаунт</span><h1 id="register-title">Начнём знакомство</h1><p>Понадобятся имя, email и надёжный пароль.</p></header>
          <form onSubmit={handleSubmit} className={styles.form}>
            <label className={styles.label}>Имя
              <span className={styles.field}><User size={18} /><input className={styles.input} type="text" autoComplete="name" required value={name} onChange={(event) => setName(event.target.value)} placeholder="Как к вам обращаться?" /></span>
            </label>
            <label className={styles.label}>Email
              <span className={styles.field}><Mail size={18} /><input className={styles.input} type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.ru" /></span>
              <span className={styles.formNotice}>Письмо подтверждения может попасть в спам или быть задержано почтовым сервисом. Войти можно сразу; если письмо не придёт, используйте Telegram или другой email.</span>
            </label>
            <div className={styles.label}>
              <label htmlFor="register-password">Пароль</label>
              <span className={styles.field}><Lock size={18} /><input id="register-password" className={styles.input} type={showPassword ? "text" : "password"} autoComplete="new-password" required minLength={PASSWORD_MIN_LENGTH} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={`Минимум ${PASSWORD_MIN_LENGTH} символов`} /><button type="button" className={styles.iconButton} onClick={() => setShowPassword((value) => !value)} aria-pressed={showPassword} aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></span>
              {password && <span className={styles.strength}><span className={styles.strengthTrack}>{[1,2,3].map((level) => <i key={level} className={strength >= level ? strength === 1 ? styles.activeWeak : strength === 2 ? styles.activeMedium : styles.activeStrong : ""} />)}</span><span>{strengthLabel}</span></span>}
            </div>
            <label className={styles.agreement}>
              <Checkbox
                checked={agreedToPrivacy}
                onChange={(event) => setAgreedToPrivacy(event.target.checked)}
                required
              />
              <span>
                Я даю согласие на обработку персональных данных и принимаю{" "}
                <Link href="/legal/policy" target="_blank">политику конфиденциальности</Link>.
              </span>
            </label>
            {error && <p className={styles.error} role="alert">{error}</p>}
            <button type="submit" className={styles.submit} disabled={loading || !agreedToPrivacy}>{loading ? <Loader2 size={20} className="animate-spin" /> : <><span>Создать аккаунт</span><ArrowRight size={18} /></>}</button>
          </form>
          <p className={styles.footer}>Уже есть аккаунт? <Link href={`/login?next=${encodeURIComponent(returnTo)}`}>Войти</Link></p>
        </section>
      </div>
    </main>
  );
}

export default function RegisterPage() {
  return <Suspense fallback={null}><RegisterContent /></Suspense>;
}
