"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Check,
  CheckCircle2,
  Clock3,
  Copy,
  Eye,
  Gift,
  Link2,
  Loader2,
  RotateCcw,
  Share2,
  Users,
  XCircle,
} from "lucide-react";
import styles from "./codes-dashboard.module.css";

export type DashboardCodeOrder = {
  publicId: string;
  denomination: number;
  finalAmountKopecks: number;
  discountPercent: number;
  status: "AWAITING_PAYMENT" | "PAYMENT_PENDING" | "PAID" | "ISSUED" | "REFUNDED";
  createdAt: string;
  expired: boolean;
  /** Только у неоплаченных: ссылку можно снова отправить родителю. */
  payPath: string | null;
  emailSent: boolean;
  canEmail: boolean;
  /** Подарок открыткой: письмо уходит получателю, код виден и создателю. */
  gift?: { to: string | null } | null;
};

const STATUS: Record<DashboardCodeOrder["status"], { label: string; tone: "wait" | "ok" | "bad" | "work" }> = {
  AWAITING_PAYMENT: { label: "Ждёт оплату", tone: "wait" },
  PAYMENT_PENDING: { label: "Оплата в процессе", tone: "work" },
  PAID: { label: "Оплачено · готовим код", tone: "work" },
  ISSUED: { label: "Код выдан", tone: "ok" },
  REFUNDED: { label: "Деньги возвращены", tone: "bad" },
};

function rub(kopecks: number): string {
  const whole = kopecks % 100 === 0;
  return `${(kopecks / 100).toLocaleString("ru-RU", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })} ₽`;
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    window.prompt("Скопируйте", text);
    return false;
  }
}

function CodeRow({ order }: { order: DashboardCodeOrder }) {
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState<"reveal" | "resend" | null>(null);
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const status = STATUS[order.status];
  const Icon = status.tone === "ok" ? CheckCircle2 : status.tone === "bad" ? XCircle : Clock3;

  const reveal = async () => {
    setBusy("reveal");
    setMessage("");
    const response = await fetch("/api/codes/reveal", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orderId: order.publicId }) }).catch(() => null);
    const data = await response?.json().catch(() => ({}));
    if (response?.ok && data?.code) setCode(data.code);
    else setMessage(data?.error ?? "Не получилось показать код.");
    setBusy(null);
  };

  const resend = async () => {
    setBusy("resend");
    setMessage("");
    const response = await fetch("/api/codes/resend", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orderId: order.publicId }) }).catch(() => null);
    const data = await response?.json().catch(() => ({}));
    setMessage(data?.message ?? data?.error ?? "Не получилось отправить письмо.");
    setBusy(null);
  };

  const flash = (kind: "code" | "link") => {
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 2200);
  };

  return (
    <article className={styles.row}>
      <div className={styles.top}>
        <div>
          <strong className={styles.amount}>{order.denomination.toLocaleString("ru-RU")} R$</strong>
          <span className={styles.meta}>
            {order.publicId} · {new Date(order.createdAt).toLocaleDateString("ru-RU", { day: "2-digit", month: "short" })} · {rub(order.finalAmountKopecks)}
            {order.discountPercent > 0 ? ` · скидка ${order.discountPercent}%` : ""}
            {order.gift ? ` · 🎁 подарок${order.gift.to ? ` для ${order.gift.to}` : ""}` : ""}
          </span>
        </div>
        <span className={`${styles.status} ${styles[status.tone]}`}><Icon size={15} /> {status.label}</span>
      </div>

      {order.status === "ISSUED" && (
        <div className={styles.codeBox}>
          {code ? (
            <>
              <div className={styles.codeLine}>
                <code aria-label="Код активации">{code}</code>
                <button type="button" onClick={async () => { if (await copy(code)) flash("code"); }}>
                  {copied === "code" ? <><Check size={16} /> Скопировано</> : <><Copy size={16} /> Копировать</>}
                </button>
              </div>
              <ol className={styles.steps}>
                <li>Откройте roblox.com/redeem и войдите в нужный аккаунт.</li>
                <li>Введите код и нажмите «Активировать» — Robux придут сразу.</li>
              </ol>
            </>
          ) : (
            <button type="button" className={styles.reveal} onClick={reveal} disabled={busy !== null}>
              {busy === "reveal" ? <Loader2 size={16} className={styles.spin} /> : <Eye size={16} />} Показать код
            </button>
          )}
          <div className={styles.actions}>
            <a className={styles.redeem} href="https://www.roblox.com/redeem" target="_blank" rel="noopener noreferrer">Активировать на Roblox <ArrowUpRight size={15} /></a>
            {order.canEmail && (
              <button type="button" className={styles.ghost} onClick={resend} disabled={busy !== null}>
                {busy === "resend" ? <Loader2 size={15} className={styles.spin} /> : <RotateCcw size={15} />} {order.gift ? "Отправить открытку ещё раз" : order.emailSent ? "Отправить письмо ещё раз" : "Отправить на почту"}
              </button>
            )}
          </div>
        </div>
      )}

      {order.payPath && (
        <div className={styles.actions}>
          <a className={styles.ghost} href={order.payPath}><Link2 size={15} /> {order.expired ? "Обновить и оплатить" : "Оплатить"}</a>
          <button type="button" className={styles.ghost} onClick={async () => { if (await copy(`${window.location.origin}${order.payPath}`)) flash("link"); }}>
            {copied === "link" ? <><Check size={15} /> Скопировано</> : <><Copy size={15} /> Ссылка для оплаты</>}
          </button>
        </div>
      )}
      {message && <p className={styles.message} role="status">{message}</p>}
    </article>
  );
}

