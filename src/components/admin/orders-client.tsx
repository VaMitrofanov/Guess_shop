"use client";

import { useState, useMemo } from "react";
import { CheckCircle2, Clock, XCircle, Zap, Search, Filter, RefreshCw } from "lucide-react";

type Order = {
  id: string;
  customerRobloxUser: string;
  amountRUB: number;
  amountRobux: number;
  status: string;
  botStatus: string | null;
  method: string;
  gamepassId: string | null;
  createdAt: string;
  product: { name: string } | null;
};

const STATUS_META: Record<string, { label: string; color: string; dot: string; bg: string }> = {
  PENDING:   { label: "Ожидает",   color: "text-amber-400",  dot: "bg-amber-400",  bg: "bg-amber-500/10 border-amber-500/20"  },
  PAID:      { label: "Оплачен",   color: "text-blue-400",   dot: "bg-blue-400",   bg: "bg-blue-500/10 border-blue-500/20"    },
  FULFILLED: { label: "Выполнен",  color: "text-[#00b06f]",  dot: "bg-[#00b06f]",  bg: "bg-[#00b06f]/10 border-[#00b06f]/20" },
  FAILED:    { label: "Ошибка",    color: "text-red-400",    dot: "bg-red-400",    bg: "bg-red-500/10 border-red-500/20"      },
};

function fmtDate(d: string) {
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(d));
}

export default function AdminOrdersClient({ initialOrders }: { initialOrders: Order[] }) {
  const [orders, setOrders]       = useState<Order[]>(initialOrders);
  const [search, setSearch]       = useState("");
  const [statusFilter, setStatus] = useState("ALL");
  const [fulfilling, setFulfilling] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return orders.filter((o) => {
      const matchSearch = search === "" ||
        o.customerRobloxUser.toLowerCase().includes(search.toLowerCase()) ||
        o.id.toLowerCase().includes(search.toLowerCase());
      const matchStatus = statusFilter === "ALL" || o.status === statusFilter;
      return matchSearch && matchStatus;
    });
  }, [orders, search, statusFilter]);

  async function fulfill(id: string) {
    if (!confirm("Отметить заказ как выполненный?")) return;
    setFulfilling(id);
    try {
      const res = await fetch(`/api/admin/orders/${id}/fulfill`, { method: "POST" });
      if (res.ok) {
        setOrders((prev) => prev.map((o) => o.id === id ? { ...o, status: "FULFILLED" } : o));
      }
    } finally {
      setFulfilling(null);
    }
  }

  const counts = useMemo(() => ({
    ALL:       orders.length,
    PENDING:   orders.filter(o => o.status === "PENDING").length,
    PAID:      orders.filter(o => o.status === "PAID").length,
    FULFILLED: orders.filter(o => o.status === "FULFILLED").length,
    FAILED:    orders.filter(o => o.status === "FAILED").length,
  }), [orders]);

  return (
    <div className="space-y-4">

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-600" />
          <input
            type="text"
            placeholder="Поиск по нику или ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-10 bg-[#080c18] border-2 border-[#1e2a45] pl-10 pr-4 outline-none focus:border-[#00b06f]/40 transition-colors font-medium text-sm placeholder:text-zinc-700"
          />
        </div>
        <div className="flex gap-1 flex-wrap">
          {(["ALL", "PENDING", "PAID", "FULFILLED", "FAILED"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`h-10 px-3 text-[10px] font-black uppercase tracking-wider transition-colors border-2 ${
                statusFilter === s
                  ? "border-[#00b06f]/40 bg-[#00b06f]/10 text-[#00b06f]"
                  : "border-[#1e2a45] text-zinc-500 hover:text-zinc-300 hover:border-zinc-600"
              }`}
            >
              {s === "ALL" ? "Все" : STATUS_META[s]?.label} ({counts[s]})
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="pixel-card border-2 border-[#1e2a45] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#1e2a45] bg-[#080c18]">
                <th className="text-left px-4 py-3 font-pixel text-[8px] text-zinc-600 tracking-wider">ИГРОК</th>
                <th className="text-left px-4 py-3 font-pixel text-[8px] text-zinc-600 tracking-wider">СУММА</th>
                <th className="text-left px-4 py-3 font-pixel text-[8px] text-zinc-600 tracking-wider hidden md:table-cell">МЕТОД</th>
                <th className="text-left px-4 py-3 font-pixel text-[8px] text-zinc-600 tracking-wider hidden lg:table-cell">ДАТА</th>
                <th className="text-left px-4 py-3 font-pixel text-[8px] text-zinc-600 tracking-wider">СТАТУС</th>
                <th className="text-left px-4 py-3 font-pixel text-[8px] text-zinc-600 tracking-wider">ДЕЙСТВИЕ</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((order) => {
                const meta = STATUS_META[order.status] ?? { label: order.status, color: "text-zinc-400", dot: "bg-zinc-400", bg: "" };
                return (
                  <tr key={order.id} className="border-b border-[#1e2a45]/40 hover:bg-[#00b06f]/3 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-black text-sm">{order.customerRobloxUser}</p>
                      <p className="text-xs text-zinc-500">{order.amountRobux} R$ · {order.gamepassId ?? "—"}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-black text-sm">{order.amountRUB.toFixed(0)} ₽</p>
                    </td>
                    <td className="px-4 py-3 text-xs text-zinc-400 font-medium hidden md:table-cell">{order.method}</td>
                    <td className="px-4 py-3 text-xs text-zinc-500 hidden lg:table-cell whitespace-nowrap">{fmtDate(order.createdAt)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 text-xs font-black ${meta.color}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
                        {meta.label}
                        {order.botStatus && (
                          <span className="text-zinc-600 font-medium">· {order.botStatus}</span>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {order.status === "PAID" && (
                        <button
                          onClick={() => fulfill(order.id)}
                          disabled={fulfilling === order.id}
                          className="h-7 px-3 border border-[#00b06f]/30 bg-[#00b06f]/10 text-[#00b06f] text-[9px] font-black uppercase tracking-wider hover:bg-[#00b06f]/20 transition-colors disabled:opacity-50 flex items-center gap-1"
                        >
                          {fulfilling === order.id ? <RefreshCw className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                          Выполнить
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-zinc-600 text-sm">Ничего не найдено</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 bg-[#080c18] border-t border-[#1e2a45] text-xs text-zinc-600 font-medium">
          Показано: {filtered.length} из {orders.length}
        </div>
      </div>
    </div>
  );
}
