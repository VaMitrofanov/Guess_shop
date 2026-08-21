import { prisma } from "@/lib/prisma";
import FAQList from "@/components/admin/faq-list";
import AddFAQModal from "@/components/admin/add-faq-modal";
import styles from "@/components/admin/admin-shell.module.css";

export const dynamic = "force-dynamic";

export default async function AdminFAQPage() {
  const faqs = await prisma.fAQ.findMany({ orderBy: { order: "asc" } });

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <span className={styles.eyebrow}>Контент · помощь клиентам</span>
          <h1>FAQ</h1>
          <p>{faqs.length} вопросов на витрине</p>
        </div>
        <AddFAQModal />
      </header>
      <FAQList initialFaqs={JSON.parse(JSON.stringify(faqs))} />
    </div>
  );
}
