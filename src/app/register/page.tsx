"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Mail, Lock, User, Loader2, ChevronRight, CheckCircle2, Eye, EyeOff, ShieldCheck, Zap, Gift } from "lucide-react";
import Navbar from "@/components/navbar";
import Link from "next/link";

export default function RegisterPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const router = useRouter();

  const passwordStrength = password.length >= 12 ? 3 : password.length >= 8 ? 2 : password.length >= 4 ? 1 : 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      setError("Пароль должен быть не менее 8 символов");
      return;
    }
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name }),
      });

      const data = await res.json();

      if (data.success) {
        setSuccess(true);
        setTimeout(() => {
          router.push("/admin/login");
        }, 2000);
      } else {
        setError(data.error || "Ошибка регистрации");
      }
    } catch (err) {
      setError("Ошибка сети. Попробуйте еще раз.");
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <main className="min-h-screen bg-[#05070a] flex items-center justify-center p-4">
        <div className="text-center space-y-6 animate-in fade-in zoom-in duration-500">
          <div className="w-24 h-24 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto border border-emerald-500/20 shadow-2xl shadow-emerald-500/10">
            <CheckCircle2 className="w-12 h-12 text-emerald-500" />
          </div>
          <h1 className="text-4xl font-black uppercase gold-text">Добро пожаловать!</h1>
          <p className="text-zinc-500 font-bold text-sm">Аккаунт создан. Перенаправляем на вход...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#05070a]">
      <Navbar />
      <div className="container mx-auto px-4 pt-16 sm:pt-20 pb-20 flex flex-col lg:flex-row gap-12 items-center justify-center">
        
        {/* Left: Benefits */}
        <div className="w-full max-w-sm space-y-8 hidden lg:block">
          <div className="space-y-3">
            <h2 className="text-3xl font-black uppercase tracking-tight">Зачем аккаунт?</h2>
            <div className="h-1 w-12 bg-[#00f2fe] rounded-full" />
          </div>
          
          <div className="space-y-6">
            <div className="flex gap-4 items-start group">
              <div className="w-12 h-12 rounded-2xl bg-[#00f2fe]/10 border border-[#00f2fe]/20 flex items-center justify-center shrink-0 group-hover:bg-[#00f2fe]/20 transition-all">
                <Zap className="w-5 h-5 text-[#00f2fe]" />
              </div>
              <div>
                <h3 className="font-black text-sm uppercase mb-1">Быстрый заказ</h3>
                <p className="text-xs text-zinc-500 leading-relaxed">Данные сохраняются — не нужно вводить ник каждый раз</p>
              </div>
            </div>
            <div className="flex gap-4 items-start group">
              <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0 group-hover:bg-emerald-500/20 transition-all">
                <ShieldCheck className="w-5 h-5 text-emerald-500" />
              </div>
              <div>
                <h3 className="font-black text-sm uppercase mb-1">История заказов</h3>
                <p className="text-xs text-zinc-500 leading-relaxed">Отслеживайте статус каждой покупки в личном кабинете</p>
              </div>
            </div>
            <div className="flex gap-4 items-start group">
              <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0 group-hover:bg-amber-500/20 transition-all">
                <Gift className="w-5 h-5 text-amber-500" />
              </div>
              <div>
                <h3 className="font-black text-sm uppercase mb-1">Бонусы</h3>
                <p className="text-xs text-zinc-500 leading-relaxed">Скидки и акции для зарегистрированных пользователей</p>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Form */}
        <div className="w-full max-w-md space-y-6">
          <div className="text-center space-y-2">
             <span className="text-[#00f2fe] font-black tracking-[0.3em] text-[10px] uppercase opacity-60">Присоединяйся</span>
             <h1 className="text-4xl sm:text-5xl font-black uppercase gold-text leading-none">Создать <br/> аккаунт</h1>
          </div>

          <div className="glass p-6 sm:p-10 rounded-[2rem] sm:rounded-[2.5rem] border border-white/5 shadow-2xl relative overflow-hidden group">
            <div className="absolute -top-24 -right-24 w-48 h-48 bg-[#00f2fe]/5 blur-[80px] rounded-full pointer-events-none group-hover:bg-[#00f2fe]/10 transition-all duration-700" />
            
            <form onSubmit={handleSubmit} className="space-y-5 relative z-10">
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] ml-1">Имя</label>
                <div className="relative">
                  <User className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-600" />
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full h-14 bg-white/5 border border-white/5 rounded-2xl pl-12 pr-4 outline-none focus:border-[#00f2fe]/50 transition-all font-bold placeholder:text-zinc-700"
                    placeholder="Как вас зовут?"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] ml-1">Email</label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-600" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full h-14 bg-white/5 border border-white/5 rounded-2xl pl-12 pr-4 outline-none focus:border-[#00f2fe]/50 transition-all font-bold placeholder:text-zinc-700"
                    placeholder="example@mail.ru"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] ml-1">Пароль</label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-600" />
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full h-14 bg-white/5 border border-white/5 rounded-2xl pl-12 pr-12 outline-none focus:border-[#00f2fe]/50 transition-all font-bold placeholder:text-zinc-700"
                    placeholder="Минимум 8 символов"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-400 transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
                {/* Password strength indicator */}
                {password.length > 0 && (
                  <div className="flex gap-1.5 mt-2 px-1">
                    {[1, 2, 3].map((level) => (
                      <div
                        key={level}
                        className={`h-1 flex-1 rounded-full transition-all ${
                          passwordStrength >= level
                            ? level === 1 ? "bg-red-500" : level === 2 ? "bg-amber-500" : "bg-emerald-500"
                            : "bg-white/5"
                        }`}
                      />
                    ))}
                  </div>
                )}
              </div>

              {error && (
                <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500 text-xs font-bold text-center">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full h-16 gold-gradient rounded-2xl flex items-center justify-center gap-3 font-black text-black hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 shadow-xl shadow-[#00f2fe]/10"
              >
                {loading ? <Loader2 className="w-6 h-6 animate-spin" /> : <>СОЗДАТЬ АККАУНТ <ChevronRight className="w-5 h-5" /></>}
              </button>
              
              <div className="text-center pt-1">
                <Link href="/admin/login" className="text-[10px] font-black text-zinc-600 hover:text-[#00f2fe] uppercase tracking-widest transition-colors">
                  Уже есть аккаунт? Войти →
                </Link>
              </div>
            </form>
          </div>
        </div>
      </div>
    </main>
  );
}
