"use client";

import { useEffect } from "react";
import Link from "next/link";
import styles from "./error-pages.module.css";

function hash(value: string) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(16).padStart(8, "0");
}

export default function ErrorPage({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  useEffect(() => {
    const source = error.digest || error.name || "RenderError";
    const body = JSON.stringify({
      type: "client-error",
      route: window.location.pathname,
      kind: "RenderError",
      fingerprint: hash(source),
    });
    navigator.sendBeacon?.("/api/observability/client", new Blob([body], { type: "application/json" }));
  }, [error]);

  return (
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby="error-title">
        <div className={styles.code} aria-hidden="true">!</div>
        <span className={styles.kicker}>Сейф временно не открылся</span>
        <h1 id="error-title" className={styles.title}>Что-то пошло не так</h1>
        <p className={styles.text}>Мы уже зафиксировали технический сигнал. Повторная попытка безопасна: платёж и заказ не создаются второй раз от обновления этого экрана.</p>
        <div className={styles.actions}>
          <button type="button" className={styles.primary} onClick={() => unstable_retry()}>Попробовать ещё раз</button>
          <Link href="/faq" className={styles.secondary}>Нужна помощь</Link>
        </div>
        {error.digest && <p className={styles.detail}>Код диагностики: {error.digest}</p>}
      </section>
    </main>
  );
}
