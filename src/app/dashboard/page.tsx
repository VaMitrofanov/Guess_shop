import type { Metadata } from "next";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  buildCustomerNotices,
  customerOrderProgress,
  customerOrderStatus,
  orderRecordLabel,
  paymentAttemptLabel,
  type CustomerOrderKind,
  type CustomerOrderTone,
} from "@/lib/customer-dashboard";
import Navbar from "@/components/navbar";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  Bell,
  CheckCircle2,
  ChevronRight,
  CircleUserRound,
  Clock,
  ExternalLink,
  Gamepad2,
  Gift,
  Link2,
  LogOut,
  Package,
  Radio,
  ReceiptText,
  ShieldCheck,
  ShoppingCart,
  User,
  XCircle,
  Zap,
} from "lucide-react";
import TelegramLoginButton from "@/components/auth/TelegramLoginButton";
import SignOutAction from "@/components/auth/SignOutAction";
import styles from "./dashboard.module.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Личный кабинет | RobloxBank",
  description: "Заказы, бонусы, статусы оплаты и связанные способы входа RobloxBank.",
  robots: { index: false, follow: false },
};

type DashboardOrder = {
  id: string;
  displayId: string;
  publicOrderId: string | null;
  kind: CustomerOrderKind;
  source: "SITE" | "WB" | "DIRECT" | "AVITO" | "MANUAL";
  createdAt: Date;
  status: string;
  amountRobux: number;
  customer: string | null;
  amountKopecks: number | null;
  receiptEmail: string | null;
  payment: {
    status: string;
    amountKopecks: number;
    refundedAmountKopecks: number;
    finalizedAt: Date | null;
  } | null;
};

const TONE_ICON: Record<CustomerOrderTone, typeof Clock> = {
  waiting: Clock,
  progress: Zap,
  success: CheckCircle2,
  danger: XCircle,
  neutral: Radio,
};

function StatusBadge({ kind, status }: Pick<DashboardOrder, "kind" | "status">) {
  const meta = customerOrderStatus(kind, status);
  const Icon = TONE_ICON[meta.tone];
  return (
    <span className={`${styles.status} ${styles[`tone_${meta.tone}`]}`}>
      <Icon size={15} aria-hidden="true" />
      {meta.label}
    </span>
  );
}

function formatDate(date: Date, withTime = false) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(new Date(date));
}

