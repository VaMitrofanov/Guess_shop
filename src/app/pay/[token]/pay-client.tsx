"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  CircleAlert,
  Clock3,
  CreditCard,
  Gift,
  Loader2,
  Mail,
  ReceiptText,
  RotateCcw,
  UserRound,
} from "lucide-react";
import type { PublicCodeOrder } from "@/lib/codes/orders";
import AfterPayment from "./after-payment";
import ParentTrust, { PayExplainer } from "./parent-trust";
import type { TrustStats } from "@/lib/trust-stats";
import styles from "./pay.module.css";

export type PayViewerExtras = {
  isCreator: boolean;
  referralLink: string | null;
  discountPercent: number;
  invitedCount: number;
  next: { percent: number; invited: number; remaining: number } | null;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function rub(kopecks: number): string {
  const whole = kopecks % 100 === 0;
  return `${(kopecks / 100).toLocaleString("ru-RU", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })} ₽`;
}

function until(iso: string): string {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

export default function PayClient({ token, initial, extras, trust, result }: { token: string; initial: PublicCodeOrder; extras: PayViewerExtras; trust: TrustStats | null; result: "success" | "fail" | null }) {
  const [view, setView] = useState(initial);
  const [receiptEmail, setReceiptEmail] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState<"pay" | "refresh" | "resend" | null>(null);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [polls, setPolls] = useState(0);

  const unpaid = view.status === "AWAITING_PAYMENT" || view.status === "PAYMENT_PENDING";
  const waitingBank = unpaid && result === "success";
  // Ручная выдача (PAID) может занять время — опрашиваем реже, но дольше.
  const shouldPoll = waitingBank ? polls < 60 : view.status === "PAID" && polls < 300;

  const refreshView = useCallback(async () => {
    const response = await fetch("/api/codes/status", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
      cache: "no-store",
    }).catch(() => null);
    if (response?.ok) setView(await response.json());
  }, [token]);

  // Возврат из банка: ждём подтверждение от банка (webhook), а не верим адресу возврата.
  useEffect(() => {
    if (!shouldPoll) return;
    const delay = view.status === "PAID" ? (polls < 20 ? 6000 : 30_000) : polls < 10 ? 2500 : 6000;
    const timer = window.setTimeout(() => { setPolls((n) => n + 1); void refreshView(); }, delay);
    return () => window.clearTimeout(timer);
  }, [shouldPoll, polls, refreshView, view.status]);

  const post = async (url: string, body: Record<string, unknown>) => {
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { response, data: await response.json().catch(() => ({})) };
  };

  const pay = async () => {
    setBusy("pay");
    setError("");
    try {
      const { response, data } = await post("/api/codes/pay", {
        token,
        agreedToTerms: true,
        ...(receiptEmail.trim() ? { receiptEmail: receiptEmail.trim() } : {}),
      });
      if (response.ok && data.paymentUrl) {
        window.location.assign(data.paymentUrl);
        return;
      }
      setError(data.error ?? "Не получилось перейти к оплате. Попробуйте ещё раз.");
      if (data.code === "OFFER_EXPIRED" || data.code === "ALREADY_PAID") await refreshView();
    } catch {
      setError("Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.");
    } finally {
      setBusy(null);
    }
  };

  const confirmRefresh = async () => {
    setBusy("refresh");
    setError("");
    try {
      const { response, data } = await post("/api/codes/refresh", { token });
      if (response.ok) setView(data);
      else setError(data.error ?? "Не получилось обновить заказ.");
    } finally {
      setBusy(null);
    }
  };

  const resend = async () => {
    setBusy("resend");
    setError("");
    setInfo("");
    try {
      const { response, data } = await post("/api/codes/resend", { token });
      if (response.ok) setInfo(data.message);
      else setError(data.message ?? data.error ?? "Не получилось отправить письмо.");
    } finally {
      setBusy(null);
    }
  };

  const receiptValid = receiptEmail.trim() === "" ? !view.needsReceiptEmail : EMAIL_RE.test(receiptEmail.trim());
  const amount = view.expired && view.quoteIfRefreshed ? view.quoteIfRefreshed.finalAmountKopecks : view.finalAmountKopecks;

  if (view.status === "ISSUED" || view.status === "PAID") {
    return (
      <AfterPayment
        token={token}
        view={view}
        extras={extras}
        busy={busy === "resend"}
        info={info}
        error={error}
        onResend={resend}
      />
    );
  }

  return (
    <div className={styles.grid}>
      <div className={styles.mainCol}>
      {view.sharedLink && (
        <div className={styles.hello}>
          <span>Вам прислали ссылку на оплату</span>
          <p>Ваш ребёнок (или друг) собрал заказ в нашем магазине и попросил его оплатить. Проверьте сумму и нажмите «Оплатить» — входить ни в какие аккаунты не нужно.</p>
        </div>
      )}
      <section className={styles.card} aria-labelledby="pay-title">
        <p className={styles.shop}><Gift size={16} /> RobloxBank · заказ {view.publicId}</p>
        <h1 id="pay-title" className={styles.title}>Код Roblox на {view.denomination.toLocaleString("ru-RU")} Robux</h1>

        <dl className={styles.facts}>
          <div><dt>Номинал</dt><dd>{view.denomination.toLocaleString("ru-RU")} R$</dd></div>
          {view.discountPercent > 0 && (
            <div><dt>Скидка покупателя</dt><dd>−{view.discountPercent}% <s>{rub(view.baseAmountKopecks)}</s></dd></div>
          )}
          <div className={styles.total}><dt>К оплате</dt><dd>{rub(view.finalAmountKopecks)}</dd></div>
          <div>
            <dt>Куда придёт код</dt>
            <dd>{view.deliveryMode === "GIFT"
              ? <><Gift size={15} /> <span>подарком-открыткой на {view.maskedRecipient}</span></>
              : view.deliveryMode === "EMAIL"
              ? <><Mail size={15} /> <span>на почту {view.maskedRecipient}</span></>
              : view.channel !== "SITE"
              ? <><UserRound size={15} /> <span>в чат бота {view.channel === "TG" ? "Telegram" : "ВКонтакте"} и в кабинет</span></>
              : <><UserRound size={15} /> <span>в личный кабинет того, кто оформил заказ</span></>}</dd>
          </div>
        </dl>
        <p className={styles.locked}>🔒 Сумму, товар и получателя по этой ссылке изменить нельзя — их хранит магазин. Без комиссий и доплат.</p>

        {view.status === "REFUNDED" ? (
          <div className={styles.state}>
            <span className={styles.stateIconBad}><RotateCcw size={26} /></span>
            <h2>Деньги по заказу возвращены</h2>
            <p className={styles.muted}>Банк обычно зачисляет возврат за 1–5 рабочих дней.</p>
          </div>
        ) : waitingBank && shouldPoll ? (
          <div className={styles.state}>
            <span className={styles.stateIconWait}><Loader2 size={26} className={styles.spin} /></span>
            <h2>Ждём подтверждение банка</h2>
            <p className={styles.muted}>Обычно это несколько секунд. Страницу можно не обновлять.</p>
          </div>
        ) : view.expired ? (
          <div className={styles.state}>
            <span className={styles.stateIconWait}><Clock3 size={26} /></span>
            <h2>Срок предложения истёк</h2>
            <p className={styles.muted}>
              Цена фиксировалась на сутки. Актуальная сумма — <b>{rub(amount)}</b>
              {view.quoteIfRefreshed && view.quoteIfRefreshed.discountPercent > 0 ? ` (скидка покупателя ${view.quoteIfRefreshed.discountPercent}%)` : ""}.
              Подтвердите обновлённый заказ, чтобы оплатить.
            </p>
            <button type="button" className={styles.primary} onClick={confirmRefresh} disabled={busy !== null}>
              {busy === "refresh" ? <Loader2 size={17} className={styles.spin} /> : <RotateCcw size={17} />} Подтвердить за {rub(amount)}
            </button>
          </div>
        ) : (
          <div className={styles.payBox}>
            {(result === "fail" || view.paymentState === "failed" || (waitingBank && !shouldPoll)) && (
              <p className={styles.warn} role="status">
                <CircleAlert size={16} />
                {waitingBank && !shouldPoll
                  ? "Банк ещё не подтвердил оплату. Если деньги списались, код придёт сам — повторно не платите, а напишите в поддержку."
                  : "Платёж не завершён. Деньги не списаны — можно попробовать ещё раз."}
              </p>
            )}
            <label className={styles.field}>
              <span>Email для чека {view.needsReceiptEmail ? "" : <small>— необязательно</small>}</span>
              <span className={styles.input}>
                <ReceiptText size={18} />
                <input
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={receiptEmail}
                  onChange={(event) => setReceiptEmail(event.target.value)}
                />
              </span>
              <small className={styles.hint}>
                Только для чека{view.defaultReceiptMasked ? ` — если оставить пустым, чек уйдёт на ${view.defaultReceiptMasked}` : ""}. Код всё равно придёт туда, куда указано выше.
              </small>
            </label>
            <label className={styles.consent}>
              <input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} />
              <span>Согласен с <Link href="/legal/offer" target="_blank">офертой</Link> и <Link href="/legal/policy" target="_blank">политикой конфиденциальности</Link>.</span>
            </label>
            <button type="button" className={`${styles.primary} ${styles.payButton}`} onClick={pay} disabled={!agreed || !receiptValid || busy !== null}>
              {busy === "pay" ? <Loader2 size={18} className={styles.spin} /> : <CreditCard size={18} />} Оплатить {rub(view.finalAmountKopecks)}
            </button>
            <p className={styles.hint}>Предложение действует до {until(view.offerExpiresAt)}. Оплата — на защищённой странице Т-Банка.</p>
          </div>
        )}

        {error && <p className={styles.error} role="alert"><CircleAlert size={16} /> {error}</p>}
        {info && <p className={styles.ok} role="status"><CheckCircle2 size={16} /> {info}</p>}
      </section>

      <PayExplainer />
      </div>
      <ParentTrust trust={trust} denomination={view.denomination} />
    </div>
  );
}
