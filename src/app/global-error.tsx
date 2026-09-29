"use client";

import styles from "./error-pages.module.css";

export default function GlobalError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return (
    <html lang="ru">
      <body>
        <main className={styles.page}>
          <section className={styles.card} aria-labelledby="global-error-title">
            <div className={styles.code} aria-hidden="true">!</div>
            <span className={styles.kicker}>Техническая пауза</span>
            <h1 id="global-error-title" className={styles.title}>Не удалось открыть страницу</h1>
            <p className={styles.text}>Обновите экран. Если ошибка повторится, напишите поддержке и укажите код диагностики ниже.</p>
            <div className={styles.actions}>
              <button type="button" className={styles.primary} onClick={() => unstable_retry()}>Повторить</button>
              <a href="https://t.me/RobloxBank_PA" className={styles.secondary}>Написать поддержке</a>
            </div>
            {error.digest && <p className={styles.detail}>Код диагностики: {error.digest}</p>}
          </section>
        </main>
      </body>
    </html>
  );
}
