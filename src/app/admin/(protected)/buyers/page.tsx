import BuyerDossierClient from "@/components/admin/risks/buyer-dossier-client";
import styles from "@/components/admin/admin-shell.module.css";

export const dynamic = "force-dynamic";

export default async function AdminBuyerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = params.name;
  const name = ((Array.isArray(raw) ? raw[0] : raw) ?? "").slice(0, 120);
  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <span className={styles.eyebrow}>Контроль · досье покупателя WB</span>
          <h1>{name || "Досье покупателя"}</h1>
          <p>Заказы, отзывы с правками и возвраты по имени покупателя на WB.</p>
        </div>
      </header>
      <BuyerDossierClient key={name} initialName={name} />
    </div>
  );
}
