import { getServerSession } from "next-auth";
import { authOptions }      from "@/app/api/auth/[...nextauth]/route";
import { prisma }           from "@/lib/prisma";
import Navbar               from "@/components/navbar";
import Link                 from "next/link";
import { redirect }         from "next/navigation";
import {
  User, Package, Clock, CheckCircle2, XCircle,
  ArrowRight, ShoppingCart, LogOut, Zap,
} from "lucide-react";

/* ── Status helpers ── */
const STATUS_META: Record<string, { label: string; color: string; icon: typeof Clock }> = {
  PENDING:   { label: "Ожидает оплаты", color: "text-amber-400",  icon: Clock        },
  PAID:      { label: "Оплачен",        color: "text-blue-400",   icon: Zap          },
  FULFILLED: { label: "Выполнен",       color: "text-[#00b06f]",  icon: CheckCircle2 },
  FAILED:    { label: "Ошибка",         color: "text-red-400",    icon: XCircle      },
};

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? { label: status, color: "text-zinc-400", icon: Clock };
  const Icon = meta.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 font-black text-xs uppercase tracking-wider ${meta.color}`}>
      <Icon className="w-3.5 h-3.5" />
      {meta.label}
    </span>
  );
}

function formatDate(d: Date) {
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(d));
}

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect("/login");
  }

  const userId = (session.user as any).id as string;

  const [user, orders] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    }),
    prisma.order.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { product: true },
    }),
  ]);

  if (!user) redirect("/login");

  const totalSpent    = orders.filter(o => ["PAID","FULFILLED"].includes(o.status)).reduce((s, o) => s + o.amountRUB, 0);
  const fulfilledCount = orders.filter(o => o.status === "FULFILLED").length;
  const pendingCount   = orders.filter(o => ["PENDING","PAID"].includes(o.status)).length;

  return (
    <main className="min-h-screen">
      <Navbar />

      <div className="container mx-auto px-6 py-16 max-w-6xl">

        {/* ── Header ── */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6 mb-12">
          <div>
            <div className="font-pixel text-[10px] text-[#00b06f]/60 tracking-wider mb-3">ЛИЧНЫЙ КАБИНЕТ</div>
            <h1 className="text-4xl md:text-5xl font-black uppercase tracking-[-0.03em] leading-none">
              Привет,{" "}
              <span className="gold-text">{user.name ?? user.email?.split("@")[0] ?? "User"}</span>
            </h1>
            <p className="text-zinc-400 font-medium mt-2">{user.email}</p>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/checkout"
              className="h-11 px-6 gold-gradient font-black text-[10px] uppercase tracking-widest text-white hover:opacity-90 transition-all rounded-none flex items-center gap-2"
            >
              <ShoppingCart className="w-4 h-4" />
              Купить R$
            </Link>
            <a
              href="/api/auth/signout"
              className="h-11 px-5 border-2 border-[#1e2a45] hover:border-red-500/30 font-black text-[10px] uppercase tracking-widest text-zinc-400 hover:text-red-400 transition-all rounded-none flex items-center gap-2"
            >
              <LogOut className="w-4 h-4" />
              Выйти
            </a>
          </div>
        </div>

        <div className="accent-line mb-12" />

        {/* ── Stats ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-12">
          {[
            { label: "Заказов",      value: orders.length,                tag: "ИТОГО",      color: "text-white"         },
            { label: "Выполнено",    value: fulfilledCount,               tag: "ГОТОВО",     color: "text-[#00b06f]"     },
            { label: "В обработке",  value: pendingCount,                 tag: "АКТИВНЫЕ",   color: "text-amber-400"     },
            { label: "Потрачено",    value: `${totalSpent.toFixed(0)} ₽`, tag: "ПОТРАЧЕНО",  color: "text-zinc-300"      },
          ].map(({ label, value, tag, color }) => (
            <div key={tag} className="pixel-card border-2 border-[#1e2a45] p-6 space-y-3">
              <div className="font-pixel text-[9px] text-[#00b06f]/60 tracking-wider">{tag}</div>
              <div className={`text-3xl font-black ${color}`}>{value}</div>
              <div className="text-xs font-black text-zinc-500 uppercase tracking-wider">{label}</div>
            </div>
          ))}
        </div>

        {/* ── Profile card ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-12">
          <div className="pixel-card border-2 border-[#1e2a45] p-6 space-y-4">
            <div className="font-pixel text-[9px] text-[#00b06f]/60 tracking-wider">ПРОФИЛЬ</div>
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 border-2 border-[#00b06f]/20 bg-[#00b06f]/10 flex items-center justify-center flex-shrink-0">
                <User className="w-7 h-7 text-[#00b06f]" />
              </div>
              <div>
                <p className="font-black text-base uppercase">{user.name ?? "—"}</p>
                <p className="text-sm text-zinc-400 font-medium">{user.email}</p>
              </div>
            </div>
            <div className="border-t border-[#1e2a45] pt-4 space-y-2">
              {user.role === "ADMIN" && (
                <div className="flex justify-between items-center">
                  <span className="text-xs text-zinc-500 font-black uppercase tracking-wider">Роль</span>
                  <span className="font-pixel text-[9px] text-amber-400 border border-amber-400/20 bg-amber-400/10 px-2 py-1">
                    АДМИНИСТРАТОР
                  </span>
                </div>
              )}
              <div className="flex justify-between items-center">
                <span className="text-xs text-zinc-500 font-black uppercase tracking-wider">С нами с</span>
                <span className="text-sm font-black text-zinc-300">{formatDate(user.createdAt)}</span>
              </div>
            </div>
          </div>

          {/* Quick actions */}
          <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              { href: "/checkout", icon: ShoppingCart, tag: "НОВЫЙ ЗАКАЗ",  title: "Купить Robux",  desc: "Оформить новый заказ на R$",   accent: true  },
              { href: "/guide",    icon: Package,      tag: "ИНСТРУКЦИЯ",  title: "Инструкция",    desc: "Как создать геймпасс",         accent: false },
            ].map(({ href, icon: Icon, tag, title, desc, accent }) => (
              <Link
                key={href}
                href={href}
                className={`pixel-card border-2 p-6 flex flex-col justify-between gap-4 transition-colors hover:border-[#00b06f]/25 group ${
                  accent ? "border-[#00b06f]/30 bg-[#00b06f]/5" : "border-[#1e2a45]"
                }`}
              >
                <div>
                  <div className="font-pixel text-[9px] text-[#00b06f]/60 tracking-wider mb-2">{tag}</div>
                  <p className="font-black uppercase text-lg">{title}</p>
                  <p className="text-sm text-zinc-400 font-medium mt-1">{desc}</p>
                </div>
                <div className="flex justify-end">
                  <ArrowRight className="w-4 h-4 text-zinc-600 group-hover:text-[#00b06f] transition-colors" />
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* ── Orders ── */}
        <div>
          <div className="flex items-center justify-between mb-6">
            <div>
              <div className="font-pixel text-[9px] text-[#00b06f]/60 tracking-wider mb-1">ИСТОРИЯ</div>
              <h2 className="text-2xl font-black uppercase tracking-tight">История заказов</h2>
            </div>
          </div>

          {orders.length === 0 ? (
            <div className="pixel-card border-2 border-[#1e2a45] p-16 text-center space-y-4">
              <div className="w-14 h-14 mx-auto border-2 border-[#1e2a45] flex items-center justify-center">
                <Package className="w-7 h-7 text-zinc-600" />
              </div>
              <div>
                <p className="font-black text-lg uppercase">Заказов пока нет</p>
                <p className="text-sm text-zinc-500 font-medium mt-1">Оформи первый заказ прямо сейчас</p>
              </div>
              <Link
                href="/checkout"
                className="inline-flex h-11 px-7 gold-gradient font-black text-[10px] uppercase tracking-widest text-white hover:opacity-90 transition-all rounded-none items-center gap-2"
              >
                Купить Robux <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          ) : (
            <div className="pixel-card border-2 border-[#1e2a45] overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b-2 border-[#1e2a45] bg-[#080c18]">
                    <th className="text-left px-5 py-4 font-pixel text-[9px] text-zinc-500 tracking-wider">ДАТА</th>
                    <th className="text-left px-5 py-4 font-pixel text-[9px] text-zinc-500 tracking-wider">ТОВАР</th>
                    <th className="text-left px-5 py-4 font-pixel text-[9px] text-zinc-500 tracking-wider hidden sm:table-cell">СУММА</th>
                    <th className="text-left px-5 py-4 font-pixel text-[9px] text-zinc-500 tracking-wider">СТАТУС</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => (
                    <tr key={order.id} className="border-b border-[#1e2a45]/50 hover:bg-[#00b06f]/3 transition-colors">
                      <td className="px-5 py-4 text-sm text-zinc-400 font-medium whitespace-nowrap">
                        {formatDate(order.createdAt)}
                      </td>
                      <td className="px-5 py-4">
                        <p className="font-black text-sm">{order.amountRobux} R$</p>
                        <p className="text-xs text-zinc-500 font-medium">{order.customerRobloxUser}</p>
                      </td>
                      <td className="px-5 py-4 font-black text-sm hidden sm:table-cell">
                        {order.amountRUB.toFixed(0)} ₽
                      </td>
                      <td className="px-5 py-4">
                        <StatusBadge status={order.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
