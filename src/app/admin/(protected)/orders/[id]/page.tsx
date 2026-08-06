import Link from "next/link";
import { ArrowLeft, ExternalLink, Smartphone } from "lucide-react";
import { notFound } from "next/navigation";
import { getAdminOrderDetail } from "@/lib/admin-ecosystem";
import OutboxReplayButton from "@/components/admin/outbox-replay-button";
import styles from "@/components/admin/admin-shell.module.css";
import { ADMIN_TIME_ZONE } from "@/lib/admin-time";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function dateTime(value: Date | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ru-RU", { timeZone: ADMIN_TIME_ZONE, day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(value);
}

function money(value: number | null | undefined) {
  if (typeof value !== "number") return "—";
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 2 }).format(value / 100);
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className={styles.detailRow}><span>{label}</span><strong>{value ?? "—"}</strong></div>;
}

export default async function AdminOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[a-z0-9_-]{8,40}$/i.test(id)) notFound();
  const order = await getAdminOrderDetail(id);
  if (!order || order.isTest) notFound();

  const code = order.publicOrderId ?? order.wbCode;
  const payment = order.paymentAttempts[0];
  const clientLabel = order.user.username ? `@${order.user.username}` : order.user.name ?? "Клиент";

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <Link className={styles.eyebrow} href="/admin/orders"><ArrowLeft size={12} style={{ display: "inline", marginRight: 6 }} />Все заказы</Link>
          <h1>{code}</h1>
          <p>{order.orderSource} · {order.status} · создан {dateTime(order.createdAt)}</p>
        </div>
        <div className={styles.headerActions}>
          {order.gamepassUrl && <a className={styles.secondaryButton} href={order.gamepassUrl} target="_blank" rel="noreferrer">Roblox <ExternalLink size={14} /></a>}
          <Link className={styles.primaryButton} href={`/twa?q=${encodeURIComponent(order.wbCode)}`} target="_blank"><Smartphone size={15} /> Открыть в TWA</Link>
        </div>
      </header>

      <div className={styles.detailGrid}>
        <section className={`${styles.panel} ${styles.detailPanel}`}>
          <h2>Заказ</h2><div className={styles.detailRows}>
            <DetailRow label="Источник" value={`${order.orderSource} / ${order.platform}`} />
            <DetailRow label="Статус" value={order.status} />
            <DetailRow label="Номинал" value={`${order.amount.toLocaleString("ru-RU")} R$`} />
            <DetailRow label="Roblox" value={order.robloxUsername ?? order.probableNick ?? "Не подтверждён"} />
            <DetailRow label="Геймпасс" value={order.gamepassUrl ?? "Не привязан"} />
            <DetailRow label="В очереди с" value={dateTime(order.pendingAt)} />
            <DetailRow label="Выполнен" value={dateTime(order.completedAt)} />
          </div>
        </section>

        <section className={`${styles.panel} ${styles.detailPanel}`}>
          <h2>Клиент</h2><div className={styles.detailRows}>
            <DetailRow label="Профиль" value={clientLabel} />
            <DetailRow label="Email" value={order.user.email ?? "—"} />
            <DetailRow label="Telegram" value={order.user.tgId ?? "—"} />
            <DetailRow label="VK" value={order.user.vkId ?? "—"} />
            <DetailRow label="Бонусный баланс" value={`${order.user.balance.toLocaleString("ru-RU")} R$`} />
            <DetailRow label="Identity" value={order.user.identities.map((identity) => `${identity.provider}${identity.verifiedAt ? " ✓" : ""}`).join(", ") || "Нет"} />
            <DetailRow label="Email чека" value={order.receiptEmail ?? "—"} />
          </div>
        </section>

        <section className={`${styles.panel} ${styles.detailPanel}`}>
          <h2>Платёж</h2><div className={styles.detailRows}>
            <DetailRow label="Статус" value={payment?.status ?? "Нет попытки"} />
            <DetailRow label="Провайдер" value={payment?.provider ?? "—"} />
            <DetailRow label="Payment ID" value={payment?.paymentId ?? "—"} />
            <DetailRow label="Сумма" value={money(payment?.amountKopecks ?? order.paymentAmountKopecks)} />
            <DetailRow label="Возвращено" value={money(payment?.refundedAmountKopecks)} />
            <DetailRow label="Инициирован" value={dateTime(payment?.initiatedAt)} />
            <DetailRow label="Финализирован" value={dateTime(payment?.finalizedAt)} />
          </div>
        </section>

        <section className={`${styles.panel} ${styles.detailPanel}`}>
          <h2>Котировка и экономика</h2><div className={styles.detailRows}>
            <DetailRow label="Policy" value={order.priceQuote?.policyVersion ?? "Legacy"} />
            <DetailRow label="Цена" value={money(order.priceQuote?.finalAmountKopecks ?? order.saleAmountKopecks)} />
            <DetailRow label="Скидка" value={money(order.priceQuote?.discountKopecks)} />
            <DetailRow label="Бонус" value={order.priceQuote ? `${order.priceQuote.bonusRobux} R$` : "—"} />
            <DetailRow label="Себестоимость" value={money(order.purchaseCostKopecks)} />
            <DetailRow label="Прибыль" value={money(order.profitKopecks)} />
            <DetailRow label="Выкупил" value={order.purchaserUsername ?? "Не назначен"} />
          </div>
        </section>

        <section className={`${styles.panel} ${styles.detailPanel} ${styles.widePanel}`}>
          <h2>Возвраты</h2>
          {payment?.refunds.length ? <div className={styles.detailRows}>{payment.refunds.map((refund) => <DetailRow key={refund.id} label={`${dateTime(refund.createdAt)} · ${refund.status}`} value={`${money(refund.amountKopecks)}${refund.reason ? ` · ${refund.reason}` : ""}`} />)}</div> : <div className={styles.empty}>Возвратов нет</div>}
        </section>

        <section className={`${styles.panel} ${styles.detailPanel} ${styles.widePanel}`}>
          <h2>События и доставка</h2>
          {order.events.length ? <div className={styles.detailRows}>{order.events.map((event) => <DetailRow key={event.id} label={dateTime(event.createdAt)} value={<span>{`${event.type}${event.outbox ? ` · ${event.outbox.topic} / ${event.outbox.status} / попыток ${event.outbox.attempts}` : ""}`}{event.outbox?.status === "DEAD" && <span style={{ display: "block", marginTop: 8 }}><OutboxReplayButton outboxId={event.outbox.id} /></span>}</span>} />)}</div> : <div className={styles.empty}>Событий пока нет</div>}
        </section>

        {order.adminNote && <section className={`${styles.panel} ${styles.detailPanel} ${styles.widePanel}`}><h2>Заметка менеджера</h2><p style={{ color: "#b7b7bd", fontSize: 12, whiteSpace: "pre-wrap" }}>{order.adminNote}</p></section>}
      </div>
    </div>
  );
}
