"use client";

import ScratchReveal from "@/components/account/scratch-reveal";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Check,
  CheckCircle2,
  Clock3,
  Copy,
  Gift,
  Heart,
  Link2,
  Loader2,
  RotateCcw,
  Send,
  Share2,
  Undo2,
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
  /** Код уже показывали в кабинете — дарить можно, но с предупреждением. */
  revealed?: boolean;
  /** Ссылка на открытку (подарок при покупке или «Подарить» из кабинета). */
  giftLink?: string | null;
  /** «Подарить» из кабинета (19.11.2026): кому и открыт ли подарок. */
  shared?: { to: string | null; opened: boolean } | null;
};

type GiftTheme = "BIRTHDAY" | "NEW_YEAR" | "JUST";
const GIFT_THEMES: { id: GiftTheme; label: string }[] = [
  { id: "BIRTHDAY", label: "День рождения" },
  { id: "NEW_YEAR", label: "Новый год" },
  { id: "JUST", label: "Просто так" },
];
const GIFT_MESSAGE_MAX = 140;
const LINKISH = /(https?:\/\/|www\.|t\.me|vk\.(com|cc|me)|@[a-z0-9_]{3,}|\b[a-z0-9-]+\.(ru|рф|com|net|org|me|io|gg)\b)/i;

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

function shareText(to: string | null): string {
  return `${to ? `${to}, тебе` : "Тебе"} подарок — открой открытку 🎁`;
}

/** Ссылка на открытку: поделиться, скопировать, «Вернуть себе». */
function GiftLinkPanel({ url, to, onRevoke, busy }: { url: string; to: string | null; onRevoke?: () => void; busy?: boolean }) {
  const [copied, setCopied] = useState(false);
  const text = shareText(to);
  const nativeShare = async () => {
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title: "Подарок", text, url });
        return;
      } catch (error) {
        if ((error as Error)?.name === "AbortError") return;
      }
    }
    if (await copy(url)) { setCopied(true); window.setTimeout(() => setCopied(false), 2200); }
  };
  return (
    <div className={styles.giftPanel}>
      <b className={styles.giftPanelTitle}><Gift size={16} /> Открытка готова{to ? ` · ${to}` : ""}</b>
      <code className={styles.refLink}>{url}</code>
      <div className={styles.shareRow}>
        <button type="button" className={styles.redeemButton} onClick={nativeShare}><Send size={15} /> Отправить</button>
        <button type="button" className={styles.ghost} onClick={async () => { if (await copy(url)) { setCopied(true); window.setTimeout(() => setCopied(false), 2200); } }}>
          {copied ? <><Check size={15} /> Скопировано</> : <><Copy size={15} /> Копировать</>}
        </button>
      </div>
      <div className={`${styles.shareRow} ${styles.shareRow3}`}>
        <a className={`${styles.messenger} ${styles.tg}`} href={`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer">Telegram</a>
        <a className={`${styles.messenger} ${styles.wa}`} href={`https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`} target="_blank" rel="noopener noreferrer">WhatsApp</a>
        <a className={`${styles.messenger} ${styles.vk}`} href={`https://vk.com/share.php?url=${encodeURIComponent(url)}`} target="_blank" rel="noopener noreferrer" aria-label="ВКонтакте">ВК</a>
      </div>
      {onRevoke && (
        <p className={styles.giftHint}>
          Передумали — можно вернуть код себе, пока подарок не открыт.{" "}
          <button type="button" className={styles.linkButton} onClick={onRevoke} disabled={busy}><Undo2 size={14} /> Вернуть себе</button>
        </p>
      )}
    </div>
  );
}

