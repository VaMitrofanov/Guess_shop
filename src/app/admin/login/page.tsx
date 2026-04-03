"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Lock, Mail, Loader2 } from "lucide-react";
import Navbar from "@/components/navbar";

export default function AdminLoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
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
      setError("Invalid credentials. Access denied.");
      setLoading(false);
    } else {
      router.push("/admin");
    }
  };

  return (
    <main className="min-h-screen bg-[#05070a]">
      <Navbar />
      <div className="container mx-auto px-4 pt-32 flex justify-center">
        <div className="w-full max-w-md glass p-10 rounded-[2.5rem] border border-white/5 shadow-2xl">
          <div className="text-center mb-10 space-y-2">
            <h1 className="text-3xl font-black uppercase italic gold-text">Admin Access</h1>
            <p className="text-zinc-500 text-sm font-medium uppercase tracking-widest opacity-50">Enterprise Security Protocol Active</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest ml-1">Email Address</label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-600" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full h-14 bg-white/5 border border-white/5 rounded-xl pl-12 pr-4 outline-none focus:border-[#00f2fe]/40 transition-all font-bold"
                  placeholder="admin@vadi.robux"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest ml-1">Master Password</label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-600" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full h-14 bg-white/5 border border-white/5 rounded-xl pl-12 pr-4 outline-none focus:border-[#00f2fe]/40 transition-all font-bold"
                  placeholder="••••••••"
                />
              </div>
            </div>

            {error && (
              <p className="text-red-500 text-xs font-bold text-center bg-red-500/10 py-3 rounded-lg border border-red-500/20 uppercase tracking-tighter">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full h-14 gold-gradient rounded-xl flex items-center justify-center font-bold text-black hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-6 h-6 animate-spin" /> : "AUTHENTICATE"}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
