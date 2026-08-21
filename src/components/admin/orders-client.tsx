import Link from "next/link";
import { Search } from "lucide-react";
import type { AdminOrdersFilter, AdminOrdersPage } from "@/lib/admin-ecosystem";
import { adminOrderStatusLabel } from "@/lib/admin-order-presentation";
import { ADMIN_TIME_ZONE } from "@/lib/admin-time";
import styles from "./admin-shell.module.css";
import { cn } from "@/lib/utils";

const FILTERS = ["ALL", "SITE", "WB", "WB_DBS", "DIRECT", "AVITO", "ERROR"] as const;

function dateTime(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { timeZone: ADMIN_TIME_ZONE, day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function money(kopecks: number) {
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 2 }).format(kopecks / 100);
}

function paymentLabel(status: string | undefined) {
  const labels: Record<string, string> = {
    CREATED: "Создан", INITIATED: "Открыт", AUTHORIZED: "Авторизован", CONFIRMED: "Оплачен",
    REJECTED: "Отклонён", CANCELED: "Отменён", FAILED: "Ошибка",
    PARTIALLY_REFUNDED: "Частичный возврат", REFUNDED: "Возвращён",
  };
  return status ? labels[status] ?? status : "Без платежа";
}

function paymentTone(status: string | undefined) {
  if (["CONFIRMED"].includes(status ?? "")) return styles.statusSuccess;
  if (["FAILED", "REJECTED", "CANCELED"].includes(status ?? "")) return styles.statusDanger;
  if (["PARTIALLY_REFUNDED", "REFUNDED", "CREATED", "INITIATED", "AUTHORIZED"].includes(status ?? "")) return styles.statusWarning;
  return "";
}

function ordersHref(filter: AdminOrdersFilter, query: string, cursor?: string | null) {
  const params = new URLSearchParams();
  if (filter !== "ALL") params.set("source", filter);
  if (query) params.set("q", query);
  if (cursor) params.set("cursor", cursor);
  const suffix = params.toString();
  return suffix ? `/admin/orders?${suffix}` : "/admin/orders";
}

export default function AdminOrdersClient({
  page,
  query,
  filter,
}: {
  page: AdminOrdersPage;
  query: string;
  filter: AdminOrdersFilter;
}) {
  const orders = page.orders;

  return (
    <>
      <div className={styles.filters}>
        <form className={styles.search} action="/admin/orders" method="get">
          <Search />
          <input aria-label="Поиск по коду, нику, клиенту или email" name="q" defaultValue={query} placeholder="Код, ник или клиент" />
          {filter !== "ALL" && <input type="hidden" name="source" value={filter} />}
        </form>
        {FILTERS.map((item) => <Link key={item} href={ordersHref(item, query)} className={cn(styles.filterButton, filter === item && styles.filterButtonActive)}>{item === "ALL" ? "Все" : item === "ERROR" ? "Внимание" : item}</Link>)}
      </div>
      <section className={styles.panel}>
        <div className={cn(styles.tableWrap, styles.responsiveTableWrap)}>
          <table className={cn(styles.table, styles.responsiveTable)}>
            <thead><tr><th>Заказ</th><th>Клиент</th><th>Источник</th><th>Сумма</th><th>Платёж</th><th>Обновлён</th></tr></thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id}>
                  <td data-label="Заказ"><Link className={styles.orderLink} href={`/admin/orders/${order.id}`}>{order.code}</Link><span className={styles.tableSecondary}>{order.robloxUsername ?? "Ник не указан"}</span></td>
                  <td data-label="Клиент"><span className={styles.tablePrimary}>{order.client.username ? `@${order.client.username}` : order.client.name ?? "Клиент"}</span><span className={styles.tableSecondary}>{order.client.email ?? "Без email"}</span></td>
                  <td data-label="Источник"><span className={styles.tablePrimary}>{order.source}</span><span className={styles.tableSecondary}>{order.platform} · {adminOrderStatusLabel(order.status)}</span></td>
                  <td data-label="Сумма"><span className={styles.tablePrimary}>{order.amountRobux.toLocaleString("ru-RU")} R$</span><span className={styles.tableSecondary}>{order.payment ? money(order.payment.amountKopecks) : "—"}</span></td>
                  <td data-label="Платёж"><span className={cn(styles.status, paymentTone(order.payment?.status))}>{paymentLabel(order.payment?.status)}</span>{order.payment?.refundedAmountKopecks ? <span className={styles.tableSecondary}>возврат {money(order.payment.refundedAmountKopecks)}</span> : null}</td>
                  <td data-label="Обновлён">{dateTime(order.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {orders.length === 0 && <div className={styles.empty}>По этому фильтру заказов нет</div>}
        <div className={styles.panelHeader}>
          <span>Показано {orders.length}{page.nextCursor ? " · есть ещё" : " · конец выборки"}</span>
          {page.nextCursor
            ? <Link href={ordersHref(filter, query, page.nextCursor)}>Следующие 50 →</Link>
            : <Link href="/twa" target="_blank">Открыть мобильную TWA →</Link>}
        </div>
      </section>
    </>
  );
}
