"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Headphones,
  Loader2,
  PackageCheck,
  ReceiptText,
  RotateCcw,
  ShieldCheck,
  ShoppingBag,
} from "lucide-react";
import Navbar from "@/components/navbar";
import styles from "./page.module.css";

type OrderSnapshot = {
  orderId: string;
  status: string;
  paymentStatus: string | null;
  amountRobux: number;
  amountKopecks: number | null;
  createdAt: string;
};

const FAILED_ORDER = new Set(["REJECTED", "ERROR"]);
const FAILED_PAYMENT = new Set(["REJECTED", "CANCELED", "FAILED"]);
const PAID_ORDER = new Set(["PENDING", "IN_PROGRESS", "COMPLETED"]);
const PAID_PAYMENT = new Set(["AUTHORIZED", "CONFIRMED", "PARTIALLY_REFUNDED", "REFUNDED"]);

function formatMoney(kopecks: number | null | undefined) {
  return typeof kopecks === "number"
    ? `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(kopecks / 100)} ₽`
    : "—";
}

function phaseFor(snapshot: OrderSnapshot | null) {
  if (!snapshot) return 0;
  if (snapshot.status === "COMPLETED") return 3;
  if (snapshot.status === "IN_PROGRESS") return 2;
  if (PAID_ORDER.has(snapshot.status) || PAID_PAYMENT.has(snapshot.paymentStatus ?? "")) return 1;
  return 0;
}

