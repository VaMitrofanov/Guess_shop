import AdminOrdersClient from "@/components/admin/orders-client";
import { getAdminOrdersPage, type AdminOrdersFilter } from "@/lib/admin-ecosystem";
import styles from "@/components/admin/admin-shell.module.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const FILTERS = new Set<AdminOrdersFilter>(["ALL", "SITE", "WB", "WB_DBS", "DIRECT", "AVITO", "ERROR"]);

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; source?: string; cursor?: string }>;
}) {
  const params = await searchParams;
  const filter = FILTERS.has(params.source as AdminOrdersFilter)
    ? params.source as AdminOrdersFilter
    : "ALL";
  const query = params.q?.trim().slice(0, 120) ?? "";
  const page = await getAdminOrdersPage({ query, filter, cursor: params.cursor, limit: 50 });
  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <span className={styles.eyebrow}>Единая очередь · Web + TWA</span>
          <h1>Заказы</h1>
          <p>Канонические заказы SITE, WB, TG, VK, Avito и ручного контура — с поиском по всей базе.</p>
        </div>
      </header>
      <AdminOrdersClient page={page} query={query} filter={filter} />
    </div>
  );
}
