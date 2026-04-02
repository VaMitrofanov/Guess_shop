"use client";

import { useState } from "react";
import { CheckCircle2, Clock, XCircle, Search, ExternalLink, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export default function OrderList({ initialOrders }: { initialOrders: any[] }) {
  const [orders, setOrders] = useState(initialOrders);
  const [loading, setLoading] = useState<string | null>(null);

  const handleFulfill = async (orderId: string) => {
    setLoading(orderId);
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/fulfill`, {
        method: "POST",
      });
      if (res.ok) {
        setOrders(orders.map(o => o.id === orderId ? { ...o, status: "FULFILLED" } : o));
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(null);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "PENDING": return <Clock className="w-4 h-4 text-yellow-500" />;
      case "PAID": return <Clock className="w-4 h-4 text-green-500 animate-pulse" />;
      case "FULFILLED": return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      case "FAILED": return <XCircle className="w-4 h-4 text-red-500" />;
      default: return null;
    }
  };

  const getBotStatusBadge = (botStatus: string | null) => {
    if (!botStatus) return null;
    return (
        <span className={cn(
            "text-[9px] font-black px-1.5 py-0.5 rounded border ml-2",
            botStatus === 'PROCESSING' ? 'bg-blue-500/10 border-blue-500/20 text-blue-500' :
            botStatus === 'SUCCESS' ? 'bg-green-500/10 border-green-500/20 text-green-500' :
            botStatus === 'ERROR' ? 'bg-red-500/10 border-red-500/20 text-red-500' : 'bg-white/5 border-white/10 text-zinc-500'
        )}>
            {botStatus}
        </span>
    );
  };

  const translateStatus = (status: string) => {
      switch (status) {
          case "PENDING": return "ОЖИДАЕТ";
          case "PAID": return "ОПЛАЧЕНО";
          case "FULFILLED": return "ДОСТАВЛЕНО";
          case "FAILED": return "ОШИБКА";
          default: return status;
      }
  };

  return (
    <table className="w-full text-left border-collapse">
      <thead>
        <tr className="bg-white/5 border-b border-white/5">
          <th className="px-8 py-5 text-[10px] font-black tracking-widest text-zinc-500 uppercase">Клиент / ID</th>
          <th className="px-8 py-5 text-[10px] font-black tracking-widest text-zinc-500 uppercase">Товар (R$)</th>
          <th className="px-8 py-5 text-[10px] font-black tracking-widest text-zinc-500 uppercase">Цена (₽)</th>
          <th className="px-8 py-5 text-[10px] font-black tracking-widest text-zinc-500 uppercase">Статус сайта / Бота</th>
          <th className="px-8 py-5 text-[10px] font-black tracking-widest text-zinc-500 uppercase">Дата</th>
          <th className="px-8 py-5 text-[10px] font-black tracking-widest text-zinc-500 uppercase text-right">Действие</th>
        </tr>
      </thead>
      <tbody>
        {orders.map((order) => (
          <tr key={order.id} className="group border-b border-white/5 hover:bg-white/5 transition-colors">
            <td className="px-8 py-6">
              <div className="flex flex-col">
                <span className="font-bold text-sm tracking-tight">{order.customerRobloxUser}</span>
                <span className="text-[10px] font-mono text-zinc-600 truncate max-w-[120px]">{order.id}</span>
              </div>
            </td>
            <td className="px-8 py-6">
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold">{order.amountRobux} R$</span>
                  <span className="text-[9px] bg-white/5 px-2 py-0.5 rounded uppercase font-black tracking-widest text-zinc-500 border border-white/5">{order.method}</span>
                </div>
                {order.gamepassId && (
                  <span className="text-[10px] font-mono text-zinc-500">ID: {order.gamepassId}</span>
                )}
              </div>
            </td>
            <td className="px-8 py-6">
              <span className="text-sm font-black tracking-tight">{order.amountRUB.toLocaleString()} ₽</span>
            </td>
            <td className="px-8 py-6">
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  {getStatusIcon(order.status)}
                  <span className={cn(
                      "text-[10px] font-black tracking-widest uppercase",
                      order.status === 'PAID' ? 'text-green-500' :
                      order.status === 'FULFILLED' ? 'text-green-500/50' :
                      order.status === 'FAILED' ? 'text-red-500' : 'text-yellow-500'
                  )}>
                      {translateStatus(order.status)}
                  </span>
                </div>
                {getBotStatusBadge(order.botStatus)}
              </div>
            </td>
            <td className="px-8 py-6">
              <span className="text-xs font-medium text-zinc-500">{new Date(order.createdAt).toLocaleDateString("ru-RU")}</span>
            </td>
            <td className="px-8 py-6 text-right">
              <div className="flex items-center justify-end gap-2">
                {order.status === "PAID" && (
                    <>
                        <button 
                            disabled={loading === order.id}
                            onClick={() => {
                                setLoading(order.id);
                                fetch('/api/orders/webhook-to-automation', {
                                    method: "POST",
                                    body: JSON.stringify({
                                        orderId: order.id,
                                        customerRobloxUser: order.customerRobloxUser,
                                        amountRobux: order.amountRobux,
                                        method: order.method
                                    })
                                }).then(() => setLoading(null));
                            }}
                            className="h-9 w-9 bg-blue-500/10 text-blue-500 rounded-lg flex items-center justify-center border border-blue-500/20 hover:bg-blue-500 hover:text-white transition-all shadow-xl"
                            title="Отправить боту"
                        >
                            <Loader2 className={cn("w-4 h-4", loading === order.id ? "animate-spin" : "hidden")} />
                            <ExternalLink className={cn("w-4 h-4", loading === order.id ? "hidden" : "block")} />
                        </button>
                        <button 
                            disabled={loading === order.id}
                            onClick={() => handleFulfill(order.id)}
                            className="h-9 px-4 bg-green-500/10 text-green-500 text-[10px] font-black uppercase tracking-widest rounded-lg border border-green-500/20 hover:bg-green-500 hover:text-black transition-all shadow-xl"
                        >
                        {loading === order.id ? "..." : "ГОТОВО"}
                        </button>
                    </>
                )}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
