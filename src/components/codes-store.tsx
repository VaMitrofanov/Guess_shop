"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  CircleAlert,
  Copy,
  CreditCard,
  Gift,
  KeyRound,
  Link2,
  Loader2,
  Mail,
  RotateCcw,
  Send,
  Share2,
  Sparkles,
  UserPlus,
} from "lucide-react";
import { CODE_DENOMINATIONS, CODE_PRICES, quoteCode } from "@/lib/codes-pricing";
import styles from "./codes-store.module.css";

/**
 * 🎟 Покупка кода активации на главной (14.11.2026).
 *
 * Цены и наличие — с сервера (`/api/codes/catalog`), сумму в заказ пишет тоже
 * сервер; здесь только выбор и показ. Выбранный номинал живёт в адресе
 * (`?pack=`) и в sessionStorage — переживает вход/регистрацию, мессенджер и
 * банковское приложение. Последний созданный заказ — в localStorage, чтобы
 * вернувшийся из банка или мессенджера человек снова видел свою ссылку.
 */

type Pack = {
  denomination: number;
  baseAmountKopecks: number;
  finalAmountKopecks: number;
  signupAmountKopecks: number;
  available: boolean;
};

type Catalog = {
  salesOpen: boolean;
  packs: Pack[];
  viewer: {
    registered: boolean;
    hasEmail: boolean;
    discountPercent: number;
    invitedCount: number;
    next: { percent: number; invited: number; remaining: number } | null;
  };
};

type SavedOrder = {
  payPath: string;
  orderId: string;
  denomination: number;
  finalAmountKopecks: number;
  kind: "share" | "self";
  createdAt: number;
};

const PACK_KEY = "rb-code-pack";
const LAST_ORDER_KEY = "rb-code-last-order";
const DEFAULT_PACK = 800;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function rub(kopecks: number): string {
  const whole = kopecks % 100 === 0;
  return `${(kopecks / 100).toLocaleString("ru-RU", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })} ₽`;
}

function perRobux(pack: { finalAmountKopecks: number; denomination: number }): string {
  return `${(pack.finalAmountKopecks / 100 / pack.denomination).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`;
}

function robux(amount: number): string {
  return amount.toLocaleString("ru-RU");
}

function safeGet(storage: "local" | "session", key: string): string | null {
  try {
    return (storage === "local" ? window.localStorage : window.sessionStorage).getItem(key);
  } catch {
    return null;
  }
}

function safeSet(storage: "local" | "session", key: string, value: string | null) {
  try {
    const target = storage === "local" ? window.localStorage : window.sessionStorage;
    if (value === null) target.removeItem(key);
    else target.setItem(key, value);
  } catch {
    // Приватный режим: просто не запоминаем.
  }
}

function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16));
}

