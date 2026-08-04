import { notFound } from "next/navigation";
import AdminAntonClient, { type AntonState } from "@/components/admin/anton-client";
import styles from "@/components/admin/admin-shell.module.css";
import { loadPartnerAdminInitialStateJson } from "@/app/api/twa/partners/[slug]/tasks/route";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminAntonPage() {
  const initialJson = await loadPartnerAdminInitialStateJson("anton");
  if (!initialJson) notFound();
  const initialState = JSON.parse(initialJson) as AntonState;
  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <span className={styles.eyebrow}>B2B · Google Sheets · единый ledger</span>
          <h1>Партнёр «Антон»</h1>
          <p>
            Задачи, синхронизация, баланс и честная экономика: Антон оплачивает грязный номинал
            C по курсу строки F, а чистый объём и закупка остаются аналитическими показателями.
          </p>
        </div>
      </header>
      <AdminAntonClient initialState={initialState} />
    </div>
  );
}
