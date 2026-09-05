import AdminEconomicsClient from "@/components/admin/economics-client";
import styles from "@/components/admin/admin-shell.module.css";
import { loadDirectEconomics } from "@/lib/direct-economics";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminEconomicsPage() {
  const initialData = await loadDirectEconomics();
  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <span className={styles.eyebrow}>Прямые заказы · сайт · Авито · ручные</span>
          <h1>Экономика</h1>
          <p>
            Сколько получили, сколько робуксов на это ушло и во что обошлись бонусы.
            Курс, ставку закупа и комиссию Roblox можно менять прямо здесь — всё пересчитается.
          </p>
        </div>
      </header>
      <AdminEconomicsClient initialData={initialData} />
    </div>
  );
}
