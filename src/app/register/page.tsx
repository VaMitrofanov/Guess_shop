"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Mail, Lock, User, Loader2, ChevronRight, CheckCircle2 } from "lucide-react";
import Navbar from "@/components/navbar";
import Link from "next/link";

export default function RegisterPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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
          <div className="w-20 h-20 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto border border-emerald-500/20">
            <CheckCircle2 className="w-10 h-10 text-emerald-500" />
          </div>
          <h1 className="text-3xl font-black uppercase italic gold-text">Регистрация успешна!</h1>
          <p className="text-zinc-500 font-medium tracking-wide">Перенаправляем на вход...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#05070a]">
      <Navbar />
      <div className="container mx-auto px-4 pt-20 pb-32 flex justify-center">
        <div className="w-full max-w-md space-y-8">
          <div className="text-center space-y-3">
             <span className="text-[#00f2fe] font-black tracking-[0.3em] text-xs uppercase opacity-70">Присоединяйся к нам</span>
             <h1 className="text-4xl md:text-5xl font-black uppercase italic gold-text">СОЗДАТЬ <br/> АККАУНТ</h1>
          </div>

          <div className="glass p-10 rounded-[2.5rem] border border-white/5 shadow-2xl relative overflow-hidden group">
            <div className="absolute -top-24 -right-24 w-48 h-48 bg-[#00f2fe]/5 blur-[80px] rounded-full pointer-events-none group-hover:bg-[#00f2fe]/10 transition-all duration-700" />
            
            <form onSubmit={handleSubmit} className="space-y-6 relative z-10">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] ml-1">Как вас зовут?</label>
                <div className="relative">
                  <User className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-600" />
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full h-14 bg-white/5 border border-white/5 rounded-2xl pl-12 pr-4 outline-none focus:border-[#00f2fe]/50 transition-all font-bold placeholder:text-zinc-700"
                    placeholder="Напр., Вадим"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] ml-1">Ваша почта</label>
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

              <div className="space-y-2">
                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] ml-1">Придумайте пароль</label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-600" />
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full h-14 bg-white/5 border border-white/5 rounded-2xl pl-12 pr-4 outline-none focus:border-[#00f2fe]/50 transition-all font-bold placeholder:text-zinc-700"
                    placeholder="••••••••"
                  />
                </div>
              </div>

              {error && (
                <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500 text-xs font-bold text-center uppercase tracking-tighter animate-in shake-in">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full h-16 gold-gradient rounded-2xl flex items-center justify-center gap-3 font-black text-black hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 shadow-xl shadow-[#00f2fe]/10"
              >
                {loading ? <Loader2 className="w-6 h-6 animate-spin" /> : <>ЗАРЕГИСТРИРОВАТЬСЯ <ChevronRight className="w-5 h-5" /></>}
              </button>
              
              <div className="text-center pt-2">
                <Link href="/admin/login" className="text-[10px] font-black text-zinc-600 hover:text-[#00f2fe] uppercase tracking-widest transition-colors">
                  Уже есть аккаунт? Войти
                </Link>
              </div>
            </form>
          </div>
        </div>
      </div>
    </main>
  );
}
