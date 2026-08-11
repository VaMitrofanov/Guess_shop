import WbDeliveryClient from "@/components/admin/wb-delivery-client";
import styles from "@/components/admin/admin-shell.module.css";
import { loadWbDeliveryOverview } from "@/lib/wb-delivery-workflow";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function WbDeliveryPage() {
  const initialData = await loadWbDeliveryOverview();
  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <span className={styles.eyebrow}>Wildberries · DBS · курьерская доставка</span>
          <h1>WB Доставка</h1>
          <p>Одна рабочая очередь для заказа, чата покупателя, кода получения, цифрового гейта и завершения выдачи.</p>
        </div>
      </header>
      <WbDeliveryClient initialData={initialData} />
    </div>
  );
}
