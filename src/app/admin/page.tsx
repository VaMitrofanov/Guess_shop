import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import Navbar from "@/components/navbar";
import { BarChart, Users, Package, Clock, CheckCircle2, TrendingUp } from "lucide-react";
import OrderList from "@/components/admin/order-list"; // Client component

export default async function AdminDashboard() {
  const session = await getServerSession(authOptions);

  if (!session || (session.user as any).role !== "ADMIN") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <h1 className="text-2xl font-bold">Доступ запрещен</h1>
          <Link href="/api/auth/signin" className="px-6 h-10 bg-white/10 rounded-lg flex items-center justify-center">ВОЙТИ</Link>
        </div>
      </div>
    );
  }

  // Fetch real stats
  const [totalOrders, pendingOrders, paidOrders, fulfilledOrders, productsCount] = await Promise.all([
    prisma.order.count(),
    prisma.order.count({ where: { status: 'PENDING' } }),
    prisma.order.count({ where: { status: 'PAID' } }),
    prisma.order.count({ where: { status: 'FULFILLED' } }),
    prisma.product.count(),
  ]);

  const totalRevenue = await prisma.order.aggregate({
    _sum: { amountRUB: true },
    where: { status: { in: ['PAID', 'FULFILLED'] } },
  });

  const orders = await prisma.order.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  return (
    <main className="min-h-screen bg-[#0a0a0b]">
        <Navbar />
        <div className="container mx-auto px-4 py-12">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-12">
                <div className="space-y-1">
                    <h1 className="text-3xl font-black italic gold-gradient bg-clip-text text-transparent uppercase tracking-tight">Панель управления</h1>
                    <p className="text-zinc-500 font-medium">Мониторинг заказов и финансов.</p>
                </div>
                <div className="flex items-center gap-3">
                    <Link 
                        href="/admin/products"
                        className="h-11 px-6 bg-[#ffb800] text-black font-bold rounded-xl flex items-center justify-center gap-2 hover:scale-[1.02] transition-all"
                    >
                        <Package className="w-4 h-4" />
                        ТОВАРЫ
                    </Link>
                    <Link 
                        href="/admin/faq"
                        className="h-11 px-6 bg-white/5 border border-white/5 text-white font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-white/10 transition-all"
                    >
                        F.A.Q.
                    </Link>
                    <Link 
                        href="/admin/reviews"
                        className="h-11 px-6 bg-white/5 border border-white/5 text-white font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-white/10 transition-all"
                    >
                        ОТЗЫВЫ
                    </Link>
                    <div className="p-2 glass rounded-lg flex items-center gap-2 border-[#ffffff05]">
                         <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest px-2">Роль: Администратор</span>
                    </div>
                </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6 mb-12">
                <div className="bg-[#141416] p-8 rounded-3xl border border-white/5 space-y-4 shadow-xl">
                    <div className="w-12 h-12 rounded-2xl bg-blue-500/10 flex items-center justify-center">
                        <TrendingUp className="w-6 h-6 text-blue-500" />
                    </div>
                    <div className="space-y-1">
                        <span className="text-xs font-bold text-zinc-600 uppercase tracking-widest">Общая выручка</span>
                        <p className="text-3xl font-black tracking-tight">{(totalRevenue._sum.amountRUB || 0).toLocaleString()} ₽</p>
                    </div>
                </div>
                <div className="bg-[#141416] p-8 rounded-3xl border border-white/5 space-y-4 shadow-xl">
                    <div className="w-12 h-12 rounded-2xl bg-yellow-500/10 flex items-center justify-center">
                        <Clock className="w-6 h-6 text-yellow-500" />
                    </div>
                    <div className="space-y-1">
                        <span className="text-xs font-bold text-zinc-600 uppercase tracking-widest">Ожидают бота</span>
                        <p className="text-3xl font-black tracking-tight">{paidOrders}</p>
                    </div>
                </div>
                 <div className="bg-[#141416] p-8 rounded-3xl border border-white/5 space-y-4 shadow-xl">
                    <div className="w-12 h-12 rounded-2xl bg-green-500/10 flex items-center justify-center">
                        <CheckCircle2 className="w-6 h-6 text-green-500" />
                    </div>
                    <div className="space-y-1">
                        <span className="text-xs font-bold text-zinc-600 uppercase tracking-widest">Выполнено</span>
                        <p className="text-3xl font-black tracking-tight">{fulfilledOrders}</p>
                    </div>
                </div>
                 <div className="bg-[#141416] p-8 rounded-3xl border border-white/5 space-y-4 shadow-xl">
                    <div className="w-12 h-12 rounded-2xl bg-purple-500/10 flex items-center justify-center">
                        <Package className="w-6 h-6 text-purple-500" />
                    </div>
                    <div className="space-y-1">
                        <span className="text-xs font-bold text-zinc-600 uppercase tracking-widest">Всего заказов</span>
                        <p className="text-3xl font-black tracking-tight">{totalOrders}</p>
                    </div>
                </div>
            </div>

            {/* Orders Manager Table */}
            <div className="bg-[#141416] border border-white/5 rounded-[2rem] overflow-hidden shadow-2xl">
                <div className="p-8 border-b border-white/5 flex items-center justify-between">
                    <h2 className="text-lg font-bold tracking-tight uppercase">Последние транзакции</h2>
                    <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Топ 50</span>
                </div>
                <div className="overflow-x-auto">
                    <OrderList initialOrders={JSON.parse(JSON.stringify(orders))} />
                </div>
            </div>
        </div>
    </main>
  );
}
