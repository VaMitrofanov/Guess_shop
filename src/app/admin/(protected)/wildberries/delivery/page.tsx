import WbDeliveryClient from "@/components/admin/wb-delivery-client";
import styles from "@/components/admin/admin-shell.module.css";
import { loadWbDeliveryOverview } from "@/lib/wb-delivery-workflow";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function WbDeliveryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const pick = (key: string) => {
    const value = params[key];
    return (Array.isArray(value) ? value[0] : value) ?? "";
  };
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
      {/* Срез и заказ приходят ссылкой: «Обзор» зовёт сюда конкретную работу
          («7 кодов не открыты»), и приводить в общий список — терять контекст. */}
      <WbDeliveryClient
        initialData={initialData}
        initialFilter={pick("focus") === "notActivated" ? "not_activated" : undefined}
        initialOrderId={/^[a-z0-9_-]{1,80}$/i.test(pick("order")) ? pick("order") : undefined}
      />
    </div>
  );
}
