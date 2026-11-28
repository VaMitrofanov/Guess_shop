import MergeQueueClient from "@/components/admin/merge/merge-queue-client";
import styles from "@/components/admin/admin-shell.module.css";

export const dynamic = "force-dynamic";

export default function AdminMergePage() {
  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <span className={styles.eyebrow}>Профили · один человек — один профиль</span>
          <h1>Склейка</h1>
          <p>Пары профилей, которые похожи на одного человека: Telegram в одном, ВКонтакте в другом. Сначала — с доказательством (человек сам нажал «это мой заказ»). Склейка переносит заказы, покупки кодов, бонусы и подключённые аккаунты; клиенту уходит одно сообщение.</p>
        </div>
      </header>
      <MergeQueueClient />
    </div>
  );
}
