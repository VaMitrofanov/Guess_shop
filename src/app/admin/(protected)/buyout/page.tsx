import AdminBuyoutClient from "@/components/admin/buyout-client";
import styles from "@/components/admin/admin-shell.module.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function AdminBuyoutPage() {
  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <span className={styles.eyebrow}>Рабочее место закупщика</span>
          <h1>Выкуп</h1>
          <p>
            Выгрузка ID геймпассов, ожидаемые цены прайс-гарда, состояние донора и история пачек.
            Очередь — та же, что во вкладке «К выкупу» в TWA: границы считает общий код.
          </p>
        </div>
      </header>
      <AdminBuyoutClient />
    </div>
  );
}