/** Форма «Подарить» у выданного кода. */
function GiftShareForm({ order, onDone, onCancel }: { order: DashboardCodeOrder; onDone: (url: string, to: string | null, emailed: boolean | null) => void; onCancel: () => void }) {
  const [theme, setTheme] = useState<GiftTheme>("BIRTHDAY");
  const [to, setTo] = useState("");
  const [from, setFrom] = useState("");
  const [message, setMessage] = useState("");
  const [method, setMethod] = useState<"link" | "email">("link");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const tooLong = message.trim().length > GIFT_MESSAGE_MAX;
  const hasLink = [to, from, message].some((value) => LINKISH.test(value));
  const emailOk = method === "link" || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
  const ready = !tooLong && !hasLink && emailOk && !busy;

  const submit = async () => {
    setBusy(true);
    setError("");
    const response = await fetch("/api/codes/gift/share", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orderId: order.publicId, theme, to, from, message, method, email: method === "email" ? email.trim() : undefined }),
    }).catch(() => null);
    const data = await response?.json().catch(() => ({}));
    setBusy(false);
    if (response?.ok && data?.url) onDone(String(data.url), to.trim() || null, typeof data.emailed === "boolean" ? data.emailed : null);
    else setError(data?.error ?? "Не получилось сделать открытку. Попробуйте ещё раз.");
  };

  return (
    <div className={styles.giftForm}>
      <div className={styles.giftFormHead}>
        <b>Подарить {order.denomination.toLocaleString("ru-RU")} R$</b>
        <button type="button" className={styles.linkButton} onClick={onCancel}>Отмена</button>
      </div>
      {order.revealed && (
        <p className={styles.giftWarn}>Код уже показывали. Дарите, только если не вводили его в Roblox — иначе у получателя он не сработает.</p>
      )}
      <div className={styles.themes} role="radiogroup" aria-label="Открытка">
        {GIFT_THEMES.map((item) => (
          <button
            key={item.id}
            type="button"
            role="radio"
            aria-checked={theme === item.id}
            className={`${styles.themeCard} ${styles[`theme${item.id}`]} ${theme === item.id ? styles.themeOn : ""}`}
            onClick={() => setTheme(item.id)}
          >{item.label}</button>
        ))}
      </div>
      <div className={styles.giftGrid}>
        <label className={styles.field}><span>Имя получателя</span><input type="text" maxLength={40} placeholder="Тёма" value={to} onChange={(event) => setTo(event.target.value)} /></label>
        <label className={styles.field}><span>От кого</span><input type="text" maxLength={40} placeholder="Тётя Катя" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
      </div>
      <label className={styles.field}>
        <span>Пожелание · {message.trim().length}/{GIFT_MESSAGE_MAX}</span>
        <textarea rows={3} maxLength={GIFT_MESSAGE_MAX + 20} placeholder="С днём рождения! Купи себе что-нибудь крутое" value={message} onChange={(event) => setMessage(event.target.value)} />
      </label>
      {hasLink && <p className={styles.fieldError}>Без ссылок и @ников — иначе открытку примут за мошенническую.</p>}
      {tooLong && <p className={styles.fieldError}>Не длиннее {GIFT_MESSAGE_MAX} символов.</p>}
      <fieldset className={styles.methods}>
        <legend>Как отправить</legend>
        <label className={method === "link" ? styles.methodOn : styles.method}>
          <input type="radio" name={`how-${order.publicId}`} checked={method === "link"} onChange={() => setMethod("link")} />
          <span><b>Ссылкой — отправлю сам</b><small>В Telegram, WhatsApp, ВК. Почта не нужна.</small></span>
        </label>
        <label className={method === "email" ? styles.methodOn : styles.method}>
          <input type="radio" name={`how-${order.publicId}`} checked={method === "email"} onChange={() => setMethod("email")} />
          <span><b>Письмом на почту</b><small>Открытка придёт получателю сразу.</small></span>
        </label>
      </fieldset>
      {method === "email" && (
        <label className={styles.field}><span>Почта получателя</span><input type="email" inputMode="email" autoComplete="off" placeholder="tyoma@example.ru" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      )}
      <button type="button" className={styles.giftSubmit} onClick={submit} disabled={!ready}>
        {busy ? <Loader2 size={17} className={styles.spin} /> : <Gift size={17} />} Сделать открытку
      </button>
      <p className={styles.giftHint}>Код спрячется из «Моих кодов» — его откроет получатель по ссылке. Пока подарок не открыт, код можно вернуть себе.</p>
      {error && <p className={styles.fieldError} role="alert">{error}</p>}
    </div>
  );
}

