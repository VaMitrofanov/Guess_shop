import Link from "next/link";
import {
  Activity,
  ArrowUpRight,
  CircleAlert,
  CircleDollarSign,
  Clock3,
  CreditCard,
  Layers3,
  PackageCheck,
  Repeat2,
  ShoppingBag,
  Users,
} from "lucide-react";
import { getAdminDashboardData, getAdminRuntimeState } from "@/lib/admin-ecosystem";
import { adminOrderStatusLabel, adminRobloxUsername } from "@/lib/admin-order-presentation";
import { ADMIN_TIME_ZONE } from "@/lib/admin-time";
import styles from "@/components/admin/admin-shell.module.css";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function money(kopecks: number) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(kopecks / 100);
}

function dateTime(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: ADMIN_TIME_ZONE,
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function ageLabel(seconds: number) {
  if (seconds < 60) return `${seconds} сек назад`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)} мин назад`;
  return `${Math.floor(seconds / 3_600)} ч назад`;
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

function orderStatusTone(status: string) {
  if (status === "COMPLETED") return styles.dashboardOrderStatusSuccess;
  if (["REJECTED", "ERROR"].includes(status)) return styles.dashboardOrderStatusDanger;
  return styles.dashboardOrderStatusPending;
}

const SOURCE_LABELS: Record<string, string> = {
  WB: "Wildberries",
  DIRECT: "Прямые",
  AVITO: "Авито",
  MANUAL: "Ручные",
  SITE: "Сайт",
};

export default async function AdminDashboard() {
  const [{ metrics, recentOrders, sourceBreakdown, heartbeats }, runtime] = await Promise.all([
    getAdminDashboardData(),
    Promise.resolve(getAdminRuntimeState()),
  ]);
  const maxSourceOrders = Math.max(1, ...sourceBreakdown.map((source) => source.orders));

  const primaryCards = [
    { label: "Чистый оборот", value: money(metrics.netKopecks), hint: `${metrics.paidPayments} оплаченных чеков`, icon: CircleDollarSign },
    { label: "Сейчас в работе", value: metrics.activeOrders.toLocaleString("ru-RU"), hint: "активные статусы", icon: Clock3 },
    { label: "К выкупу", value: metrics.buyoutOrders.toLocaleString("ru-RU"), hint: "единая рабочая очередь", icon: ShoppingBag },
    { label: "За 24 часа", value: metrics.created24h.toLocaleString("ru-RU"), hint: `${metrics.completed24h} завершено`, icon: ShoppingBag },
  ];

  const secondaryCards = [
    { label: "Средний оплаченный чек", value: money(metrics.averagePaidKopecks), hint: "до вычета возвратов", icon: CreditCard },
    { label: "Выполнено Robux", value: `${metrics.completedRobux.toLocaleString("ru-RU")} R$`, hint: `${metrics.completedOrders} заказов`, icon: PackageCheck },
    { label: "Профили", value: metrics.users.toLocaleString("ru-RU"), hint: `${metrics.users30d} новых за 30 дней`, icon: Users },
    { label: "Все заказы", value: metrics.totalOrders.toLocaleString("ru-RU"), hint: `${metrics.orders30d} создано за 30 дней`, icon: Layers3 },
    { label: "Покупатели", value: metrics.uniqueBuyers.toLocaleString("ru-RU"), hint: `${metrics.repeatBuyers} повторных`, icon: Repeat2 },
  ];
  // Desktop остаётся в исходном контракте 4 × 2: новый operational KPI
  // «К выкупу» нужен в mobile first screen, но не должен раздувать нормальную
  // desktop-сетку до третьего ряда с одной карточкой.
  const desktopCards = [
    primaryCards[0],
    secondaryCards[0],
    secondaryCards[1],
    secondaryCards[2],
    secondaryCards[3],
    primaryCards[1],
    secondaryCards[4],
    primaryCards[3],
  ];

  const attention = [
    { label: "Заказы с ошибкой", value: metrics.errorOrders, hint: "требуют решения менеджера" },
    { label: "Неясные возвраты", value: metrics.unknownRefunds, hint: "нужна сверка с банком" },
    { label: "Dead-letter", value: metrics.deadOutbox, hint: "уведомления не доставлены" },
    { label: "Платежи в процессе", value: metrics.openPayments, hint: "ещё не финализированы" },
  ];

  return (
    <div className={styles.page}>
      <header className={cn(styles.pageHeader, styles.dashboardDesktopHeader)}>
        <div>
          <span className={styles.eyebrow}>RobloxBank Control Center · production</span>
          <h1>Общий обзор</h1>
          <p>Деньги, заказы, аудитория и здоровье фоновых процессов — из боевой БД, без тестовых заказов.</p>
        </div>
        <div className={styles.headerActions}>
          <Link className={styles.secondaryButton} href="/admin/activity"><Activity size={15} /> Журнал</Link>
          <Link className={styles.primaryButton} href="/admin/orders">Все заказы <ArrowUpRight size={15} /></Link>
        </div>
      </header>

      <div className={cn(styles.dashboardMobileHeading, styles.mobileOnly)}>
        <span>Сегодня</span>
        <h1>Главное</h1>
      </div>

      <section className={cn(styles.metricGrid, styles.desktopOnly)} aria-label="Основные показатели">
        {desktopCards.map(({ label, value, hint, icon: Icon }) => (
          <article className={styles.metricCard} key={label}>
            <div className={styles.metricIcon}><Icon /></div>
            <strong>{value}</strong><span>{label}</span><small>{hint}</small>
          </article>
        ))}
      </section>

      <section className={cn(styles.metricGrid, styles.mobileOnly)} aria-label="Ключевые показатели">
        {primaryCards.map(({ label, value, hint, icon: Icon }) => (
          <article className={styles.metricCard} key={label}>
            <div className={styles.metricIcon}><Icon /></div>
            <strong>{value}</strong><span>{label}</span><small>{hint}</small>
          </article>
        ))}
      </section>
      <details className={cn(styles.mobileMetricsDetails, styles.mobileOnly)}>
        <summary>Все показатели <span>{secondaryCards.length}</span></summary>
        <div className={styles.metricGrid}>
          {secondaryCards.map(({ label, value, hint, icon: Icon }) => (
            <article className={styles.metricCard} key={label}>
              <div className={styles.metricIcon}><Icon /></div>
              <strong>{value}</strong><span>{label}</span><small>{hint}</small>
            </article>
          ))}
        </div>
      </details>

      <div className={styles.overviewGrid}>
        <section className={styles.panel}>
          <div className={styles.panelHeader}><strong>Последние заказы</strong><Link href="/admin/orders">Открыть все →</Link></div>
          <div className={cn(styles.tableWrap, styles.desktopOnly)}>
            <table className={styles.table}>
              <thead><tr><th>Заказ</th><th>Канал</th><th>Сумма</th><th>Платёж</th><th>Создан</th></tr></thead>
              <tbody>
                {recentOrders.map((order) => (
                  <tr key={order.id}>
                    <td data-label="Заказ"><Link className={styles.orderLink} href={`/admin/orders/${order.id}`}>{order.code}</Link><span className={styles.tableSecondary}>{order.robloxUsername ?? "Ник не указан"}</span></td>
                    <td data-label="Канал"><span className={styles.tablePrimary}>{order.source}</span><span className={styles.tableSecondary}>{order.status}</span></td>
                    <td data-label="Сумма"><span className={styles.tablePrimary}>{order.amountRobux.toLocaleString("ru-RU")} R$</span><span className={styles.tableSecondary}>{order.payment ? money(order.payment.amountKopecks) : "—"}</span></td>
                    <td data-label="Платёж"><span className={styles.status}>{paymentLabel(order.payment?.status)}</span></td>
                    <td data-label="Создан">{dateTime(order.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={cn(styles.dashboardOrderList, styles.mobileOnly)}>
            {recentOrders.map((order) => (
              <article className={styles.dashboardOrderCard} key={order.id}>
                <header className={styles.dashboardOrderHeader}>
                  <div>
                    <span>Заказ</span>
                    <Link className={styles.dashboardOrderCode} href={`/admin/orders/${order.id}`}>{order.code}</Link>
                  </div>
                  <span className={cn(styles.dashboardOrderStatus, orderStatusTone(order.status))}>
                    <i aria-hidden="true" />{adminOrderStatusLabel(order.status)}
                  </span>
                </header>
                <dl className={styles.dashboardOrderFacts}>
                  <div className={styles.dashboardOrderWide}>
                    <dt>Покупатель</dt>
                    <dd>{adminRobloxUsername(order.robloxUsername)}</dd>
                  </div>
                  <div>
                    <dt>Канал</dt>
                    <dd>{order.source}</dd>
                  </div>
                  <div>
                    <dt>Сумма</dt>
                    <dd className={styles.dashboardOrderMoney}>{order.amountRobux.toLocaleString("ru-RU")} R$</dd>
                  </div>
                  <div>
                    <dt>Платёж</dt>
                    <dd>{paymentLabel(order.payment?.status)}</dd>
                  </div>
                  <div>
                    <dt>Создан</dt>
                    <dd>{dateTime(order.createdAt)}</dd>
                  </div>
                </dl>
                <Link className={styles.dashboardOrderAction} href={`/admin/orders/${order.id}`}>
                  Открыть заказ <ArrowUpRight aria-hidden="true" />
                </Link>
              </article>
            ))}
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
          <div className={styles.panelHeader}><strong>Платежи за 30 дней</strong><span>{metrics.paidPayments30d} финальных</span></div>
          <div className={styles.attentionList}>
            <div className={styles.attentionItem}><div><CircleDollarSign size={17} /><span><strong>Списано</strong><small>подтверждённые попытки</small></span></div><b>{money(metrics.grossKopecks30d)}</b></div>
            <div className={styles.attentionItem}><div><CircleAlert size={17} /><span><strong>Возвращено</strong><small>подтверждено провайдером</small></span></div><b>{money(metrics.refundedKopecks30d)}</b></div>
            <div className={styles.attentionItem}><div><CreditCard size={17} /><span><strong>Нетто</strong><small>списано минус возвраты</small></span></div><b>{money(metrics.netKopecks30d)}</b></div>
          </div>
        </aside>
      </div>

      <div className={styles.insightGrid}>
        <section className={styles.panel}>
          <div className={styles.panelHeader}><strong>Источники заказов</strong><span>{metrics.totalOrders} production-заказов</span></div>
          <div className={styles.sourceList}>
            {sourceBreakdown.map((source) => (
              <div className={styles.sourceRow} key={source.source}>
                <div><strong>{SOURCE_LABELS[source.source] ?? source.source}</strong><span>{source.robux.toLocaleString("ru-RU")} R$</span></div>
                <div className={styles.sourceTrack}><i style={{ width: `${Math.max(2, Math.round((source.orders / maxSourceOrders) * 100))}%` }} /></div>
                <b>{source.orders}</b>
              </div>
            ))}
          </div>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeader}><strong>Операционный запас</strong><span>БД прямо сейчас</span></div>
          <div className={styles.resourceGrid}>
            <div><span>Доступные WB-коды</span><strong className={metrics.availableCodes > 100 ? styles.healthGood : styles.healthWarn}>{metrics.availableCodes}</strong></div>
            <div><span>Резерв активен</span><strong>{metrics.reservedCodes}</strong></div>
            <div><span>Резерв истёк</span><strong className={metrics.expiredReservedCodes === 0 ? styles.healthGood : styles.healthWarn}>{metrics.expiredReservedCodes}</strong></div>
            <div><span>Активная outbox</span><strong className={metrics.pendingOutbox === 0 ? styles.healthGood : styles.healthWarn}>{metrics.pendingOutbox}</strong></div>
            <div><span>Эквайринг</span><strong className={runtime.acquiring === "off" ? styles.healthWarn : styles.healthGood}>{runtime.acquiring}</strong></div>
          </div>
          <div className={styles.panelFooterLink}><Link href="/admin/activity">Конфигурация и полный журнал →</Link></div>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeader}><strong>Heartbeat процессов</strong><span>{heartbeats.length} сигналов</span></div>
          <div className={styles.heartbeatList}>
            {heartbeats.map((heartbeat) => {
              const healthy = heartbeat.status === "HEALTHY" && heartbeat.ageSeconds < 360;
              return (
                <div key={heartbeat.service}>
                  <i className={healthy ? styles.heartbeatGood : styles.heartbeatWarn} />
                  <span><strong>{heartbeat.service}</strong><small>{ageLabel(heartbeat.ageSeconds)}</small></span>
                  <b className={cn(healthy ? styles.healthGood : styles.healthWarn)}>{heartbeat.status}</b>
                </div>
              );
            })}
            {heartbeats.length === 0 && <div className={styles.empty}>Heartbeat ещё не записан.</div>}
          </div>
        </section>
      </div>
    </div>
  );
}
