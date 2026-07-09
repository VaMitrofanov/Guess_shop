"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import Navbar from "@/components/navbar";
import { CheckCircle2, XCircle, Clock, Loader2, ArrowRight } from "lucide-react";

function StatusContent() {
  const searchParams = useSearchParams();
  const orderId = searchParams.get("orderId");
  const [status, setStatus] = useState<string>("PENDING");
  const [, setLoading] = useState(true);

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
      <div className="container mx-auto px-4 pt-32 max-w-md flex flex-col items-center gap-6 text-center">
        <div className="w-16 h-16 border-2 border-red-500/30 bg-red-500/5 flex items-center justify-center">
          <XCircle className="w-8 h-8 text-red-400" />
        </div>
        <h1 className="text-2xl font-black uppercase tracking-tight">Заказ не найден</h1>
        <p className="text-zinc-500 text-sm font-medium">Проверьте корректность ссылки или обратитесь в поддержку.</p>
        <Link
          href="/"
          className="h-12 px-8 border-2 border-[#1e2a45] hover:border-[#00b06f]/30 flex items-center justify-center font-black text-[10px] uppercase tracking-widest text-zinc-400 hover:text-[#00b06f] transition-all rounded-none"
        >
          На главную
        </Link>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 pt-24 pb-16 flex flex-col items-center">
      <div className="w-full max-w-md pixel-card border-2 border-[#1e2a45] p-10 text-center flex flex-col items-center gap-8">

        {status === "PENDING" && (
          <>
            <Loader2 className="w-16 h-16 text-amber-400 animate-spin" />
            <div className="space-y-3">
              <div className="font-pixel text-[9px] text-amber-400/70 tracking-wider">PROCESSING</div>
              <h1 className="text-2xl font-black uppercase tracking-tight">Ожидаем оплату</h1>
              <p className="text-zinc-400 font-medium text-sm">Завершите оплату в открывшейся вкладке.</p>
            </div>
          </>
        )}

        {(status === "PAID" || status === "FULFILLED") && (
          <>
            <div className="w-16 h-16 border-2 border-[#00b06f]/30 bg-[#00b06f]/10 flex items-center justify-center">
              <CheckCircle2 className="w-8 h-8 text-[#00b06f]" />
            </div>
            <div className="space-y-3">
              <div className="font-pixel text-[9px] text-[#00b06f]/70 tracking-wider">PAID</div>
              <h1 className="text-2xl font-black uppercase tracking-tight text-[#00b06f]">Оплата прошла</h1>
              <p className="text-zinc-400 font-medium text-sm leading-relaxed">
                Заказ принят в обработку. Robux поступят через геймпасс по правилам Roblox.
              </p>
            </div>
            <div className="w-full border-2 border-[#1e2a45] bg-[#080c18] p-4 flex items-center justify-between">
              <span className="font-pixel text-[9px] text-zinc-500 tracking-wider">СТАТУС</span>
              <span className="inline-flex items-center gap-1.5 font-black text-xs uppercase tracking-wider text-[#00b06f]">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Оплачено
              </span>
            </div>
          </>
        )}

        {status === "FAILED" && (
          <>
            <div className="w-16 h-16 border-2 border-red-500/30 bg-red-500/5 flex items-center justify-center">
              <XCircle className="w-8 h-8 text-red-400" />
            </div>
            <div className="space-y-3">
              <div className="font-pixel text-[9px] text-red-400/70 tracking-wider">FAILED</div>
              <h1 className="text-2xl font-black uppercase tracking-tight text-red-400">Ошибка оплаты</h1>
              <p className="text-zinc-400 font-medium text-sm">Платёж не был обработан банком.</p>
            </div>
            <Link
              href="/checkout"
              className="w-full h-12 border-2 border-red-500/30 text-red-400 hover:bg-red-500/5 flex items-center justify-center font-black text-[10px] uppercase tracking-widest transition-all rounded-none"
            >
              Попробовать снова
            </Link>
          </>
        )}

        <div className="accent-line w-full" />

        <Link
          href="/"
          className="group text-[10px] font-black uppercase tracking-widest text-zinc-500 hover:text-[#00b06f] transition-colors flex items-center gap-2"
        >
          Вернуться в магазин <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>

      {/* Roblox pending disclaimer — consistent with the offer (5–7 дней). */}
      <div className="mt-8 max-w-md pixel-card border-2 border-[#1e2a45] p-5 flex gap-4 items-start">
        <Clock className="w-5 h-5 text-[#00b06f] shrink-0 mt-0.5" />
        <div className="space-y-1.5">
          <span className="font-pixel text-[9px] uppercase tracking-wider text-[#00b06f]/70 block">Важно</span>
          <p className="text-xs text-zinc-400 leading-relaxed font-medium">
            По правилам Roblox выкуп через геймпасс держится в статусе Pending до 5–7 дней. Отслеживать
            можно на странице транзакций Roblox — это нормальная задержка платформы, а не сбой заказа.
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
      <Suspense
        fallback={
          <div className="h-screen flex items-center justify-center">
            <Loader2 className="w-10 h-10 animate-spin text-[#00b06f]" />
          </div>
        }
      >
        <StatusContent />
      </Suspense>
    </main>
  );
}