export function CodesDashboard({ orders }: { orders: DashboardCodeOrder[] }) {
  return (
    <section id="codes" className={styles.card} aria-labelledby="dash-codes-title">
      <div className={styles.head}>
        <div><span className={styles.kicker}>Коды активации</span><h2 id="dash-codes-title">Мои коды</h2></div>
        <Gift size={23} aria-hidden="true" />
      </div>
      {orders.length === 0 ? (
        <div className={styles.empty}>
          <p>Здесь появятся купленные коды — с кнопкой копирования и ссылкой на активацию.</p>
          <Link className={styles.redeem} href="/#codes">Пополнить кодом <ArrowUpRight size={15} /></Link>
        </div>
      ) : (
        <div className={styles.list}>{orders.map((order) => <CodeRow key={order.publicId} order={order} />)}</div>
      )}
    </section>
  );
}

export type ReferralSummary = {
  link: string;
  invitedCount: number;
  percent: number;
  next: { percent: number; invited: number; remaining: number } | null;
  progress: number;
  remainingWord: string;
};

export function ReferralCard({ summary }: { summary: ReferralSummary }) {
  const [copied, setCopied] = useState(false);
  const share = async () => {
    const text = "Покупаю Robux кодами в RobloxBank — регистрируйся по ссылке:";
    if (navigator.share) {
      try {
        await navigator.share({ title: "RobloxBank", text, url: summary.link });
        return;
      } catch (error) {
        if ((error as Error)?.name === "AbortError") return;
      }
    }
    if (await copy(summary.link)) { setCopied(true); window.setTimeout(() => setCopied(false), 2200); }
  };
  return (
    <section id="referral" className={styles.referral} aria-labelledby="referral-title">
      <div className={styles.refHead}>
        <span className={styles.refIcon}><Users size={19} /></span>
        <div>
          <h2 id="referral-title">Скидка на коды: {summary.percent}%</h2>
          <p>
            {summary.next
              ? <>Ваша скидка {summary.percent}%. До {summary.next.percent}% осталось {summary.next.remaining} {summary.remainingWord}.</>
              : <>У вас максимальная скидка — {summary.percent}%.</>}
          </p>
        </div>
      </div>
      <div className={styles.meter} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(summary.progress * 100)} aria-label="Прогресс до следующего уровня">
        <i style={{ width: `${Math.round(summary.progress * 100)}%` }} />
      </div>
      <p className={styles.refCount}>Засчитано покупателей: <b>{summary.invitedCount}</b>{summary.next ? ` из ${summary.next.invited}` : ""}</p>
      <code className={styles.refLink}>{summary.link}</code>
      <div className={styles.actions}>
        <button type="button" className={styles.redeemButton} onClick={share}><Share2 size={15} /> Отправить</button>
        <button type="button" className={styles.ghost} onClick={async () => { if (await copy(summary.link)) { setCopied(true); window.setTimeout(() => setCopied(false), 2200); } }}>
          {copied ? <><Check size={15} /> Скопировано</> : <><Copy size={15} /> Копировать</>}
        </button>
      </div>
      <p className={styles.refRule}>Засчитывается друг, который зарегистрировался по ссылке и впервые оплатил и получил код. Уровни: 1% (регистрация + подписка на канал) → 2% (3) → 3% (10) → 4% (20) → 5% (30).</p>
    </section>
  );
}
