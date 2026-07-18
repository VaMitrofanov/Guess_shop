"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import type { AdminOrderRow } from "@/lib/admin-ecosystem";
import styles from "./admin-shell.module.css";
import { cn } from "@/lib/utils";

const FILTERS = ["ALL", "SITE", "WB", "DIRECT", "AVITO", "ERROR"] as const;

function dateTime(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
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

export default function AdminOrdersClient({ initialOrders }: { initialOrders: AdminOrderRow[] }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("ALL");
  const normalized = query.trim().toLowerCase();

  const orders = useMemo(() => initialOrders.filter((order) => {
    const matchesFilter = filter === "ALL" || (filter === "ERROR" ? order.attention : order.source === filter);
    if (!matchesFilter) return false;
    if (!normalized) return true;
    return [order.code, order.publicOrderId, order.robloxUsername, order.client.name, order.client.username, order.client.email]
      .filter(Boolean).some((value) => String(value).toLowerCase().includes(normalized));
  }), [filter, initialOrders, normalized]);

  return (
    <>
      <div className={styles.filters}>
        <label className={styles.search}><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Код, ник, клиент или email" /></label>
        {FILTERS.map((item) => <button key={item} type="button" onClick={() => setFilter(item)} className={cn(styles.filterButton, filter === item && styles.filterButtonActive)}>{item === "ALL" ? "Все" : item === "ERROR" ? "Внимание" : item}</button>)}
      </div>
      <section className={styles.panel}>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>Заказ</th><th>Клиент</th><th>Источник</th><th>Сумма</th><th>Платёж</th><th>Обновлён</th></tr></thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id}>
                  <td><Link className={styles.orderLink} href={`/admin/orders/${order.id}`}>{order.code}</Link><span className={styles.tableSecondary}>{order.robloxUsername ?? "Ник не указан"}</span></td>
                  <td><span className={styles.tablePrimary}>{order.client.username ? `@${order.client.username}` : order.client.name ?? "Клиент"}</span><span className={styles.tableSecondary}>{order.client.email ?? "Без email"}</span></td>
                  <td><span className={styles.tablePrimary}>{order.source}</span><span className={styles.tableSecondary}>{order.platform} · {order.status}</span></td>
                  <td><span className={styles.tablePrimary}>{order.amountRobux.toLocaleString("ru-RU")} R$</span><span className={styles.tableSecondary}>{order.payment ? money(order.payment.amountKopecks) : "—"}</span></td>
                  <td><span className={cn(styles.status, paymentTone(order.payment?.status))}>{paymentLabel(order.payment?.status)}</span>{order.payment?.refundedAmountKopecks ? <span className={styles.tableSecondary}>возврат {money(order.payment.refundedAmountKopecks)}</span> : null}</td>
                  <td>{dateTime(order.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {orders.length === 0 && <div className={styles.empty}>По этому фильтру заказов нет</div>}
        <div className={styles.panelHeader}><span>Показано {orders.length} из {initialOrders.length}</span><Link href="/twa" target="_blank">Открыть мобильную TWA →</Link></div>
      </section>
    </>
  );
}
