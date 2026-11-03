"use client";

import { useEffect } from "react";
import styles from "@/components/admin/admin-shell.module.css";

export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("admin-route-error", { digest: error.digest, name: error.name });
  }, [error]);

  return (
    <div className={styles.page}>
      <section className={styles.panel}>
        <div className={styles.empty}>
          Не удалось загрузить раздел. Данные не изменены.
          <button type="button" className={styles.primaryButton} onClick={reset}>Повторить</button>
        </div>
      </section>
    </div>
  );
}
