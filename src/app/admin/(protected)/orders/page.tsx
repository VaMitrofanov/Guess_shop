import AdminOrdersClient from "@/components/admin/orders-client";
import { getAdminOrders } from "@/lib/admin-ecosystem";
import styles from "@/components/admin/admin-shell.module.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminOrdersPage() {
  const orders = await getAdminOrders();
  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <span className={styles.eyebrow}>Единая очередь · Web + TWA</span>
          <h1>Заказы</h1>
          <p>{orders.length} последних канонических заказов из SITE, WB, TG, VK, Avito и ручного контура.</p>
        </div>
      </header>
      <AdminOrdersClient initialOrders={orders} />
    </div>
  );
}
