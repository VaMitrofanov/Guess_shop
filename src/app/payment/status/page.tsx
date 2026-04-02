"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import Navbar from "@/components/navbar";
import { CheckCircle2, XCircle, Clock, Loader2, ArrowRight } from "lucide-react";

function StatusContent() {
  const searchParams = useSearchParams();
  const orderId = searchParams.get("orderId");
  const [status, setStatus] = useState<string>("PENDING");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orderId) return;

    const poll = async () => {
      try {
        const res = await fetch(`/api/orders/${orderId}`);
        const data = await res.json();
        
        if (data.status) {
          setStatus(data.status);
          if (["PAID", "FULFILLED", "FAILED"].includes(data.status)) {
            setLoading(false);
            return;
          }
        }
      } catch (err) {
        console.error("Polling error:", err);
      }
    };

    const interval = setInterval(poll, 3000);
    poll(); // Initial check

    return () => clearInterval(interval);
  }, [orderId]);

  if (!orderId) {
    return (
      <div className="flex flex-col items-center justify-center pt-32 gap-6 text-center px-4">
          <XCircle className="w-16 h-16 text-red-500" />
          <h1 className="text-2xl font-bold uppercase tracking-tight">Заказ не найден</h1>
          <p className="text-zinc-500">Проверьте корректность ссылки или обратитесь в поддержку.</p>
          <Link href="/" className="px-8 h-12 bg-white/5 rounded-xl flex items-center justify-center font-bold">НА ГЛАВНУЮ</Link>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 pt-32 flex flex-col items-center">
      <div className="w-full max-w-md glass p-12 rounded-[2.5rem] border border-white/5 text-center flex flex-col items-center gap-8 shadow-2xl">
        
        {status === "PENDING" && (
            <>
                <Loader2 className="w-20 h-20 text-[#ffb800] animate-spin" />
                <div className="space-y-3">
                    <h1 className="text-3xl font-black uppercase italic tracking-tighter">Ожидаем оплату</h1>
                    <p className="text-zinc-500 font-medium">Пожалуйста, завершите оплату в открывшейся вкладке.</p>
                </div>
            </>
        )}

        {(status === "PAID" || status === "FULFILLED") && (
            <>
                <CheckCircle2 className="w-20 h-20 text-green-500 fill-green-500/10" />
                <div className="space-y-3">
                    <h1 className="text-3xl font-black uppercase italic tracking-tighter text-green-500">Оплата прошла!</h1>
                    <p className="text-zinc-400 font-medium">Ваши Robux уже в пути! Обычно это занимает 5-15 минут.</p>
                </div>
                <div className="grid grid-cols-2 gap-4 w-full pt-4">
                    <div className="bg-white/5 p-4 rounded-2xl">
                        <span className="text-[10px] font-black tracking-widest text-zinc-600 block uppercase mb-1">Статус</span>
                        <span className="text-xs font-bold text-green-400">ОПЛАЧЕНО</span>
                    </div>
                     <div className="bg-white/5 p-4 rounded-2xl">
                        <span className="text-[10px] font-black tracking-widest text-zinc-600 block uppercase mb-1">Номер заказа</span>
                        <span className="text-[10px] font-mono text-zinc-500 truncate block">{orderId.slice(0, 8)}...</span>
                    </div>
                </div>
            </>
        )}

        {status === "FAILED" && (
            <>
                <XCircle className="w-20 h-20 text-red-500" />
                <div className="space-y-3">
                    <h1 className="text-3xl font-black uppercase italic tracking-tighter text-red-500">Ошибка оплаты</h1>
                    <p className="text-zinc-500 font-medium">К сожалению, платеж не был обработан банком.</p>
                </div>
                <Link href="/checkout" className="w-full h-14 bg-red-500/10 text-red-500 rounded-2xl flex items-center justify-center font-bold border border-red-500/20">ПОПРОБОВАТЬ СНОВА</Link>
            </>
        )}

        <div className="h-px w-full bg-white/5 my-4" />

        <Link 
            href="/" 
            className="group text-sm font-bold text-zinc-500 hover:text-white transition-colors flex items-center gap-2"
        >
            ВЕРНУТЬСЯ В МАГАЗИН <ArrowRight className="w-4 h-4" />
        </Link>

      </div>

      <div className="mt-12 p-6 glass rounded-2xl border border-white/5 max-w-md flex gap-4 items-start bg-blue-500/5">
            <Clock className="w-6 h-6 text-blue-500 shrink-0 mt-0.5" />
            <div className="space-y-1">
                <span className="text-xs font-black uppercase tracking-widest text-blue-400 block">Важно!</span>
                <p className="text-[10px] text-blue-300/60 leading-relaxed font-medium">
                    Из-за политики Roblox, Robux через геймпассы могут находиться в статусе "Pending" до 5-7 дней. Вы можете проверить это на странице транзакций Roblox.
                </p>
            </div>
      </div>
    </div>
  );
}

export default function StatusPage() {
  return (
    <main className="min-h-screen">
      <Navbar />
      <Suspense fallback={<div className="h-screen flex items-center justify-center"><Loader2 className="w-10 h-10 animate-spin text-[#ffb800]" /></div>}>
        <StatusContent />
      </Suspense>
    </main>
  );
}