function StatusContent() {
  const params = useSearchParams();
  const orderId = params.get("orderId");
  const token = params.get("token");
  const [snapshot, setSnapshot] = useState<OrderSnapshot | null>(null);
  const [loading, setLoading] = useState(Boolean(orderId));
  const [loadError, setLoadError] = useState<"not-found" | "network" | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const load = useCallback(async () => {
    if (!orderId) return false;
    try {
      const query = token ? `?token=${encodeURIComponent(token)}` : "";
      const response = await fetch(`/api/orders/${encodeURIComponent(orderId)}${query}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(response.status === 404 ? "not-found" : "unavailable");
      setSnapshot(data as OrderSnapshot);
      setLoadError(null);
      return data.status === "COMPLETED" || FAILED_ORDER.has(data.status) || FAILED_PAYMENT.has(data.paymentStatus ?? "");
    } catch (error) {
      const notFound = error instanceof Error && error.message === "not-found";
      setLoadError(notFound ? "not-found" : "network");
      return notFound;
    } finally {
      setLoading(false);
    }
  }, [orderId, token]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      const terminal = await load();
      if (!cancelled && !terminal) timer = window.setTimeout(poll, 5_000);
    };
    void poll();
    return () => { cancelled = true; if (timer) window.clearTimeout(timer); };
  }, [load, refreshNonce]);

  const failed = !!snapshot && (FAILED_ORDER.has(snapshot.status) || FAILED_PAYMENT.has(snapshot.paymentStatus ?? ""));
  const phase = phaseFor(snapshot);
  const presentation = useMemo(() => {
    if (failed) return { kicker: "Нужен твой шаг", title: "Оплата не завершена", text: "Деньги не были подтверждены банком. Можно повторить оплату или написать поддержке.", tone: "danger" as const };
    if (phase === 3) return { kicker: "Заказ выполнен", title: "Robux отправлены", text: "Выкуп завершён. Зачисление через геймпасс ещё может отображаться в Roblox как Pending.", tone: "success" as const };
    if (phase === 2) return { kicker: "Заказ в работе", title: "Выкупаем геймпасс", text: "Оплата подтверждена, заказ уже у команды исполнения. Обновлять страницу вручную не нужно.", tone: "progress" as const };
    if (phase === 1) return { kicker: "Оплата подтверждена", title: "Заказ принят", text: "Мы поставили покупку в очередь на выкуп и покажем каждый следующий статус здесь и в кабинете.", tone: "success" as const };
    return { kicker: "Проверяем банк", title: "Ожидаем подтверждение", text: "Если платёжная форма ещё открыта — заверши оплату. Обычно статус обновляется в течение минуты.", tone: "waiting" as const };
  }, [failed, phase]);

  if (!orderId) {
    return <main className={styles.page}><Navbar /><section className={styles.missing}><CircleAlert /><h1>Ссылка на заказ неполная</h1><p>Открой заказ из личного кабинета или проверь ссылку из банка.</p><Link href="/dashboard">В личный кабинет</Link></section></main>;
  }

  const steps = [
    { title: "Оплата", text: phase > 0 ? "Подтверждена банком" : "Ожидаем подтверждение" },
    { title: "Очередь", text: phase > 1 ? "Заказ передан в работу" : "После успешной оплаты" },
    { title: "Выкуп", text: phase > 2 ? "Геймпасс выкуплен" : "Покупка геймпасса" },
    { title: "Готово", text: phase > 2 ? "Заказ завершён" : "Отслеживание в Roblox" },
  ];

  return (
    <main className={styles.page}>
      <Navbar />
      <div className={styles.shell}>
        <header className={`${styles.hero} ${styles[`tone_${presentation.tone}`]}`}>
          <div className={styles.heroIcon}>{loading && !snapshot ? <Loader2 className={styles.spin} /> : failed ? <CircleAlert /> : phase >= 1 ? <CheckCircle2 /> : <Clock3 />}</div>
          <div className={styles.heroCopy}>
            <span>{presentation.kicker}</span>
            <h1>{presentation.title}</h1>
            <p>{presentation.text}</p>
          </div>
          {snapshot && <dl className={styles.orderSummary}>
            <div><dt>Заказ</dt><dd>{snapshot.orderId}</dd></div>
            <div><dt>Получишь</dt><dd>{snapshot.amountRobux.toLocaleString("ru-RU")} R$</dd></div>
            <div><dt>Оплачено</dt><dd>{formatMoney(snapshot.amountKopecks)}</dd></div>
          </dl>}
        </header>

        {loadError && <div className={styles.networkNotice} role="alert"><CircleAlert size={19} /><span><strong>{loadError === "not-found" ? "Заказ недоступен по этой ссылке" : "Не удалось обновить статус"}</strong><small>{loadError === "not-found" ? "Войди в аккаунт владельца или открой полную секретную ссылку после оплаты." : "Проверь интернет. Последние загруженные данные остались на экране."}</small></span>{loadError === "network" && <button type="button" onClick={() => { setLoading(true); setRefreshNonce((value) => value + 1); }}><RotateCcw size={16} /> Повторить</button>}</div>}

        <div className={styles.contentGrid}>
          <section className={styles.timelineCard} aria-label="Этапы заказа">
            <div className={styles.sectionHeading}><span>Путь заказа</span><h2>Что происходит сейчас</h2></div>
            <ol className={styles.timeline}>
              {steps.map((step, index) => {
                const done = !failed && phase > index;
                const current = !failed && phase === index;
                return <li key={step.title} className={done ? styles.stepDone : current ? styles.stepCurrent : styles.stepFuture}>
                  <span>{done ? <Check size={17} /> : index + 1}</span><div><strong>{step.title}</strong><small>{step.text}</small></div>{current && <em>Сейчас</em>}
                </li>;
              })}
            </ol>
            {failed && <div className={styles.failedActions}><Link href="/checkout"><RotateCcw size={17} /> Повторить заказ</Link><a href="https://t.me/RobloxBank_PA" target="_blank" rel="noopener noreferrer"><Headphones size={17} /> Написать поддержке</a></div>}
          </section>

          <aside className={styles.sideColumn}>
            <section className={styles.trustCard}><ShieldCheck size={21} /><div><strong>Статус защищён</strong><p>Доступ есть только у владельца аккаунта или по секретной ссылке после оплаты.</p></div></section>
            <section className={styles.infoCard}><ReceiptText size={20} /><div><strong>Чек и история</strong><p>Платёжные данные и все заказы доступны в личном кабинете.</p><Link href="/dashboard">Открыть кабинет <ArrowRight size={15} /></Link></div></section>
            <section className={styles.infoCard}><PackageCheck size={20} /><div><strong>Pending — это нормально</strong><p>Roblox удерживает Robux после выкупа геймпасса до 5–7 дней.</p><a href="https://www.roblox.com/transactions" target="_blank" rel="noopener noreferrer">Транзакции Roblox <ArrowRight size={15} /></a></div></section>
          </aside>
        </div>

        <nav className={styles.bottomActions}><Link href="/dashboard"><ShoppingBag size={18} /> Все заказы</Link><Link href="/checkout">Новая покупка <ArrowRight size={17} /></Link></nav>
      </div>
    </main>
  );
}

export default function StatusPage() {
  return <Suspense fallback={<div className={styles.fullLoader}><Loader2 className={styles.spin} /></div>}><StatusContent /></Suspense>;
}
