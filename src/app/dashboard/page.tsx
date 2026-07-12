import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import Navbar from "@/components/navbar";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  User, Package, Clock, CheckCircle2, XCircle,
  ArrowRight, ShoppingCart, LogOut, Zap,
} from "lucide-react";
import TelegramLoginButton from "@/components/auth/TelegramLoginButton";
import styles from "./dashboard.module.css";

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
    <span className={`${styles.status} ${meta.color}`}>
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
    <main className={styles.page}>
      <Navbar />
      <div className={styles.shell}>
        <header className={styles.hero}>
          <div className={styles.heroCopy}><span className={styles.kicker}>Личный сейф RobloxBank</span><h1>С возвращением, <span>{greetingName}</span></h1><p>{orders.length > 0 ? `В сейфе ${orders.length} ${orders.length === 1 ? "заказ" : "заказов"}${bonusActive ? ` и ${user.balance} R$ бонусов` : ""}.` : "Здесь появятся заказы, бонусы и статусы."}</p></div>
          <div className={styles.actions}><Link href={checkoutHref} className={styles.primary}><ShoppingCart size={19} /> Купить R$</Link><Link href="/api/auth/signout" className={styles.secondary}><LogOut size={18} /> Выйти</Link></div>
        </header>

        <section className={styles.stats}>
          {[
            { label: "Всего заказов", value: orders.length, tag: "История" },
            { label: "Уже выполнено", value: orders.filter((order) => completedStatuses.has(order.status)).length, tag: "Готово" },
            { label: "Сейчас в работе", value: orders.filter((order) => activeStatuses.has(order.status)).length, tag: "Активные" },
            { label: "Доступно", value: `${bonusActive ? user.balance : 0} R$`, tag: "Бонусный сейф" },
          ].map(({ label, value, tag }) => (
            <article key={tag} className={styles.stat}><small>{tag}</small><strong>{value}</strong><span>{label}</span></article>
          ))}
        </section>

        <section className={styles.mainGrid}>
          <article className={styles.panel}>
            <span className={styles.panelLabel}>Профиль клиента</span>
            <div className={styles.profileTop}><span className={styles.avatar}><User size={28} /></span><div><strong>{user.name ?? greetingName}</strong><span>{user.email ?? "Аккаунт RobloxBank"}</span></div></div>
            <div className={styles.profileRows}><div><span>Ник Roblox</span><strong>{user.robloxUsername ?? "Не указан"}</strong></div><div><span>Связанные каналы</span><strong>{identityLabels.length ? identityLabels.join(" · ") : "—"}</strong></div>{user.role === "ADMIN" && <div><span>Роль</span><strong>Администратор</strong></div>}<div><span>Клиент с</span><strong>{formatDate(user.createdAt)}</strong></div></div>
            {!user.identities.some((identity) => identity.provider === "TG") && user.role !== "ADMIN" && (
              <><p className={styles.linkHelp}>Свяжи Telegram после свежего входа — старые заказы и бонусы объединятся безопасно.</p><TelegramLoginButton mode="link" /></>
            )}
          </article>
          <div className={styles.quickGrid}>
            {[
              { href: checkoutHref, tag: "Новый заказ", title: "Купить Robux", desc: "Сохранённый ник уже будет в форме." },
              { href: "/guide", tag: "Пошагово", title: "Открыть инструкцию", desc: "Создать и правильно оценить геймпасс." },
            ].map(({ href, tag, title, desc }) => (
              <Link key={href} href={href} className={styles.quickCard}>
                <div><span>{tag}</span><h2>{title}</h2><p>{desc}</p></div><ArrowRight size={22} />
              </Link>
            ))}
          </div>
        </section>

        <section>
          <div className={styles.historyHead}><div><span className={styles.kicker}>История операций</span><h2>Все заказы</h2></div></div>
          {orders.length === 0 ? (
            <div className={styles.empty}><div className={styles.emptyIcon}><Package size={28} /></div><h3>Сейф пока пуст</h3><p>Первый заказ и его статус появятся здесь сразу после оформления.</p><Link href={checkoutHref} className={styles.primary}>Купить Robux <ArrowRight size={18} /></Link></div>
          ) : (
            <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Дата</th><th>Заказ</th><th>Источник</th><th>Статус</th></tr></thead><tbody>{orders.map((order) => <tr key={`${order.source}:${order.id}`}><td>{formatDate(order.createdAt)}</td><td><strong>{order.amountRobux} R$ {order.amountRub !== null ? `· ${order.amountRub.toFixed(0)} ₽` : ""}</strong><span>{order.customer ?? "Геймпасс ожидает подтверждения"}</span></td><td><strong>{sourceLabel(order.source)}</strong></td><td><StatusBadge status={order.status} /></td></tr>)}</tbody></table></div>
          )}
        </section>
      </div>
    </main>
  );
}
