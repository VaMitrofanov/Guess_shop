import Link from "next/link";
import {
  Activity,
  ArrowUpRight,
  CircleAlert,
  CircleDollarSign,
  Clock3,
  Layers3,
  ShoppingBag,
  Users,
} from "lucide-react";
import { getAdminDashboardData } from "@/lib/admin-ecosystem";
import styles from "@/components/admin/admin-shell.module.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function money(kopecks: number) {
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(kopecks / 100);
}

function dateTime(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function paymentLabel(status: string | undefined) {
  if (!status) return "Без эквайринга";
  const labels: Record<string, string> = {
    CREATED: "Создан",
    INITIATED: "Открыт в банке",
    AUTHORIZED: "Авторизован",
    CONFIRMED: "Оплачен",
    REJECTED: "Отклонён",
    CANCELED: "Отменён",
    FAILED: "Ошибка",
    PARTIALLY_REFUNDED: "Частичный возврат",
    REFUNDED: "Возвращён",
  };
  return labels[status] ?? status;
}

export default async function AdminDashboard() {
  const { metrics, recentOrders } = await getAdminDashboardData();

  const cards = [
    { label: "Чистый оборот", value: money(metrics.netKopecks), icon: CircleDollarSign },
    { label: "Все заказы", value: metrics.totalOrders.toLocaleString("ru-RU"), icon: Layers3 },
    { label: "Сейчас в работе", value: metrics.activeOrders.toLocaleString("ru-RU"), icon: Clock3 },
    { label: "Пользователи", value: metrics.users.toLocaleString("ru-RU"), icon: Users },
  ];

  const attention = [
    { label: "Заказы с ошибкой", value: metrics.errorOrders, hint: "требуют решения менеджера" },
    { label: "Неясные возвраты", value: metrics.unknownRefunds, hint: "нужна сверка с банком" },
    { label: "Dead-letter", value: metrics.deadOutbox, hint: "уведомления не доставлены" },
    { label: "Платежи в процессе", value: metrics.openPayments, hint: "ещё не финализированы" },
  ];

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <span className={styles.eyebrow}>RobloxBank Control Center</span>
          <h1>Общий обзор</h1>
          <p>Desktop и Telegram TWA работают поверх одной очереди заказов, платежей и возвратов.</p>
        </div>
        <div className={styles.headerActions}>
          <Link className={styles.secondaryButton} href="/admin/activity"><Activity size={15} /> Журнал</Link>
          <Link className={styles.primaryButton} href="/admin/orders">Все заказы <ArrowUpRight size={15} /></Link>
        </div>
      </header>

      <section className={styles.metricGrid} aria-label="Основные показатели">
        {cards.map(({ label, value, icon: Icon }) => (
          <article className={styles.metricCard} key={label}>
            <div className={styles.metricIcon}><Icon /></div>
            <strong>{value}</strong><span>{label}</span>
          </article>
        ))}
      </section>

      <div className={styles.overviewGrid}>
        <section className={styles.panel}>
          <div className={styles.panelHeader}><strong>Последние заказы</strong><Link href="/admin/orders">Открыть все →</Link></div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>Заказ</th><th>Канал</th><th>Сумма</th><th>Платёж</th><th>Создан</th></tr></thead>
              <tbody>
                {recentOrders.map((order) => (
                  <tr key={order.id}>
                    <td><Link className={styles.orderLink} href={`/admin/orders/${order.id}`}>{order.code}</Link><span className={styles.tableSecondary}>{order.robloxUsername ?? "Ник не указан"}</span></td>
                    <td><span className={styles.tablePrimary}>{order.source}</span><span className={styles.tableSecondary}>{order.status}</span></td>
                    <td><span className={styles.tablePrimary}>{order.amountRobux.toLocaleString("ru-RU")} R$</span><span className={styles.tableSecondary}>{order.payment ? money(order.payment.amountKopecks) : "—"}</span></td>
                    <td><span className={styles.status}>{paymentLabel(order.payment?.status)}</span></td>
                    <td>{dateTime(order.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {recentOrders.length === 0 && <div className={styles.empty}>Заказов пока нет</div>}
        </section>

        <aside className={styles.panel}>
          <div className={styles.panelHeader}><strong>Требуют внимания</strong><span>{metrics.attention} критичных</span></div>
          <div className={styles.attentionList}>
            {attention.map((item) => (
              <div className={styles.attentionItem} key={item.label}>
                <div><i /><span><strong>{item.label}</strong><small>{item.hint}</small></span></div><b>{item.value}</b>
              </div>
            ))}
          </div>
          <div className={styles.panelHeader}><strong>Контур сегодня</strong><span>{metrics.completedToday} завершено</span></div>
          <div className={styles.attentionList}>
            <div className={styles.attentionItem}><div><ShoppingBag size={17} /><span><strong>Заказы с сайта</strong><small>канонический источник SITE</small></span></div><b>{metrics.siteOrders}</b></div>
            <div className={styles.attentionItem}><div><CircleAlert size={17} /><span><strong>Возвращено</strong><small>из подтверждённых платежей</small></span></div><b>{money(metrics.refundedKopecks)}</b></div>
          </div>
        </aside>
      </div>
    </div>
  );
}
