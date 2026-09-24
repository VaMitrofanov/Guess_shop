import styles from "@/components/admin/admin-shell.module.css";

export default function AdminLoading() {
  return (
    <div className={styles.page} aria-live="polite" aria-busy="true">
      <div className={styles.loadingState}>
        <span>Загружаем актуальные данные…</span>
        <div className={styles.loadingHero} />
        <div className={styles.loadingGrid}><i /><i /><i /><i /></div>
        <div className={styles.loadingPanel} />
      </div>
    </div>
  );
}
