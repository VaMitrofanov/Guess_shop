import type { Metadata } from "next";
import Link from "next/link";
import { CircleAlert } from "lucide-react";
import Navbar from "@/components/navbar";
import { findCodeOrderByToken, publicCodeOrderView } from "@/lib/codes/orders";
import { isPayTokenShape } from "@/lib/codes/secrets";
import PayClient from "./pay-client";
import styles from "./pay.module.css";

export const dynamic = "force-dynamic";

// Ссылка — доступ к оплате: не индексируем, Referer не отдаём (заголовки — next-security.ts).
export const metadata: Metadata = {
  title: "Оплата кода Roblox — RobloxBank",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

/**
 * 🎟 Страница готового заказа кода по ссылке (14.11.2026). Её открывает тот,
 * кто платит: родитель на своём телефоне. Видно магазин, номинал, итоговую
 * сумму, куда придёт код (адрес замаскирован) и безопасный статус. Самого
 * кода, имени создателя и полного адреса здесь нет — и не будет.
 */
export default async function PayPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ result?: string }>;
}) {
  const [{ token }, { result }] = await Promise.all([params, searchParams]);
  const order = isPayTokenShape(token) ? await findCodeOrderByToken(token) : null;
  if (!order) {
    return (
      <main className={styles.page}>
        <Navbar />
        <div className={styles.shell}>
          <section className={styles.card}>
            <span className={styles.stateIconBad}><CircleAlert size={26} /></span>
            <h1 className={styles.title}>Ссылка не найдена</h1>
            <p className={styles.muted}>Проверьте, что ссылка скопирована целиком, или попросите отправить её ещё раз.</p>
            <Link href="/#codes" className={styles.primary}>К покупке кодов</Link>
          </section>
        </div>
      </main>
    );
  }
  const view = await publicCodeOrderView(order);
  return (
    <main className={styles.page}>
      <Navbar />
      <div className={styles.shell}>
        <PayClient token={token} initial={view} result={result === "success" || result === "fail" ? result : null} />
      </div>
    </main>
  );
}