function formatKopecks(amountKopecks: number | null) {
  if (amountKopecks === null) return "—";
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(amountKopecks / 100)} ₽`;
}

function sourceLabel(source: DashboardOrder["source"]) {
  const labels: Record<DashboardOrder["source"], string> = {
    SITE: "Сайт",
    WB: "Wildberries",
    DIRECT: "Прямой заказ",
    AVITO: "Avito",
    MANUAL: "Менеджер",
  };
  return labels[source];
}

function orderHref(order: DashboardOrder) {
  return order.publicOrderId ? `/payment/status?orderId=${encodeURIComponent(order.publicOrderId)}` : null;
}

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const userId = (session.user as { id?: string }).id;
  if (!userId) redirect("/login");

  const [user, legacyOrders, canonicalOrders] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
        balance: true,
        bonusExpiresAt: true,
        robloxUsername: true,
        identities: {
          orderBy: { verifiedAt: "asc" },
          select: { provider: true, verifiedAt: true },
        },
      },
    }),
    prisma.order.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        createdAt: true,
        status: true,
        amountRobux: true,
        customerRobloxUser: true,
        amountRUB: true,
      },
    }),
    prisma.wbOrder.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        wbCode: true,
        publicOrderId: true,
        createdAt: true,
        status: true,
        amount: true,
        robloxUsername: true,
        orderSource: true,
        paymentAmountKopecks: true,
        receiptEmail: true,
        paymentAttempts: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            status: true,
            amountKopecks: true,
            refundedAmountKopecks: true,
            finalizedAt: true,
          },
        },
      },
    }),
  ]);
  if (!user) redirect("/login");

  const orders: DashboardOrder[] = [
    ...legacyOrders.map((order) => ({
      id: order.id,
      displayId: order.id.slice(-7).toUpperCase(),
      publicOrderId: null,
      kind: "legacy" as const,
      source: "SITE" as const,
      createdAt: order.createdAt,
      status: order.status,
      amountRobux: order.amountRobux,
      customer: order.customerRobloxUser,
      amountKopecks: Math.round(order.amountRUB * 100),
      receiptEmail: null,
      payment: null,
    })),
    ...canonicalOrders.map((order) => ({
      id: order.id,
      displayId: order.publicOrderId ?? order.wbCode,
      publicOrderId: order.publicOrderId,
      kind: "canonical" as const,
      source: order.orderSource,
      createdAt: order.createdAt,
      status: order.status,
      amountRobux: order.amount,
      customer: order.robloxUsername,
      amountKopecks: order.paymentAmountKopecks,
      receiptEmail: order.receiptEmail,
      payment: order.paymentAttempts[0] ?? null,
    })),
  ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 50);

  const linkedProviders = user.identities.map((identity) => identity.provider);
  const identityNames = new Map(user.identities.map((identity) => [identity.provider, identity]));
  const bonusActive = user.balance > 0 && (!user.bonusExpiresAt || user.bonusExpiresAt > new Date());
  const notices = buildCustomerNotices({
    orders: orders.map(({ id, kind, status, amountRobux, createdAt }) => ({ id, kind, status, amountRobux, createdAt })),
    balance: bonusActive ? user.balance : 0,
    bonusExpiresAt: user.bonusExpiresAt,
    linkedProviders,
  });
  const completedCount = orders.filter((order) => customerOrderStatus(order.kind, order.status).completed).length;
  const activeCount = orders.filter((order) => customerOrderStatus(order.kind, order.status).active).length;
  const greetingName = user.robloxUsername ?? user.name ?? user.email?.split("@")[0] ?? "друг";
  const checkoutHref = user.robloxUsername ? `/checkout?username=${encodeURIComponent(user.robloxUsername)}` : "/checkout";
  const latestActive = orders.find((order) => customerOrderStatus(order.kind, order.status).active);
  const latestActiveProgress = latestActive ? customerOrderProgress(latestActive.kind, latestActive.status) : 0;
  const latestActiveHref = latestActive?.status === "AWAITING_GAMEPASS"
    ? `/guide?source=site&amount=${latestActive.amountRobux}&username=${encodeURIComponent(latestActive.customer ?? "")}`
    : latestActive ? orderHref(latestActive) : null;

  return (
    <main className={styles.page}>
      <Navbar />
      <div className={styles.shell}>
        <header className={styles.hero}>
          <div className={styles.heroCopy}>
            <span className={styles.heroBadge}><ShieldCheck size={15} /> Личный сейф</span>
            <h1>Привет, <span>{greetingName}</span></h1>
            <p>
              Заказы, оплата и бонусы собраны в одном месте. Если нужен твой шаг — он будет первым в ленте.
            </p>
            <div className={styles.actions}>
              <Link href={checkoutHref} className={styles.primary}><ShoppingCart size={18} /> Купить Robux</Link>
              {latestActive && orderHref(latestActive) && (
                <Link href={orderHref(latestActive)!} className={styles.secondary}>Открыть активный заказ <ArrowRight size={17} /></Link>
              )}
            </div>
          </div>
          <div className={styles.vaultCard}>
            <div className={styles.vaultTop}><span>Бонусный сейф</span><Gift size={20} /></div>
            <strong>{bonusActive ? user.balance : 0}<small> R$</small></strong>
            <p>{bonusActive && user.bonusExpiresAt ? `Доступно до ${formatDate(user.bonusExpiresAt)}` : bonusActive ? "Готовы к следующему заказу" : "Бонусы появятся после акций и отзывов"}</p>
            <div className={styles.vaultLine}><i style={{ width: bonusActive ? "72%" : "12%" }} /></div>
          </div>
        </header>

        <section className={styles.stats} aria-label="Краткая сводка">
          <article><small>Заказы</small><strong>{orders.length}</strong><span>в общей истории</span></article>
          <article><small>Активные</small><strong>{activeCount}</strong><span>сейчас в работе</span></article>
          <article><small>Готово</small><strong>{completedCount}</strong><span>уже выполнено</span></article>
          <article><small>Каналы</small><strong>{linkedProviders.length}</strong><span>подтверждено</span></article>
        </section>

        <div className={styles.dashboardGrid}>
          <div className={styles.mainColumn}>
            {latestActive && (
              <section className={styles.activeOrder} aria-label="Активный заказ">
                <div className={styles.activeOrderTop}>
                  <div><span className={styles.kicker}>Активный заказ · {sourceLabel(latestActive.source)}</span><h2>{latestActive.amountRobux.toLocaleString("ru-RU")} R$</h2><p>{latestActive.displayId} · {latestActive.customer ?? "Roblox-ник уточняется"}</p></div>
                  <StatusBadge kind={latestActive.kind} status={latestActive.status} />
                </div>
                <ol className={styles.orderProgress}>
                  {["Оплата", "Очередь", "Выкуп", "Готово"].map((label, index) => <li key={label} className={index < latestActiveProgress ? styles.progressDone : index === latestActiveProgress ? styles.progressCurrent : ""}><span>{index < latestActiveProgress ? <CheckCircle2 size={15} /> : index + 1}</span><small>{label}</small></li>)}
                </ol>
                <div className={styles.activeOrderBottom}><span>Следующий шаг: <strong>{customerOrderStatus(latestActive.kind, latestActive.status).label}</strong></span>{latestActiveHref && <Link href={latestActiveHref}>Подробнее <ArrowRight size={16} /></Link>}</div>
              </section>
            )}
            <section className={styles.sectionCard}>
              <div className={styles.sectionHead}>
                <div><span className={styles.kicker}>Центр событий</span><h2>Что сейчас важно</h2></div>
                <Bell size={23} aria-hidden="true" />
              </div>
              <div className={styles.noticeList}>
                {notices.map((notice) => {
                  const relatedOrder = notice.orderId ? orders.find((order) => order.id === notice.orderId) : null;
                  const href = relatedOrder?.status === "AWAITING_GAMEPASS"
                    ? `/guide?source=site&amount=${relatedOrder.amountRobux}&username=${encodeURIComponent(relatedOrder.customer ?? "")}`
                    : relatedOrder ? orderHref(relatedOrder) : notice.id === "identity" ? "#identity-settings" : null;
                  const NoticeIcon = notice.tone === "danger" ? XCircle : notice.tone === "waiting" ? Clock : notice.tone === "success" ? CheckCircle2 : Radio;
                  const content = <><span className={`${styles.noticeIcon} ${styles[`tone_${notice.tone}`]}`}><NoticeIcon size={18} /></span><span><strong>{notice.title}</strong><small>{notice.text}</small></span>{href && <ChevronRight size={18} className={styles.noticeArrow} />}</>;
                  return href ? <Link key={notice.id} href={href} className={styles.notice}>{content}</Link> : <div key={notice.id} className={styles.notice}>{content}</div>;
                })}
              </div>
            </section>

            <section className={styles.ordersSection}>
              <div className={styles.ordersHead}>
                <div><span className={styles.kicker}>Единая история</span><h2>Заказы</h2></div>
                <span>{orderRecordLabel(orders.length)}</span>
              </div>
              {orders.length === 0 ? (
                <div className={styles.empty}>
                  <span><Package size={28} /></span><h3>Сейф пока пуст</h3>
                  <p>Первый заказ и его статус появятся здесь сразу после оформления.</p>
                  <Link href={checkoutHref} className={styles.primary}>Купить Robux <ArrowRight size={18} /></Link>
                </div>
              ) : (
                <div className={styles.orderList}>
                  {orders.map((order) => {
                    const href = orderHref(order);
                    const hasPaymentDetails = order.kind === "canonical" && (order.receiptEmail || order.payment || order.amountKopecks !== null);
                    return (
                      <article key={`${order.kind}:${order.id}`} id={`order-${order.id}`} className={styles.orderCard}>
                        <div className={styles.orderMain}>
                          <div className={styles.orderTopline}>
                            <span>{sourceLabel(order.source)} · {order.displayId}</span>
                            <time dateTime={order.createdAt.toISOString()}>{formatDate(order.createdAt, true)}</time>
                          </div>
                          <div className={styles.orderBody}>
                            <div className={styles.orderAmount}><strong>{order.amountRobux.toLocaleString("ru-RU")} R$</strong><span>{order.customer ?? "Ник ещё не подтверждён"}</span></div>
                            <StatusBadge kind={order.kind} status={order.status} />
                          </div>
                          <div className={styles.orderMeta}>
                            {order.amountKopecks !== null && <span><ReceiptText size={15} /> {formatKopecks(order.amountKopecks)}</span>}
                            {href && <Link href={href}>Статус заказа <ExternalLink size={14} /></Link>}
                          </div>
                        </div>
                        {hasPaymentDetails && (
                          <details className={styles.receiptDetails}>
                            <summary><ReceiptText size={17} /> Платёж и данные для чека <ChevronRight size={16} /></summary>
                            <dl>
                              <div><dt>Сумма</dt><dd>{formatKopecks(order.payment?.amountKopecks ?? order.amountKopecks)}</dd></div>
                              <div><dt>Оплата</dt><dd>{paymentAttemptLabel(order.payment?.status ?? null)}</dd></div>
                              {order.receiptEmail && <div><dt>Email для чека</dt><dd>{order.receiptEmail}</dd></div>}
                              {!!order.payment?.refundedAmountKopecks && <div><dt>Возвращено</dt><dd>{formatKopecks(order.payment.refundedAmountKopecks)}</dd></div>}
                              {order.payment?.finalizedAt && <div><dt>Обновлено</dt><dd>{formatDate(order.payment.finalizedAt, true)}</dd></div>}
                            </dl>
                          </details>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          </div>

          <aside className={styles.sidebar}>
            <section className={styles.profileCard}>
              <div className={styles.profileTop}>
                <span className={styles.avatar}><User size={25} /></span>
                <div><strong>{user.name ?? greetingName}</strong><span>{user.email ?? "Аккаунт RobloxBank"}</span></div>
              </div>
              <dl className={styles.profileRows}>
                <div><dt>Ник Roblox</dt><dd><Gamepad2 size={15} /> {user.robloxUsername ?? "Не указан"}</dd></div>
                <div><dt>Клиент с</dt><dd>{formatDate(user.createdAt)}</dd></div>
                {user.role === "ADMIN" && <div><dt>Роль</dt><dd>Администратор</dd></div>}
              </dl>
            </section>

            <section id="identity-settings" className={styles.identityCard}>
              <div className={styles.sideHead}><span><Link2 size={18} /> Способы входа</span><ShieldCheck size={18} /></div>
              <p>Подтверждённые каналы возвращают в тот же профиль с заказами и бонусами.</p>
              <div className={styles.identityList}>
                {(["TG", "VK", "EMAIL"] as const).map((provider) => {
                  const identity = identityNames.get(provider);
                  const label = provider === "TG" ? "Telegram" : provider === "VK" ? "ВКонтакте" : "Email";
                  return (
                    <div key={provider} className={identity ? styles.identityOn : styles.identityOff}>
                      <span>{provider === "TG" ? "TG" : provider === "VK" ? "VK" : "@"}</span>
                      <div><strong>{label}</strong><small>{identity ? `Подтверждён ${formatDate(identity.verifiedAt)}` : "Не связан"}</small></div>
                      {identity ? <CheckCircle2 size={18} /> : <CircleUserRound size={18} />}
                    </div>
                  );
                })}
              </div>
              {!identityNames.has("TG") && user.role !== "ADMIN" && (
                <div className={styles.linkAction}>
                  <p>Связать Telegram можно после свежего подтверждения входа.</p>
                  <TelegramLoginButton mode="link" />
                </div>
              )}
              {!identityNames.has("VK") && <p className={styles.identityHint}>VK ID можно использовать для входа; безопасная привязка появится после повторного подтверждения обоих профилей.</p>}
            </section>

            <nav className={styles.quickLinks} aria-label="Быстрые действия">
              <Link href={checkoutHref}><ShoppingCart size={18} /><span><strong>Новый заказ</strong><small>Ник уже подставлен</small></span><ChevronRight size={17} /></Link>
              <Link href="/guide?source=site&amount=1000"><Gamepad2 size={18} /><span><strong>Инструкция</strong><small>Создать геймпасс</small></span><ChevronRight size={17} /></Link>
              <a href="https://t.me/RobloxBank_PA" target="_blank" rel="noopener noreferrer"><Bell size={18} /><span><strong>Поддержка</strong><small>Живой менеджер</small></span><ExternalLink size={16} /></a>
              <SignOutAction><LogOut size={18} /><span><strong>Выйти</strong><small>Завершить сессию</small></span><ChevronRight size={17} /></SignOutAction>
            </nav>
          </aside>
        </div>
      </div>
    </main>
  );
}
