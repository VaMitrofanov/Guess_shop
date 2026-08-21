import type { Metadata } from "next";
import Link from "next/link";
import styles from "./error-pages.module.css";

export const metadata: Metadata = {
  title: "Страница не найдена — RobloxBank",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby="not-found-title">
        <div className={styles.code} aria-hidden="true">404</div>
        <span className={styles.kicker}>Такой ячейки нет</span>
        <h1 id="not-found-title" className={styles.title}>Страница не найдена</h1>
        <p className={styles.text}>Ссылка могла устареть или в адресе есть опечатка. Заказ и данные аккаунта от этого не меняются.</p>
        <div className={styles.actions}>
          <Link href="/" className={styles.primary}>На главную</Link>
          <Link href="/faq" className={styles.secondary}>Открыть помощь</Link>
        </div>
      </section>
    </main>
  );
}
