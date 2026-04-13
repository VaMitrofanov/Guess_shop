"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Mail, Lock, Loader2, ArrowRight, Eye, EyeOff, User } from "lucide-react";
import Navbar from "@/components/navbar";
import Link from "next/link";
import VKAuthButton from "@/components/auth/VKAuthButton";

export default function LoginPage() {
  const [email, setEmail]           = useState("");
  const [password, setPassword]     = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState("");
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    if (result?.error) {
      setError("Неверный email или пароль");
      setLoading(false);
    } else {
      // Fetch session to know the role
      const res     = await fetch("/api/auth/session");
      const session = await res.json();
      const role    = session?.user?.role;
      router.push(role === "ADMIN" ? "/admin" : "/dashboard");
    }
  };

  return (
    <main className="min-h-screen">
      <Navbar />

      <div className="container mx-auto px-6 py-16 max-w-6xl">

        {/* Header */}
        <div className="mb-12">
          <div className="font-pixel text-[10px] text-[#00b06f]/60 tracking-wider mb-3">ACCOUNT</div>
          <h1 className="text-5xl md:text-6xl font-black uppercase tracking-[-0.03em] leading-none">
            Личный<br />
            <span className="gold-text">кабинет</span>
          </h1>
        </div>

        <div className="accent-line mb-12" />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

          {/* ── Left info ── */}
          <div className="space-y-6">
            <div className="font-pixel text-[10px] text-[#00b06f]/60 tracking-wider mb-4">ВОЙТИ В АККАУНТ</div>

            <div className="pixel-card border-2 border-[#1e2a45] p-5 space-y-3">
              <div className="flex gap-3 items-center">
                <div className="w-8 h-8 border border-[#00b06f]/20 bg-[#00b06f]/5 flex items-center justify-center flex-shrink-0">
                  <User className="w-4 h-4 text-[#00b06f]" />
                </div>
                <div>
                  <p className="font-black text-sm uppercase">История заказов</p>
                  <p className="text-sm text-zinc-400">Все ваши покупки в одном месте</p>
                </div>
              </div>
            </div>

            <div className="space-y-2 text-sm text-zinc-500 font-medium">
              <p>Нет аккаунта?{" "}
                <Link href="/register" className="text-[#00b06f] font-black hover:underline">
                  Зарегистрироваться →
                </Link>
              </p>
              <p>Администратор?{" "}
                <Link href="/admin/login" className="text-zinc-400 font-black hover:text-white hover:underline">
                  Войти как Admin →
                </Link>
              </p>
            </div>
          </div>

          {/* ── Form ── */}
          <div className="lg:col-span-2">
            <div className="pixel-card border-2 border-[#1e2a45] p-8">

              <form onSubmit={handleSubmit} className="space-y-6">

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
                      placeholder="••••••••"
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
                    : <><span>Войти в кабинет</span><ArrowRight className="w-4 h-4" /></>
                  }
                </button>

                {/* VK ID Login Option */}
                <div className="pt-6 border-t border-[#1e2a45]/50">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="h-px flex-1 bg-[#1e2a45]" />
                    <span className="font-pixel text-[8px] text-zinc-500 uppercase tracking-widest">ИЛИ ВОЙТИ ЧЕРЕЗ</span>
                    <div className="h-px flex-1 bg-[#1e2a45]" />
                  </div>
                  
                  <div className="bg-[#0077FF]/5 border border-[#0077FF]/20 p-4 transition-all hover:bg-[#0077FF]/10">
                    <VKAuthButton mode="login" />
                  </div>
                </div>

              </form>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
