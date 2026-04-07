"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Mail, Lock, User, Loader2, CheckCircle2,
  Eye, EyeOff, ShieldCheck, Zap, Gift, ArrowRight, ChevronRight
} from "lucide-react";
import Navbar from "@/components/navbar";
import Link from "next/link";

export default function RegisterPage() {
  const [email, setEmail]           = useState("");
  const [password, setPassword]     = useState("");
  const [name, setName]             = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState("");
  const [success, setSuccess]       = useState(false);
  const router = useRouter();

  const strength =
    password.length >= 12 ? 3 : password.length >= 8 ? 2 : password.length >= 4 ? 1 : 0;
  const strengthLabel = ["", "Слабый", "Средний", "Надёжный"][strength];
  const strengthColor = ["", "text-red-400", "text-amber-400", "text-[#00b06f]"][strength];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) { setError("Пароль должен быть не менее 8 символов"); return; }
    setLoading(true); setError("");
    try {
      const res  = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name }),
      });
      const data = await res.json();
      if (data.success) {
        setSuccess(true);
        setTimeout(() => router.push("/login"), 2200);
      } else {
        setError(data.error === "Email already in use"
          ? "Этот email уже зарегистрирован"
          : data.error || "Ошибка регистрации");
      }
    } catch {
      setError("Ошибка сети. Попробуйте ещё раз.");
    } finally {
      setLoading(false);
    }
  };

  /* ── SUCCESS ── */
  if (success) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="pixel-card border-2 border-[#00b06f]/40 p-10 text-center space-y-6 max-w-sm w-full">
          <div className="w-16 h-16 mx-auto border-2 border-[#00b06f]/40 bg-[#00b06f]/10 flex items-center justify-center">
            <CheckCircle2 className="w-8 h-8 text-[#00b06f]" />
          </div>
          <div>
            <div className="font-pixel text-[10px] text-[#00b06f] tracking-wider mb-2">SUCCESS</div>
            <h1 className="text-2xl font-black uppercase tracking-tight gold-text">Аккаунт создан!</h1>
          </div>
          <p className="text-sm text-zinc-400 font-medium">Перенаправляем на страницу входа…</p>
          <div className="h-1 w-full bg-[#1e2a45] overflow-hidden">
            <div className="h-full bg-[#00b06f] animate-[progress_2.2s_linear_forwards]" style={{ width: "0%" }} />
          </div>
        </div>
      </main>
    );
  }

  /* ── MAIN ── */
  return (
    <main className="min-h-screen">
      <Navbar />

      <div className="container mx-auto px-6 py-16 max-w-6xl">

        {/* Header */}
        <div className="mb-12">
          <div className="font-pixel text-[10px] text-[#00b06f]/60 tracking-wider mb-3">ACCOUNT</div>
          <h1 className="text-5xl md:text-6xl font-black uppercase tracking-[-0.03em] leading-none">
            Создать<br />
            <span className="gold-text">аккаунт</span>
          </h1>
        </div>

        <div className="accent-line mb-12" />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

          {/* ── Benefits ── */}
          <div className="space-y-4">
            <div className="font-pixel text-[10px] text-[#00b06f]/60 tracking-wider mb-4">ЗАЧЕМ АККАУНТ?</div>

            {[
              { icon: Zap,         color: "text-[#00b06f]", border: "border-[#00b06f]/20", bg: "bg-[#00b06f]/5",
                tag: "SPEED", title: "Быстрый заказ",
                desc: "Данные сохранены — не нужно вводить ник при каждой покупке" },
              { icon: ShieldCheck, color: "text-amber-400", border: "border-amber-500/20", bg: "bg-amber-500/5",
                tag: "HISTORY", title: "История заказов",
                desc: "Отслеживай статус каждой покупки в личном кабинете" },
              { icon: Gift,        color: "text-blue-400", border: "border-blue-500/20", bg: "bg-blue-500/5",
                tag: "BONUSES", title: "Бонусы",
                desc: "Скидки и акции только для зарегистрированных пользователей" },
            ].map(({ icon: Icon, color, border, bg, tag, title, desc }) => (
              <div key={tag} className={`pixel-card border-2 ${border} ${bg} p-5 flex gap-4`}>
                <div className={`w-10 h-10 border-2 ${border} flex items-center justify-center flex-shrink-0`}>
                  <Icon className={`w-5 h-5 ${color}`} />
                </div>
                <div>
                  <div className={`font-pixel text-[9px] ${color} tracking-wider mb-1`}>{tag}</div>
                  <p className="font-black uppercase text-sm mb-1">{title}</p>
                  <p className="text-sm text-zinc-400 font-medium leading-relaxed">{desc}</p>
                </div>
              </div>
            ))}

            <div className="pt-2 text-sm text-zinc-500 font-medium">
              Уже есть аккаунт?{" "}
              <Link href="/login" className="text-[#00b06f] font-black hover:underline">
                Войти →
              </Link>
            </div>
          </div>

          {/* ── Form ── */}
          <div className="lg:col-span-2">
            <div className="pixel-card border-2 border-[#1e2a45] p-8">

              <form onSubmit={handleSubmit} className="space-y-6">

                {/* Name */}
                <div className="space-y-2">
                  <label className="font-pixel text-[9px] text-zinc-500 tracking-wider">ИМЯ</label>
                  <div className="relative">
                    <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-600" />
                    <input
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Как вас зовут?"
                      className="w-full h-14 bg-[#080c18] border-2 border-[#1e2a45] pl-11 pr-4 outline-none focus:border-[#00b06f]/40 transition-colors font-bold text-base placeholder:text-zinc-700"
                    />
                  </div>
                </div>

                {/* Email */}
                <div className="space-y-2">
                  <label className="font-pixel text-[9px] text-zinc-500 tracking-wider">EMAIL</label>
                  <div className="relative">
                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-600" />
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="example@mail.ru"
                      className="w-full h-14 bg-[#080c18] border-2 border-[#1e2a45] pl-11 pr-4 outline-none focus:border-[#00b06f]/40 transition-colors font-bold text-base placeholder:text-zinc-700"
                    />
                  </div>
                </div>

                {/* Password */}
                <div className="space-y-2">
                  <label className="font-pixel text-[9px] text-zinc-500 tracking-wider">ПАРОЛЬ</label>
                  <div className="relative">
                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-600" />
                    <input
                      type={showPassword ? "text" : "password"}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Минимум 8 символов"
                      className="w-full h-14 bg-[#080c18] border-2 border-[#1e2a45] pl-11 pr-12 outline-none focus:border-[#00b06f]/40 transition-colors font-bold text-base placeholder:text-zinc-700"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-400 transition-colors"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>

                  {/* Strength bar */}
                  {password.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="flex gap-1">
                        {[1,2,3].map((l) => (
                          <div key={l} className={`h-1 flex-1 transition-all ${
                            strength >= l
                              ? l===1 ? "bg-red-500" : l===2 ? "bg-amber-500" : "bg-[#00b06f]"
                              : "bg-[#1e2a45]"
                          }`} />
                        ))}
                      </div>
                      <span className={`text-xs font-black ${strengthColor}`}>{strengthLabel}</span>
                    </div>
                  )}
                </div>

                {error && (
                  <div className="pixel-card border-2 border-red-500/30 bg-red-500/5 p-4 text-sm text-red-400 font-bold">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full h-14 gold-gradient font-black text-[11px] uppercase tracking-widest text-white hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-3"
                >
                  {loading
                    ? <Loader2 className="w-5 h-5 animate-spin" />
                    : <><span>Создать аккаунт</span><ArrowRight className="w-4 h-4" /></>
                  }
                </button>

              </form>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
