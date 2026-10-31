import RiskFeedClient from "@/components/admin/risks/risk-feed-client";
import styles from "@/components/admin/admin-shell.module.css";

export const dynamic = "force-dynamic";

export default function AdminRisksPage() {
  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <span className={styles.eyebrow}>Контроль · отзывы и возвраты</span>
          <h1>Риски</h1>
          <p>Плохие отзывы на WB, их исправления и заявки на возврат. «Открытые» — то, что ждёт решения человека; по закрытым заказам события разбираются сами.</p>
        </div>
      </header>
      <RiskFeedClient />
    </div>
  );
}