export default function CodesStore() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [selected, setSelected] = useState<number>(DEFAULT_PACK);
  const [path, setPath] = useState<"register" | "guest" | null>(null);
  const [email, setEmail] = useState("");
  const [receiptEmail, setReceiptEmail] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState<"self" | "share" | null>(null);
  const [error, setError] = useState("");
  const [shared, setShared] = useState<SavedOrder | null>(null);
  const [copied, setCopied] = useState(false);
  const [resume, setResume] = useState<SavedOrder | null>(null);
  const keyRef = useRef<string>("");
  const summaryRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    setLoadError(false);
    fetch("/api/codes/catalog", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((data: Catalog) => setCatalog(data))
      .catch(() => setLoadError(true));
  }, []);

  useEffect(() => {
    load();
    const params = new URLSearchParams(window.location.search);
    const fromUrl = Number(params.get("pack"));
    const fromSession = Number(safeGet("session", PACK_KEY));
    // Выбор из адреса (вернулись после входа) важнее запомненного.
    const initial = fromUrl || fromSession;
    if (initial) setSelected(initial);
    if (params.get("buy") === "guest") setPath("guest");
    const saved = safeGet("local", LAST_ORDER_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as SavedOrder;
        // Живёт сутки — столько же, сколько предложение.
        if (Date.now() - parsed.createdAt < 24 * 60 * 60 * 1000) setResume(parsed);
        else safeSet("local", LAST_ORDER_KEY, null);
      } catch {
        safeSet("local", LAST_ORDER_KEY, null);
      }
    }
  }, [load]);

  const packs = catalog?.packs ?? FALLBACK_PACKS;
  const pack = packs.find((item) => item.denomination === selected) ?? null;
  const viewer = catalog?.viewer;
  const registered = Boolean(viewer?.registered);
  const emailValid = EMAIL_RE.test(email.trim());
  const receiptValid = receiptEmail.trim() === "" ? Boolean(viewer?.hasEmail) : EMAIL_RE.test(receiptEmail.trim());

  // Номинал сохраняется в адресе и в сессии — его не теряют ни вход, ни переключение сценария.
  const choose = (denomination: number) => {
    setSelected(denomination);
    setError("");
    setShared(null);
    keyRef.current = "";
    safeSet("session", PACK_KEY, String(denomination));
    const url = new URL(window.location.href);
    url.searchParams.set("pack", String(denomination));
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash || "#codes"}`);
  };

  const returnPath = `/?pack=${selected}#codes`;
  const registerHref = `/register?next=${encodeURIComponent(returnPath)}`;
  const loginHref = `/login?next=${encodeURIComponent(returnPath)}`;

  const submit = async (mode: "self" | "share") => {
    if (!pack || busy) return;
    setError("");
    setBusy(mode);
    if (!keyRef.current) keyRef.current = newKey();
    try {
      const response = await fetch("/api/codes/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          denomination: pack.denomination,
          mode,
          ...(registered ? {} : { email: email.trim() }),
          ...(registered && receiptEmail.trim() ? { receiptEmail: receiptEmail.trim() } : {}),
          ...(mode === "self" ? { agreedToTerms: agreed } : {}),
          idempotencyKey: keyRef.current,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        // Ошибка банка/сети — заказ сохранён, повтор с тем же ключом его не задвоит.
        if (response.status < 500) keyRef.current = "";
        setError(data.error ?? "Не получилось. Попробуйте ещё раз.");
        if (data.code === "OUT_OF_STOCK") load();
        return;
      }
      const saved: SavedOrder = {
        payPath: data.payPath,
        orderId: data.orderId,
        denomination: pack.denomination,
        finalAmountKopecks: data.finalAmountKopecks,
        kind: mode,
        createdAt: Date.now(),
      };
      safeSet("local", LAST_ORDER_KEY, JSON.stringify(saved));
      keyRef.current = "";
      if (mode === "self" && data.paymentUrl) {
        window.location.assign(data.paymentUrl);
        return;
      }
      setShared(saved);
      setResume(null);
      setCopied(false);
    } catch {
      setError("Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.");
    } finally {
      setBusy(null);
    }
  };

  const fullLink = (saved: SavedOrder) => (typeof window === "undefined" ? saved.payPath : `${window.location.origin}${saved.payPath}`);

  const copyLink = async (saved: SavedOrder) => {
    const link = fullLink(saved);
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt("Скопируйте ссылку", link);
    }
  };

  const shareLink = async (saved: SavedOrder) => {
    const link = fullLink(saved);
    const text = `Оплати, пожалуйста, код Roblox на ${robux(saved.denomination)} Robux — ${rub(saved.finalAmountKopecks)}. Заказ уже собран, вход не нужен:`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "Оплата кода Roblox", text, url: link });
        return;
      } catch (shareError) {
        if ((shareError as Error)?.name === "AbortError") return;
      }
    }
    await copyLink(saved);
  };

  // Якорь «Выгоднее всего» — пакет с самой низкой ценой за 1 R$ среди тех, что
  // можно купить; цифра честная, считается из той же цены, что на карточке.
  const bestValue = useMemo(() => {
    const pool = packs.some((item) => item.available) ? packs.filter((item) => item.available) : packs;
    return pool.reduce((min, item) => (item.finalAmountKopecks / item.denomination < min.finalAmountKopecks / min.denomination ? item : min), pool[0])?.denomination ?? null;
  }, [packs]);

  const shareBlocked = !pack?.available || !catalog?.salesOpen;
  const guestReady = path === "guest" && emailValid;
  const discountPercent = viewer?.discountPercent ?? 0;

  const nextLine = useMemo(() => {
    if (!viewer?.registered) return null;
    if (!viewer.next) return `У вас максимальная скидка ${discountPercent}%.`;
    return `Ваша скидка ${discountPercent}%. До ${viewer.next.percent}% осталось пригласить ${viewer.next.remaining}.`;
  }, [viewer, discountPercent]);

  return (
    <article id="codes" className={styles.store} aria-labelledby="codes-title">
      <header className={styles.head}>
        <span className={styles.headIcon}><Gift size={23} /></span>
        <div>
          <h3 id="codes-title">Код активации Roblox</h3>
          <p>Оплатите — код придёт на почту или в кабинет. Ввести его можно на roblox.com/redeem.</p>
        </div>
      </header>

      {resume && !shared && (
        <div className={styles.resume} role="status">
          <span><RotateCcw size={16} /> Незавершённый заказ {resume.orderId}: {robux(resume.denomination)} R$ · {rub(resume.finalAmountKopecks)}</span>
          <span className={styles.resumeActions}>
            <a href={resume.payPath}>Открыть</a>
            <button type="button" onClick={() => { safeSet("local", LAST_ORDER_KEY, null); setResume(null); }}>Скрыть</button>
          </span>
        </div>
      )}

      <fieldset className={styles.packs} aria-describedby="codes-summary">
        <legend className={styles.srOnly}>Выберите номинал</legend>
        {packs.map((item) => {
          const active = item.denomination === selected;
          const discounted = registered && item.finalAmountKopecks < item.baseAmountKopecks;
          const best = item.denomination === bestValue;
          return (
            <label key={item.denomination} className={`${styles.pack} ${active ? styles.packActive : ""} ${best ? styles.packBest : ""} ${catalog && !item.available ? styles.packOut : ""}`}>
              <input
                type="radio"
                name="code-pack"
                value={item.denomination}
                checked={active}
                onChange={() => choose(item.denomination)}
                className={styles.srOnly}
              />
              {best && <span className={styles.packBadge}>Выгоднее всего</span>}
              <strong className={styles.packAmount}>
                <span className={styles.packNumber}>{robux(item.denomination)}</span>
                <span className={styles.packUnit}>Robux</span>
              </strong>
              <span className={styles.packPrice}>
                {discounted && <s>{rub(item.baseAmountKopecks)}</s>}
                <b>{rub(item.finalAmountKopecks)}</b>
              </span>
              {best && item.available && <small className={styles.packRate}>{perRobux(item)} за 1 R$</small>}
              {catalog && !item.available && <small className={styles.packOutNote}>нет в наличии</small>}
              {active && <i className={styles.packCheck} aria-hidden="true"><Check size={13} strokeWidth={3} /></i>}
            </label>
          );
        })}
      </fieldset>

      {loadError && (
        <p className={styles.error} role="alert">
          <CircleAlert size={16} /> <span>Не загрузили цены. <button type="button" onClick={load}>Повторить</button></span>
        </p>
      )}

      <div id="codes-summary" ref={summaryRef} className={styles.summary} aria-live="polite">
        {pack ? (
          <>
            <div className={styles.summaryRow}>
              <span>Код на <b>{robux(pack.denomination)} Robux</b></span>
              <strong>{rub(pack.finalAmountKopecks)}</strong>
            </div>
            {registered ? (
              discountPercent > 0 && (
                <p className={styles.summaryNote}>
                  <Sparkles size={15} /> <span>Ваша скидка {discountPercent}%: <s>{rub(pack.baseAmountKopecks)}</s> → {rub(pack.finalAmountKopecks)}</span>
                </p>
              )
            ) : (
              <p className={styles.summaryNote}>
                <UserPlus size={15} /> <span>С регистрацией — <b>{rub(pack.signupAmountKopecks)}</b> (−1% сразу). До −5% — за приглашённых друзей.</span>
              </p>
            )}
          </>
        ) : (
          <div className={styles.summaryRow}><span>Выберите номинал</span><strong>—</strong></div>
        )}
      </div>

      {catalog && !catalog.salesOpen && (
        <p className={styles.notice} role="status">
          <CircleAlert size={16} /> <span>Продажа кодов откроется совсем скоро. Сейчас Robux можно купить <a href="#calculator">через геймпасс</a>.</span>
        </p>
      )}

      {shared ? (
        <section className={styles.shareCard} aria-label="Ссылка на оплату">
          <div className={styles.shareTop}>
            <span className={styles.shareIcon}><Link2 size={18} /></span>
            <div>
              <strong>Ссылка на оплату готова</strong>
              <small>Заказ {shared.orderId} · {robux(shared.denomination)} R$ · {rub(shared.finalAmountKopecks)}</small>
            </div>
          </div>
          <p className={styles.shareText}>Отправьте её тому, кто оплатит. Он увидит магазин, номинал, сумму и куда придёт код. Вход в аккаунт ему не нужен. Ссылка действует 24 часа.</p>
          <code className={styles.shareLink}>{fullLink(shared)}</code>
          <div className={styles.actions}>
            <button type="button" className={styles.primary} onClick={() => shareLink(shared)}>
              <Share2 size={18} /> Отправить
            </button>
            <button type="button" className={styles.secondary} onClick={() => copyLink(shared)} aria-live="polite">
              {copied ? <><Check size={18} /> Скопировано</> : <><Copy size={18} /> Скопировать</>}
            </button>
          </div>
          <div className={styles.shareFoot}>
            <a href={shared.payPath}>Открыть страницу оплаты <ArrowRight size={15} /></a>
            <button type="button" onClick={() => setShared(null)}>Изменить заказ</button>
          </div>
        </section>
      ) : registered ? (
        <section className={styles.flow} aria-label="Оформление">
          <p className={styles.flowLead}>
            Код появится в <Link href="/dashboard#codes">личном кабинете</Link>{viewer?.hasEmail ? " и придёт письмом на почту аккаунта" : ""}.
          </p>
          {nextLine && <p className={styles.tierLine}>{nextLine} <Link href="/dashboard#referral">Пригласить</Link></p>}
          {!viewer?.hasEmail && (
            <label className={styles.field}>
              <span>Email для чека</span>
              <span className={styles.input}><Mail size={18} /><input type="email" inputMode="email" autoComplete="email" placeholder="you@example.com" value={receiptEmail} onChange={(event) => setReceiptEmail(event.target.value)} /></span>
            </label>
          )}
          <Consent agreed={agreed} onChange={setAgreed} />
          <div className={styles.actions}>
            <button type="button" className={styles.primary} disabled={shareBlocked || !agreed || !receiptValid || busy !== null} onClick={() => submit("self")}>
              {busy === "self" ? <Loader2 size={18} className={styles.spin} /> : <CreditCard size={18} />}
              Оплатить {pack ? rub(pack.finalAmountKopecks) : ""}
            </button>
            <button type="button" className={styles.secondary} disabled={shareBlocked || busy !== null} onClick={() => submit("share")}>
              {busy === "share" ? <Loader2 size={18} className={styles.spin} /> : <Send size={18} />}
              Отправить ссылку на оплату
            </button>
          </div>
        </section>
      ) : (
        <section className={styles.flow} aria-label="Как купить">
          <div className={styles.choices} role="group" aria-label="Способ покупки">
            <a href={registerHref} className={`${styles.choice} ${styles.choiceMain}`} onClick={() => safeSet("session", PACK_KEY, String(selected))}>
              <span className={styles.choiceIcon}><UserPlus size={20} /></span>
              <span>
                <strong>Зарегистрироваться и купить со скидкой</strong>
                <small>−1% сразу · до −5% за приглашения · код в кабинете</small>
              </span>
              <ArrowRight size={18} />
            </a>
            <button
              type="button"
              className={`${styles.choice} ${path === "guest" ? styles.choiceOpen : ""}`}
              aria-expanded={path === "guest"}
              aria-controls="codes-guest"
              onClick={() => setPath(path === "guest" ? null : "guest")}
            >
              <span className={styles.choiceIcon}><Mail size={20} /></span>
              <span>
                <strong>Купить без регистрации</strong>
                <small>Полная цена · код придёт на email</small>
              </span>
              <ArrowRight size={18} className={styles.choiceChevron} />
            </button>
          </div>
          <p className={styles.loginLine}>Уже есть аккаунт? <a href={loginHref}>Войти</a> — так же, как при покупке через геймпасс.</p>

          {path === "guest" && (
            <div id="codes-guest" className={styles.guest}>
              <label className={styles.field}>
                <span>Email для получения кода</span>
                <span className={`${styles.input} ${email && !emailValid ? styles.inputBad : ""}`}>
                  <Mail size={18} />
                  <input
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    aria-invalid={Boolean(email) && !emailValid}
                  />
                </span>
                {email && !emailValid && <small className={styles.fieldError}>Проверьте адрес — в нём ошибка.</small>}
              </label>
              {guestReady && (
                <>
                  <Consent agreed={agreed} onChange={setAgreed} />
                  <div className={styles.actions}>
                    <button type="button" className={styles.primary} disabled={shareBlocked || !agreed || busy !== null} onClick={() => submit("self")}>
                      {busy === "self" ? <Loader2 size={18} className={styles.spin} /> : <CreditCard size={18} />}
                      Оплатить самому
                    </button>
                    <button type="button" className={styles.secondary} disabled={shareBlocked || busy !== null} onClick={() => submit("share")}>
                      {busy === "share" ? <Loader2 size={18} className={styles.spin} /> : <Send size={18} />}
                      Отправить ссылку на оплату
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </section>
      )}

      {error && <p className={styles.error} role="alert"><CircleAlert size={16} /> {error}</p>}

      <a className={styles.wbLink} href="/guide?source=wb">
        <KeyRound size={16} />
        <span>Уже купили карточку на Wildberries? Её код вводится не здесь — <b>активировать карточку WB</b></span>
      </a>
    </article>
  );
}

function Consent({ agreed, onChange }: { agreed: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className={styles.consent}>
      <input type="checkbox" checked={agreed} onChange={(event) => onChange(event.target.checked)} />
      <span>Согласен с <Link href="/legal/offer" target="_blank">офертой</Link> и <Link href="/legal/policy" target="_blank">политикой конфиденциальности</Link>.</span>
    </label>
  );
}

/** До ответа сервера — гостевые цены из того же прайса, что у сервера. */
const FALLBACK_PACKS: Pack[] = CODE_DENOMINATIONS.map((denomination) => ({
  denomination,
  baseAmountKopecks: CODE_PRICES[denomination] * 100,
  finalAmountKopecks: CODE_PRICES[denomination] * 100,
  signupAmountKopecks: quoteCode(denomination, 1).finalAmountKopecks,
  available: true,
}));