function CodeRow({ order }: { order: DashboardCodeOrder }) {
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState<"reveal" | "resend" | null>(null);
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [giftLink, setGiftLink] = useState<string | null>(order.giftLink ?? null);
  const [shared, setShared] = useState(order.shared ?? null);
  const [sharing, setSharing] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const status = STATUS[order.status];

  const revoke = async () => {
    setRevoking(true);
    setMessage("");
    const response = await fetch("/api/codes/gift/share", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orderId: order.publicId, action: "revoke" }) }).catch(() => null);
    const data = await response?.json().catch(() => ({}));
    setRevoking(false);
    if (response?.ok) { setShared(null); setGiftLink(null); setMessage("Код снова ваш — ссылка на открытку больше не работает."); }
    else setMessage(data?.error ?? "Не получилось вернуть код.");
  };
  const Icon = status.tone === "ok" ? CheckCircle2 : status.tone === "bad" ? XCircle : Clock3;

  /** 🎨 З5: код для скретч-слоя — запрашивается при первом касании. */
  const fetchCode = async (): Promise<string | null> => {
    setMessage("");
    const response = await fetch("/api/codes/reveal", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orderId: order.publicId }) }).catch(() => null);
    const data = await response?.json().catch(() => ({}));
    if (response?.ok && data?.code) return String(data.code);
    setMessage(data?.error ?? "Не получилось показать код.");
    return null;
  };

  const resend = async () => {
    setBusy("resend");
    setMessage("");
    const response = await fetch("/api/codes/resend", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orderId: order.publicId }) }).catch(() => null);
    const data = await response?.json().catch(() => ({}));
    setMessage(data?.message ?? data?.error ?? "Не получилось отправить письмо.");
    setBusy(null);
  };

  const flash = (kind: string) => {
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
            {shared ? ` · 🎁 подарен${shared.to ? ` · ${shared.to}` : ""}` : ""}
          </span>
        </div>
        <span className={`${styles.status} ${styles[status.tone]}`}><Icon size={15} /> {status.label}</span>
      </div>

      {order.status === "ISSUED" && shared && (
        shared.opened ? (
          <p className={styles.giftOpened}><Heart size={16} /> Подарок открыт{shared.to ? ` · ${shared.to}` : ""} — код у получателя.</p>
        ) : giftLink ? (
          <GiftLinkPanel url={giftLink} to={shared.to} onRevoke={revoke} busy={revoking} />
        ) : null
      )}

      {order.status === "ISSUED" && !shared && (
        <div className={styles.codeBox}>
          {code ? (
            <>
              {/* Набор (2 000 = 2 × 1 000, 20.11.2026): каждый код — своей строкой. */}
              {code.split("\n").map((one, index) => (
                <div key={one} className={styles.codeLine}>
                  <code aria-label={`Код активации ${index + 1}`}>{one}</code>
                  <button type="button" onClick={async () => { if (await copy(one)) flash(`code${index}`); }}>
                    {copied === `code${index}` ? <><Check size={16} /> Скопировано</> : <><Copy size={16} /> Копировать</>}
                  </button>
                </div>
              ))}
              <ol className={styles.steps}>
                <li>Откройте roblox.com/redeem и войдите в нужный аккаунт.</li>
                <li>{code.includes("\n") ? "Введите коды по очереди, после каждого — «Активировать»." : "Введите код и нажмите «Активировать» — Robux придут сразу."}</li>
              </ol>
            </>
          ) : (
            <ScratchReveal fetchCode={fetchCode} onRevealed={setCode} />
          )}
          <div className={styles.actions}>
            <a className={styles.redeem} href="https://www.roblox.com/redeem" target="_blank" rel="noopener noreferrer">Активировать на Roblox <ArrowUpRight size={15} /></a>
            {!order.gift && !sharing && (
              <button type="button" className={styles.giftButton} onClick={() => { setSharing(true); setMessage(""); }}>
                <Gift size={15} /> Подарить
              </button>
            )}
            {order.canEmail && (
              <button type="button" className={styles.ghost} onClick={resend} disabled={busy !== null}>
                {busy === "resend" ? <Loader2 size={15} className={styles.spin} /> : <RotateCcw size={15} />} {order.gift ? "Отправить открытку ещё раз" : order.emailSent ? "Отправить письмо ещё раз" : "Отправить на почту"}
              </button>
            )}
          </div>
          {sharing && (
            <GiftShareForm
              order={order}
              onCancel={() => setSharing(false)}
              onDone={(url, to, emailed) => {
                setSharing(false);
                setGiftLink(url);
                setShared({ to, opened: false });
                setCode(null);
                if (emailed === true) setMessage("Открытка отправлена на почту получателя. Ссылку можно переслать и сами.");
                if (emailed === false) setMessage("Письмо не ушло — отправьте ссылку сами.");
              }}
            />
          )}
          {order.gift && giftLink && <GiftLinkPanel url={giftLink} to={order.gift.to} />}
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
