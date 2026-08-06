import Link from "next/link";
import {
  Activity,
  BellRing,
  CircleDollarSign,
  GitMerge,
  RefreshCcw,
  ShoppingBag,
} from "lucide-react";
import { getAdminActivityPage, getAdminRuntimeState } from "@/lib/admin-ecosystem";
import styles from "@/components/admin/admin-shell.module.css";
import { cn } from "@/lib/utils";
import { ADMIN_TIME_ZONE } from "@/lib/admin-time";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function dateTime(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { timeZone: ADMIN_TIME_ZONE, day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value));
}

const ICONS = {
  order: ShoppingBag,
  payment: CircleDollarSign,
  notification: BellRing,
  refund: RefreshCcw,
  identity: GitMerge,
};

export default async function AdminActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>;
}) {
  const params = await searchParams;
  const [page, runtime] = await Promise.all([
    getAdminActivityPage({ cursor: params.cursor, limit: 80 }),
    Promise.resolve(getAdminRuntimeState()),
  ]);
  const activity = page.items;
  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <span className={styles.eyebrow}>Immutable events · без сырых payload</span>
          <h1>Журнал</h1>
          <p>Единый операционный след desktop-панели и TWA: платежи, уведомления, возвраты, заказы и identity.</p>
        </div>
        <div className={styles.headerActions}><Link className={styles.secondaryButton} href="/admin/activity"><Activity size={15} /> Обновить</Link></div>
      </header>

      <section className={styles.panel}>
        <div className={styles.panelHeader}><strong>Состояние контура</strong><span>Только наличие конфигурации — значения секретов не раскрываются</span></div>
        <div className={styles.healthGrid}>
          <div className={styles.healthItem}><span>Эквайринг</span><strong className={runtime.acquiring === "off" ? styles.healthWarn : styles.healthGood}>{runtime.acquiring}</strong></div>
          <div className={styles.healthItem}><span>Terminal</span><strong className={runtime.terminalConfigured ? styles.healthGood : styles.healthWarn}>{runtime.terminalConfigured ? "Настроен" : "Не настроен"}</strong></div>
          <div className={styles.healthItem}><span>ККТ-поля</span><strong className={runtime.fiscalConfigured ? styles.healthGood : styles.healthWarn}>{runtime.fiscalConfigured ? "Полный набор" : "Неполный набор"}</strong></div>
          <div className={styles.healthItem}><span>Email</span><strong className={runtime.emailConfigured ? styles.healthGood : styles.healthWarn}>{runtime.emailConfigured ? "SMTP готов" : "Fail-closed"}</strong></div>
        </div>
      </section>

      <section className={styles.panel} style={{ marginTop: 15 }}>
        <div className={styles.panelHeader}><strong>Последние события</strong><span>{activity.length} записей</span></div>
        <div className={styles.logList}>
          {activity.map((item) => {
            const Icon = ICONS[item.kind];
            return (
              <article className={styles.logItem} key={item.id}>
                <div className={cn(styles.logIcon, item.tone === "success" && styles.logIconSuccess, item.tone === "warning" && styles.logIconWarning, item.tone === "danger" && styles.logIconDanger)}><Icon /></div>
                <div className={styles.logCopy}><strong>{item.title}</strong><span>{item.detail}{item.orderCode ? ` · ${item.orderCode}` : ""}</span></div>
                <div className={styles.logMeta}><time>{dateTime(item.createdAt)}</time>{item.orderId && <Link href={`/admin/orders/${item.orderId}`}>Открыть заказ</Link>}</div>
              </article>
            );
          })}
          {activity.length === 0 && <div className={styles.empty}>Событий пока нет. Они появятся после первого канонического SITE-платежа или операции identity.</div>}
        </div>
        {page.nextCursor && (
          <div className={styles.panelHeader}>
            <span>Показано {activity.length} · есть более ранние</span>
            <Link href={`/admin/activity?cursor=${encodeURIComponent(page.nextCursor)}`}>Следующие 80 →</Link>
          </div>
        )}
      </section>
    </div>
  );
}
