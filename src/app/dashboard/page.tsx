import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import Navbar from "@/components/navbar";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  User, Package, Clock, CheckCircle2, XCircle,
  ArrowRight, ShoppingCart, LogOut, Zap, Gift,
} from "lucide-react";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type DashboardOrder = {
  id: string;
  source: "SITE" | "WB" | "DIRECT" | "AVITO" | "MANUAL";
  createdAt: Date;
  status: string;
  amountRobux: number;
  customer: string | null;
  amountRub: number | null;
};

const STATUS_META: Record<string, { label: string; color: string; icon: typeof Clock }> = {
  PENDING: { label: "Ожидает оплаты", color: "text-amber-400", icon: Clock },
  PAYMENT_PENDING: { label: "Ожидает оплаты", color: "text-amber-400", icon: Clock },
  AWAITING_PAYMENT: { label: "Ожидает оплаты", color: "text-amber-400", icon: Clock },
  AWAITING_GAMEPASS: { label: "Нужен геймпасс", color: "text-amber-400", icon: Clock },
  PAID: { label: "Оплачен", color: "text-blue-400", icon: Zap },
  IN_PROGRESS: { label: "В обработке", color: "text-blue-400", icon: Zap },
  FULFILLED: { label: "Выполнен", color: "text-[#00b06f]", icon: CheckCircle2 },
  COMPLETED: { label: "Выполнен", color: "text-[#00b06f]", icon: CheckCircle2 },
  FAILED: { label: "Ошибка", color: "text-red-400", icon: XCircle },
  ERROR: { label: "Ошибка", color: "text-red-400", icon: XCircle },
  REJECTED: { label: "Отклонён", color: "text-red-400", icon: XCircle },
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

function sourceLabel(source: DashboardOrder["source"]) {
  return source === "SITE" ? "Сайт" : source === "DIRECT" ? "Прямой" : source === "WB" ? "WB" : source;
}

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const userId = (session.user as { id?: string }).id;
  if (!userId) redirect("/login");

  const [user, siteOrders, wbOrders] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, email: true, name: true, role: true, createdAt: true,
        balance: true, bonusExpiresAt: true, robloxUsername: true, identities: { select: { provider: true } },
      },
    }),
    prisma.order.findMany({
      where: { userId }, orderBy: { createdAt: "desc" }, take: 50,
      select: { id: true, createdAt: true, status: true, amountRobux: true, customerRobloxUser: true, amountRUB: true },
    }),
    prisma.wbOrder.findMany({
      where: { userId }, orderBy: { createdAt: "desc" }, take: 50,
      select: { id: true, createdAt: true, status: true, amount: true, robloxUsername: true, orderSource: true },
    }),
  ]);
  if (!user) redirect("/login");

  const orders: DashboardOrder[] = [
    ...siteOrders.map((order) => ({
      id: order.id, source: "SITE" as const, createdAt: order.createdAt, status: order.status,
      amountRobux: order.amountRobux, customer: order.customerRobloxUser, amountRub: order.amountRUB,
    })),
    ...wbOrders.map((order) => ({
      id: order.id, source: order.orderSource, createdAt: order.createdAt, status: order.status,
      amountRobux: order.amount, customer: order.robloxUsername, amountRub: null,
    })),
  ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 50);

  const completedStatuses = new Set(["FULFILLED", "COMPLETED"]);
  const activeStatuses = new Set(["PENDING", "PAYMENT_PENDING", "AWAITING_PAYMENT", "AWAITING_GAMEPASS", "PAID", "IN_PROGRESS"]);
  const bonusActive = user.balance > 0 && (!user.bonusExpiresAt || user.bonusExpiresAt > new Date());
  const identityLabels = user.identities.map((identity) => identity.provider === "TG" ? "Telegram" : identity.provider === "VK" ? "ВКонтакте" : "Email");
  const greetingName = user.robloxUsername ?? user.name ?? user.email?.split("@")[0] ?? "друг";
  const checkoutHref = user.robloxUsername ? `/checkout?username=${encodeURIComponent(user.robloxUsername)}` : "/checkout";

  return (
    <main className="min-h-screen">
      <Navbar />
      <div className="container mx-auto px-6 py-16 max-w-6xl">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6 mb-12">
          <div>
            <div className="font-pixel text-[10px] text-[#00b06f]/60 tracking-wider mb-3">ЛИЧНЫЙ КАБИНЕТ</div>
            <h1 className="text-4xl md:text-5xl font-black uppercase tracking-[-0.03em] leading-none">
              С возвращением, <span className="gold-text">{greetingName}</span>
            </h1>
            <p className="text-zinc-400 font-medium mt-2">
              {orders.length > 0 ? `Мы нашли ${orders.length} ${orders.length === 1 ? "заказ" : "заказов"}${bonusActive ? ` и ${user.balance} R$ бонусов` : ""}.` : "Ваши заказы и бонусы появятся здесь."}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link href={checkoutHref} className="h-11 px-6 gold-gradient font-black text-[10px] uppercase tracking-widest text-white hover:opacity-90 transition-all rounded-none flex items-center gap-2">
              <ShoppingCart className="w-4 h-4" /> Купить R$
            </Link>
            <a href="/api/auth/signout" className="h-11 px-5 border-2 border-[#1e2a45] hover:border-red-500/30 font-black text-[10px] uppercase tracking-widest text-zinc-400 hover:text-red-400 transition-all rounded-none flex items-center gap-2">
              <LogOut className="w-4 h-4" /> Выйти
            </a>
          </div>
        </div>

        <div className="accent-line mb-12" />

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-12">
          {[
            { label: "Заказов", value: orders.length, tag: "ИСТОРИЯ", color: "text-white" },
            { label: "Выполнено", value: orders.filter((order) => completedStatuses.has(order.status)).length, tag: "ГОТОВО", color: "text-[#00b06f]" },
            { label: "В обработке", value: orders.filter((order) => activeStatuses.has(order.status)).length, tag: "АКТИВНЫЕ", color: "text-amber-400" },
            { label: "Бонусы", value: `${bonusActive ? user.balance : 0} R$`, tag: "БАЛАНС", color: "text-blue-300" },
          ].map(({ label, value, tag, color }) => (
            <div key={tag} className="pixel-card border-2 border-[#1e2a45] p-6 space-y-3">
              <div className="font-pixel text-[9px] text-[#00b06f]/60 tracking-wider">{tag}</div>
              <div className={`text-3xl font-black ${color}`}>{value}</div>
              <div className="text-xs font-black text-zinc-500 uppercase tracking-wider">{label}</div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-12">
          <div className="pixel-card border-2 border-[#1e2a45] p-6 space-y-4">
            <div className="font-pixel text-[9px] text-[#00b06f]/60 tracking-wider">ПРОФИЛЬ</div>
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 border-2 border-[#00b06f]/20 bg-[#00b06f]/10 flex items-center justify-center flex-shrink-0"><User className="w-7 h-7 text-[#00b06f]" /></div>
              <div><p className="font-black text-base uppercase">{user.name ?? "—"}</p><p className="text-sm text-zinc-400 font-medium">{user.email ?? ""}</p></div>
            </div>
            <div className="border-t border-[#1e2a45] pt-4 space-y-2">
              <div className="flex justify-between gap-3 items-center"><span className="text-xs text-zinc-500 font-black uppercase tracking-wider">Roblox</span><span className="text-sm font-black text-zinc-300 text-right">{user.robloxUsername ?? "—"}</span></div>
              <div className="flex justify-between gap-3 items-center"><span className="text-xs text-zinc-500 font-black uppercase tracking-wider">Связано</span><span className="text-sm font-black text-zinc-300 text-right">{identityLabels.length ? identityLabels.join(" · ") : "—"}</span></div>
              {user.role === "ADMIN" && <div className="flex justify-between items-center"><span className="text-xs text-zinc-500 font-black uppercase tracking-wider">Роль</span><span className="font-pixel text-[9px] text-amber-400 border border-amber-400/20 bg-amber-400/10 px-2 py-1">АДМИНИСТРАТОР</span></div>}
              <div className="flex justify-between items-center"><span className="text-xs text-zinc-500 font-black uppercase tracking-wider">С нами с</span><span className="text-sm font-black text-zinc-300">{formatDate(user.createdAt)}</span></div>
            </div>
          </div>
          <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              { href: checkoutHref, icon: ShoppingCart, tag: "НОВЫЙ ЗАКАЗ", title: "Купить Robux", desc: "Оформить новый заказ на R$", accent: true },
              { href: "/guide", icon: Package, tag: "ИНСТРУКЦИЯ", title: "Инструкция", desc: "Как создать геймпасс", accent: false },
            ].map(({ href, icon: Icon, tag, title, desc, accent }) => (
              <Link key={href} href={href} className={`pixel-card border-2 p-6 flex flex-col justify-between gap-4 transition-colors hover:border-[#00b06f]/25 group ${accent ? "border-[#00b06f]/30 bg-[#00b06f]/5" : "border-[#1e2a45]"}`}>
                <div><div className="font-pixel text-[9px] text-[#00b06f]/60 tracking-wider mb-2">{tag}</div><p className="font-black uppercase text-lg">{title}</p><p className="text-sm text-zinc-400 font-medium mt-1">{desc}</p></div>
                <div className="flex justify-end"><ArrowRight className="w-4 h-4 text-zinc-600 group-hover:text-[#00b06f] transition-colors" /></div>
              </Link>
            ))}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-6"><div><div className="font-pixel text-[9px] text-[#00b06f]/60 tracking-wider mb-1">ИСТОРИЯ</div><h2 className="text-2xl font-black uppercase tracking-tight">Все заказы</h2></div></div>
          {orders.length === 0 ? (
            <div className="pixel-card border-2 border-[#1e2a45] p-16 text-center space-y-4"><div className="w-14 h-14 mx-auto border-2 border-[#1e2a45] flex items-center justify-center"><Package className="w-7 h-7 text-zinc-600" /></div><div><p className="font-black text-lg uppercase">Заказов пока нет</p><p className="text-sm text-zinc-500 font-medium mt-1">Оформи первый заказ прямо сейчас</p></div><Link href={checkoutHref} className="inline-flex h-11 px-7 gold-gradient font-black text-[10px] uppercase tracking-widest text-white hover:opacity-90 transition-all rounded-none items-center gap-2">Купить Robux <ArrowRight className="w-3.5 h-3.5" /></Link></div>
          ) : (
            <div className="pixel-card border-2 border-[#1e2a45] overflow-x-auto"><table className="w-full min-w-[620px]"><thead><tr className="border-b-2 border-[#1e2a45] bg-[#080c18]"><th className="text-left px-5 py-4 font-pixel text-[9px] text-zinc-500 tracking-wider">ДАТА</th><th className="text-left px-5 py-4 font-pixel text-[9px] text-zinc-500 tracking-wider">ЗАКАЗ</th><th className="text-left px-5 py-4 font-pixel text-[9px] text-zinc-500 tracking-wider">ИСТОЧНИК</th><th className="text-left px-5 py-4 font-pixel text-[9px] text-zinc-500 tracking-wider">СТАТУС</th></tr></thead><tbody>{orders.map((order) => <tr key={`${order.source}:${order.id}`} className="border-b border-[#1e2a45]/50 hover:bg-[#00b06f]/3 transition-colors"><td className="px-5 py-4 text-sm text-zinc-400 font-medium whitespace-nowrap">{formatDate(order.createdAt)}</td><td className="px-5 py-4"><p className="font-black text-sm">{order.amountRobux} R$ {order.amountRub !== null ? `· ${order.amountRub.toFixed(0)} ₽` : ""}</p><p className="text-xs text-zinc-500 font-medium">{order.customer ?? "Геймпасс ожидает подтверждения"}</p></td><td className="px-5 py-4 text-sm font-black text-zinc-300">{sourceLabel(order.source)}</td><td className="px-5 py-4"><StatusBadge status={order.status} /></td></tr>)}</tbody></table></div>
          )}
        </div>
      </div>
    </main>
  );
}
