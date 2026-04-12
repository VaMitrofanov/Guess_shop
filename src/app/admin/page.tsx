import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import {
  TrendingUp, CheckCircle2, ShoppingCart, Users,
  Package, MessageSquare, HelpCircle, ArrowRight,
} from "lucide-react";

function fmt(n: number) {
  return new Intl.NumberFormat("ru-RU").format(n);
}
function fmtDate(d: Date) {
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(d));
}

const STATUS_META: Record<string, { label: string; color: string; dot: string }> = {
  PENDING:   { label: "Ожидает",  color: "text-amber-400", dot: "bg-amber-400"  },
  PAID:      { label: "Оплачен",  color: "text-blue-400",  dot: "bg-blue-400"   },
  FULFILLED: { label: "Выполнен", color: "text-[#00b06f]", dot: "bg-[#00b06f]"  },
  FAILED:    { label: "Ошибка",   color: "text-red-400",   dot: "bg-red-400"    },
};

export default async function AdminDashboard() {
  const session = await auth();
  const adminName = (session?.user as any)?.name ?? "Admin";

  const [
    totalOrders, pendingOrders, paidOrders, fulfilledOrders, failedOrders,
    usersCount, productsCount, recentOrders,
  ] = await Promise.all([
    prisma.order.count(),
    prisma.order.count({ where: { status: "PENDING" } }),
    prisma.order.count({ where: { status: "PAID" } }),
    prisma.order.count({ where: { status: "FULFILLED" } }),
    prisma.order.count({ where: { status: "FAILED" } }),
    prisma.user.count(),
    prisma.product.count(),
    prisma.order.findMany({ orderBy: { createdAt: "desc" }, take: 12 }),
  ]);

  const revenue = await prisma.order.aggregate({
    _sum: { amountRUB: true },
    where: { status: { in: ["PAID", "FULFILLED"] } },
  });

  const totalRevenue = revenue._sum.amountRUB ?? 0;

  return (
    <div className="p-8 space-y-8">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="font-pixel text-[9px] text-[#00b06f]/60 tracking-wider mb-2">ADMIN PANEL</div>
          <h1 className="text-3xl font-black uppercase tracking-tight">
            Привет, <span className="gold-text">{adminName}</span>
          </h1>
        </div>
        <Link
          href="/admin/orders"
          className="h-10 px-5 gold-gradient font-black text-[10px] uppercase tracking-widest text-white hover:opacity-90 transition-all rounded-none flex items-center gap-2"
        >
          Все заказы <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>

      {/* Main stats */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {[
          { label: "Выручка",       value: `${fmt(Math.round(totalRevenue))} ₽`, icon: TrendingUp,  color: "text-[#00b06f]",  bg: "bg-[#00b06f]/10",  border: "border-[#00b06f]/20"  },
          { label: "Всего заказов", value: fmt(totalOrders),                       icon: ShoppingCart, color: "text-blue-400",   bg: "bg-blue-500/10",   border: "border-blue-500/20"   },
          { label: "Выполнено",     value: fmt(fulfilledOrders),                   icon: CheckCircle2, color: "text-[#00b06f]",  bg: "bg-[#00b06f]/10",  border: "border-[#00b06f]/20"  },
          { label: "Пользователей", value: fmt(usersCount),                        icon: Users,        color: "text-purple-400", bg: "bg-purple-500/10", border: "border-purple-500/20" },
        ].map(({ label, value, icon: Icon, color, bg, border }) => (
          <div key={label} className={`pixel-card border-2 ${border} p-6 space-y-4`}>
            <div className={`w-10 h-10 ${bg} border ${border} flex items-center justify-center`}>
              <Icon className={`w-5 h-5 ${color}`} />
            </div>
            <div>
              <div className={`text-2xl font-black ${color}`}>{value}</div>
              <div className="text-xs font-black text-zinc-500 uppercase tracking-wider mt-1">{label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Sub-stats */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        {[
          { label: "Ожидают оплаты", value: pendingOrders,   color: "text-amber-400" },
          { label: "Оплачены (бот)", value: paidOrders,      color: "text-blue-400"  },
          { label: "Ошибки",         value: failedOrders,    color: "text-red-400"   },
          { label: "Товаров",        value: productsCount,   color: "text-zinc-300"  },
        ].map(({ label, value, color }) => (
          <div key={label} className="pixel-card border-2 border-[#1e2a45] px-5 py-4 flex items-center justify-between">
            <span className="text-xs font-black text-zinc-500 uppercase tracking-wider">{label}</span>
            <span className={`text-xl font-black ${color}`}>{value}</span>
          </div>
        ))}
      </div>

      {/* Orders table + quick actions */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

        {/* Recent orders */}
        <div className="xl:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <div className="font-pixel text-[9px] text-[#00b06f]/60 tracking-wider">ПОСЛЕДНИЕ ЗАКАЗЫ</div>
            <Link href="/admin/orders" className="text-xs font-black text-zinc-500 hover:text-[#00b06f] transition-colors uppercase tracking-wider">
              Все →
            </Link>
          </div>
          <div className="pixel-card border-2 border-[#1e2a45] overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#1e2a45] bg-[#080c18]">
                  <th className="text-left px-4 py-3 font-pixel text-[8px] text-zinc-600 tracking-wider">ИГРОК</th>
                  <th className="text-left px-4 py-3 font-pixel text-[8px] text-zinc-600 tracking-wider">СУММА</th>
                  <th className="text-left px-4 py-3 font-pixel text-[8px] text-zinc-600 tracking-wider hidden sm:table-cell">ДАТА</th>
                  <th className="text-left px-4 py-3 font-pixel text-[8px] text-zinc-600 tracking-wider">СТАТУС</th>
                </tr>
              </thead>
              <tbody>
                {recentOrders.map((order) => {
                  const meta = STATUS_META[order.status] ?? { label: order.status, color: "text-zinc-400", dot: "bg-zinc-400" };
                  return (
                    <tr key={order.id} className="border-b border-[#1e2a45]/40 hover:bg-[#00b06f]/3 transition-colors">
                      <td className="px-4 py-3">
                        <p className="font-black text-sm text-white truncate max-w-[140px]">{order.customerRobloxUser}</p>
                        <p className="text-xs text-zinc-500">{order.amountRobux} R$</p>
                      </td>
                      <td className="px-4 py-3 font-black text-sm">{order.amountRUB.toFixed(0)} ₽</td>
                      <td className="px-4 py-3 text-xs text-zinc-500 hidden sm:table-cell whitespace-nowrap">{fmtDate(order.createdAt)}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1.5 text-xs font-black ${meta.color}`}>
                          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${meta.dot}`} />
                          {meta.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {recentOrders.length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-zinc-600 text-sm">Заказов пока нет</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Quick nav */}
        <div>
          <div className="font-pixel text-[9px] text-[#00b06f]/60 tracking-wider mb-4">УПРАВЛЕНИЕ</div>
          <div className="space-y-2">
            {[
              { href: "/admin/orders",   icon: ShoppingCart,  label: "Заказы",       desc: "Все транзакции",            accent: true  },
              { href: "/admin/products", icon: Package,       label: "Товары",       desc: "CRUD продуктов",            accent: false },
              { href: "/admin/users",    icon: Users,         label: "Пользователи", desc: "Регистрации",               accent: false },
              { href: "/admin/reviews",  icon: MessageSquare, label: "Отзывы",       desc: "Модерация",                 accent: false },
              { href: "/admin/faq",      icon: HelpCircle,    label: "FAQ",          desc: "Вопросы и ответы",          accent: false },
            ].map(({ href, icon: Icon, label, desc, accent }) => (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-3 p-4 pixel-card border-2 transition-colors hover:border-[#00b06f]/30 group ${
                  accent ? "border-[#00b06f]/30 bg-[#00b06f]/5" : "border-[#1e2a45]"
                }`}
              >
                <div className={`w-8 h-8 border flex items-center justify-center flex-shrink-0 ${
                  accent ? "border-[#00b06f]/30 bg-[#00b06f]/10" : "border-[#1e2a45] bg-[#080c18]"
                }`}>
                  <Icon className={`w-4 h-4 ${accent ? "text-[#00b06f]" : "text-zinc-500 group-hover:text-zinc-300"}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-black text-sm uppercase">{label}</p>
                  <p className="text-xs text-zinc-500">{desc}</p>
                </div>
                <ArrowRight className="w-3.5 h-3.5 text-zinc-600 group-hover:text-[#00b06f] transition-colors" />
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
