"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  CalendarClock,
  Check,
  CircleAlert,
  Copy,
  CreditCard,
  Gift,
  KeyRound,
  Link2,
  Loader2,
  Mail,
  ReceiptText,
  RotateCcw,
  Send,
  Share2,
  Sparkles,
  UserPlus,
} from "lucide-react";
import { CODE_DENOMINATIONS, CODE_PRICES, quoteCode } from "@/lib/codes-pricing";
import GiftArt from "@/components/gift-art";
import styles from "./codes-store.module.css";

/**
 * 🎟 Покупка кода активации на главной (14.11.2026, витрина 2.0 — 15.11.2026).
 *
 * Цены, наличие, «ХИТ» и режим выдачи — с сервера (`/api/codes/catalog`),
 * сумму в заказ пишет тоже сервер; здесь только выбор и показ. Выбранный
 * номинал живёт в адресе (`?pack=`) и в sessionStorage — переживает вход,
 * мессенджер и банковское приложение. Последний созданный заказ — в
 * localStorage, чтобы вернувшийся человек снова видел свою ссылку.
 *
 * «Себе / В подарок»: подарок — та же оплата и тот же код, другая доставка
 * (письмо-открытка получателю, код открывается по кнопке).
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
  hit?: number;
  instant?: boolean;
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

type GiftTheme = "BIRTHDAY" | "NEW_YEAR" | "JUST";

const PACK_KEY = "rb-code-pack";
const LAST_ORDER_KEY = "rb-code-last-order";
const DEFAULT_PACK = 800;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const GIFT_MESSAGE_MAX = 140;
const LINK_RE = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(ru|рф|com|net|org|me|io|gg|su|xyz|site|online|shop|cc|ly|link|app|club|pro|info|biz|top)\b|t\.me|vk\.(com|cc|me)|@[a-z0-9_]{3,})/i;

const THEMES: { id: GiftTheme; label: string }[] = [
  { id: "BIRTHDAY", label: "День рождения" },
  { id: "NEW_YEAR", label: "Новый год" },
  { id: "JUST", label: "Просто так" },
];

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

function notPast(local: string): boolean {
  return local !== "" && new Date(local).getTime() > Date.now() - 60_000;
}

function nowMs(): number {
  return Date.now();
}

function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16));
}

/** Значение для `<input type="datetime-local">`: завтра в 9:00 по времени устройства. */
function tomorrowMorning(): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(9, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T09:00`;
}

function whenLabel(local: string): string {
  const date = new Date(local);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(date);
}

export default function CodesStore({ instant: instantProp = true }: { instant?: boolean }) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [selected, setSelected] = useState<number>(DEFAULT_PACK);
  const [mode, setMode] = useState<"self" | "gift">("self");
  const [path, setPath] = useState<"guest" | null>(null);
  const [email, setEmail] = useState("");
  const [receiptEmail, setReceiptEmail] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState<"self" | "share" | null>(null);
  const [error, setError] = useState("");
  const [shared, setShared] = useState<SavedOrder | null>(null);
  const [copied, setCopied] = useState(false);
  const [resume, setResume] = useState<SavedOrder | null>(null);
  const [theme, setTheme] = useState<GiftTheme>("BIRTHDAY");
  const [giftTo, setGiftTo] = useState("");
  const [giftEmail, setGiftEmail] = useState("");
  const [giftMessage, setGiftMessage] = useState("");
  const [giftFrom, setGiftFrom] = useState("");
  const [scheduled, setScheduled] = useState(false);
  const [sendAt, setSendAt] = useState("");
  const [barVisible, setBarVisible] = useState(false);
  const [typing, setTyping] = useState(false);
  const keyRef = useRef<string>("");
  const packsRef = useRef<HTMLFieldSetElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const storeRef = useRef<HTMLElement>(null);

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
    if (params.get("gift") === "1") setMode("gift");
    setSendAt(tomorrowMorning());
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
    // Ссылки «В подарок» снаружи (шапка, боты) ведут на #gift.
    const onHash = () => { if (window.location.hash === "#gift") setMode("gift"); };
    onHash();
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [load]);

  // Закреплённая панель на телефоне: видна, когда выбор номинала уехал вверх,
  // а кнопки покупки ещё не на экране. Прячется, пока открыта клавиатура.
  useEffect(() => {
    const packsEl = packsRef.current;
    const actionsEl = actionsRef.current;
    if (!packsEl || !actionsEl) return;
    // По прокрутке, а не IntersectionObserver: резкий прыжок (якорь, «наверх»)
    // перескакивает через пересечение, и панель не появлялась.
    let frame = 0;
    const update = () => {
      frame = 0;
      const packs = packsEl.getBoundingClientRect();
      const actions = actionsEl.getBoundingClientRect();
      const actionsVisible = actions.top < window.innerHeight && actions.bottom > 0;
      setBarVisible(packs.bottom < 0 && !actionsVisible);
    };
    const onScroll = () => { if (!frame) frame = window.requestAnimationFrame(update); };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) setTyping(true);
    };
    const onFocusOut = () => setTyping(false);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  const instant = catalog?.instant ?? instantProp;
  const packs = catalog?.packs ?? FALLBACK_PACKS;
  const pack = packs.find((item) => item.denomination === selected) ?? null;
  const viewer = catalog?.viewer;
  const registered = Boolean(viewer?.registered);
  const hit = catalog?.hit ?? DEFAULT_PACK;
  const emailValid = EMAIL_RE.test(email.trim());
  const receiptTrim = receiptEmail.trim();
  const receiptValid = receiptTrim === "" ? Boolean(viewer?.hasEmail) : EMAIL_RE.test(receiptTrim);

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

  const switchMode = (next: "self" | "gift") => {
    setMode(next);
    setError("");
    setShared(null);
    keyRef.current = "";
  };

  const returnPath = `/?pack=${selected}${mode === "gift" ? "&gift=1" : ""}#codes`;
  const registerHref = `/register?next=${encodeURIComponent(returnPath)}`;
  const loginHref = `/login?next=${encodeURIComponent(returnPath)}`;

  // ── Подарок: проверка на клиенте повторяет серверную (validateGift) ──────
  const giftEmailValid = EMAIL_RE.test(giftEmail.trim());
  const giftHasLink = [giftTo, giftFrom, giftMessage].some((value) => value && LINK_RE.test(value));
  const giftTooLong = giftMessage.trim().length > GIFT_MESSAGE_MAX;
  const sendAtValid = !scheduled || notPast(sendAt);
  const giftReceiptValid = registered ? receiptValid : EMAIL_RE.test(receiptTrim);
  const giftReady = giftEmailValid && !giftHasLink && !giftTooLong && sendAtValid && giftReceiptValid && agreed;

  const submit = async (kind: "self" | "share") => {
    if (!pack || busy) return;
    setError("");
    setBusy(kind);
    if (!keyRef.current) keyRef.current = newKey();
    const gift = mode === "gift"
      ? {
          theme,
          to: giftTo.trim() || undefined,
          from: giftFrom.trim() || undefined,
          message: giftMessage.trim() || undefined,
          email: giftEmail.trim(),
          sendAt: scheduled && sendAt ? new Date(sendAt).toISOString() : null,
        }
      : undefined;
    try {
      const response = await fetch("/api/codes/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          denomination: pack.denomination,
          mode: kind,
          ...(registered || gift ? {} : { email: email.trim() }),
          ...(receiptTrim ? { receiptEmail: receiptTrim } : {}),
          ...(kind === "self" ? { agreedToTerms: agreed } : {}),
          ...(gift ? { gift } : {}),
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
        kind,
        createdAt: nowMs(),
      };
      safeSet("local", LAST_ORDER_KEY, JSON.stringify(saved));
      keyRef.current = "";
      if (kind === "self" && data.paymentUrl) {
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

  // «Выгоднее всего» — пакет с самой низкой ценой за 1 R$ среди тех, что
  // можно купить; цифра честная, считается из той же цены, что на карточке.
  const bestValue = useMemo(() => {
    const pool = packs.some((item) => item.available) ? packs.filter((item) => item.available) : packs;
    return pool.reduce((min, item) => (item.finalAmountKopecks / item.denomination < min.finalAmountKopecks / min.denomination ? item : min), pool[0])?.denomination ?? null;
  }, [packs]);

  const blocked = !pack?.available || !catalog?.salesOpen;
  const discountPercent = viewer?.discountPercent ?? 0;
  const deliveryWord = instant ? "придёт сразу после оплаты" : "пришлём после оплаты";

  const nextLine = useMemo(() => {
    if (!viewer?.registered) return null;
    if (!viewer.next) return `У вас максимальная скидка ${discountPercent}%.`;
    return `Ваша скидка ${discountPercent}%. До ${viewer.next.percent}% осталось пригласить ${viewer.next.remaining}.`;
  }, [viewer, discountPercent]);

  const scrollToActions = () => actionsRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });

  return (
    <article id="codes" ref={storeRef} className={styles.store} aria-labelledby="codes-title">
      <span id="gift" className={styles.anchor} aria-hidden="true" />
      <header className={styles.head}>
        {/* 15.11.2026, владелец: «код» и «геймпасс» — названия товаров, а
            выглядели блекло. Заголовок — как ценник: иконка, крупное имя, метка. */}
        <div className={styles.titleRow}>
          <span className={styles.titleIcon} aria-hidden="true"><KeyRound size={24} strokeWidth={2.4} /></span>
          <div>
            <span className={styles.titleTag}>⚡ Сразу на баланс</span>
            <h3 id="codes-title">Код активации</h3>
            <p>Оплатил — получил — ввёл на roblox.com/redeem</p>
          </div>
        </div>
        <div className={styles.segment} role="group" aria-label="Для кого код">
          <button type="button" aria-pressed={mode === "self"} className={mode === "self" ? styles.segmentOn : undefined} onClick={() => switchMode("self")}>Себе</button>
          <button type="button" aria-pressed={mode === "gift"} className={mode === "gift" ? styles.segmentOn : undefined} onClick={() => switchMode("gift")}>
            <Gift size={15} /> В подарок
          </button>
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

      <fieldset ref={packsRef} className={styles.packs} aria-describedby="codes-summary">
        <legend className={styles.srOnly}>Выберите номинал</legend>
        {packs.map((item) => {
          const active = item.denomination === selected;
          const discounted = registered && item.finalAmountKopecks < item.baseAmountKopecks;
          const best = item.denomination === bestValue;
          const isHit = item.denomination === hit;
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
              {isHit ? <span className={styles.packHit}>ХИТ</span> : best ? <span className={styles.packBadge}>Выгоднее всего</span> : null}
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

      <div id="codes-summary" className={styles.summary} aria-live="polite">
        {pack ? (
          <>
            <div className={styles.summaryRow}>
              <span>{mode === "gift" ? "В подарок" : "Код на"} <b>{robux(pack.denomination)} Robux</b></span>
              <strong>{rub(pack.finalAmountKopecks)}</strong>
            </div>
            {registered ? (
              discountPercent > 0 && (
                <p className={styles.summaryNote}>
                  <Sparkles size={15} /> <span>Ваша скидка {discountPercent}%: <s>{rub(pack.baseAmountKopecks)}</s> → {rub(pack.finalAmountKopecks)}</span>
                </p>
              )
            ) : (
              <p className={styles.summaryGreen}>
                С регистрацией — {rub(pack.signupAmountKopecks)}, до {rub(quoteCode(pack.denomination, 5).finalAmountKopecks)} за друзей
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

      <div ref={actionsRef}>
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
        ) : mode === "gift" ? (
          <section className={styles.giftForm} aria-label="Подарок открыткой">
            <div className={styles.themes} role="radiogroup" aria-label="Открытка">
              {THEMES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={theme === item.id}
                  className={`${styles.themeCard} ${styles[`theme${item.id}`]} ${theme === item.id ? styles.themeOn : ""}`}
                  onClick={() => setTheme(item.id)}
                >
                  <GiftArt theme={item.id} className={styles.themeArt} />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
            <div className={styles.giftGrid}>
              <label className={styles.field}>
                <span>Кому</span>
                <span className={styles.input}><input type="text" maxLength={40} placeholder="Мише" value={giftTo} onChange={(event) => setGiftTo(event.target.value)} /></span>
              </label>
              <label className={styles.field}>
                <span>От кого</span>
                <span className={styles.input}><input type="text" maxLength={40} placeholder="Папа" value={giftFrom} onChange={(event) => setGiftFrom(event.target.value)} /></span>
              </label>
            </div>
            <label className={styles.field}>
              <span>Почта получателя</span>
              <span className={`${styles.input} ${giftEmail && !giftEmailValid ? styles.inputBad : ""}`}>
                <Mail size={18} />
                <input type="email" inputMode="email" autoComplete="off" placeholder="misha@example.ru" value={giftEmail} onChange={(event) => setGiftEmail(event.target.value)} aria-invalid={Boolean(giftEmail) && !giftEmailValid} />
              </span>
              {giftEmail && !giftEmailValid && <small className={styles.fieldError}>Проверьте адрес — в нём ошибка.</small>}
            </label>
            <label className={styles.field}>
              <span>Пожелание <small>· {giftMessage.trim().length}/{GIFT_MESSAGE_MAX}</small></span>
              <span className={`${styles.input} ${styles.textarea} ${giftTooLong || giftHasLink ? styles.inputBad : ""}`}>
                <textarea rows={3} maxLength={GIFT_MESSAGE_MAX + 20} placeholder="С днём рождения! Трать с умом" value={giftMessage} onChange={(event) => setGiftMessage(event.target.value)} />
              </span>
              {giftHasLink
                ? <small className={styles.fieldError}>Без ссылок и @ников — иначе письмо примут за мошенническое.</small>
                : giftTooLong ? <small className={styles.fieldError}>Не длиннее {GIFT_MESSAGE_MAX} символов.</small> : null}
            </label>
            <label className={styles.check}>
              <input type="checkbox" checked={scheduled} onChange={(event) => setScheduled(event.target.checked)} />
              <span><CalendarClock size={16} /> Отправить в день праздника{scheduled && sendAt ? <> — <b>{whenLabel(sendAt)}</b></> : null}</span>
            </label>
            {scheduled && (
              <label className={styles.field}>
                <span>Когда отправить открытку</span>
                <span className={`${styles.input} ${!sendAtValid ? styles.inputBad : ""}`}>
                  <input type="datetime-local" value={sendAt} onChange={(event) => setSendAt(event.target.value)} />
                </span>
              </label>
            )}
            {(!registered || !viewer?.hasEmail) && (
              <label className={styles.field}>
                <span>Ваша почта — для чека</span>
                <span className={`${styles.input} ${receiptTrim && !EMAIL_RE.test(receiptTrim) ? styles.inputBad : ""}`}>
                  <ReceiptText size={18} />
                  <input type="email" inputMode="email" autoComplete="email" placeholder="you@example.com" value={receiptEmail} onChange={(event) => setReceiptEmail(event.target.value)} />
                </span>
                <small className={styles.hint}>Получатель чек не увидит — сюрприз останется сюрпризом.</small>
              </label>
            )}
            <Consent agreed={agreed} onChange={setAgreed} />
            <button type="button" className={`${styles.primary} ${styles.giftButton}`} disabled={blocked || !giftReady || busy !== null} onClick={() => submit("self")}>
              {busy === "self" ? <Loader2 size={18} className={styles.spin} /> : <Gift size={18} />}
              Подарить {pack ? `${robux(pack.denomination)} Robux · ${rub(pack.finalAmountKopecks)}` : ""}
            </button>
            <p className={styles.quiet}>Код в письме не виден — получатель откроет подарок по кнопке. {instant ? "Письмо уйдёт сразу после оплаты" : "Открытку отправим, как только код будет готов"}{scheduled ? " или в выбранный день" : ""}.</p>
          </section>
        ) : registered ? (
          <section className={styles.flow} aria-label="Оформление">
            <p className={styles.flowLead}>
              Код {deliveryWord} — в <Link href="/dashboard#codes">личный кабинет</Link>{viewer?.hasEmail ? " и на почту аккаунта" : ""}.
            </p>
            {nextLine && <p className={styles.tierLine}>{nextLine} <Link href="/dashboard#referral">Пригласить</Link></p>}
            {!viewer?.hasEmail && (
              <label className={styles.field}>
                <span>Email для чека</span>
                <span className={styles.input}><Mail size={18} /><input type="email" inputMode="email" autoComplete="email" placeholder="you@example.com" value={receiptEmail} onChange={(event) => setReceiptEmail(event.target.value)} /></span>
              </label>
            )}
            <Consent agreed={agreed} onChange={setAgreed} />
            <button type="button" className={`${styles.primary} ${styles.wide}`} disabled={blocked || !agreed || !receiptValid || busy !== null} onClick={() => submit("self")}>
              {busy === "self" ? <Loader2 size={18} className={styles.spin} /> : <CreditCard size={18} />}
              Оплатить {pack ? rub(pack.finalAmountKopecks) : ""}
            </button>
            <button type="button" className={styles.parentLink} disabled={blocked || busy !== null} onClick={() => submit("share")}>
              {busy === "share" ? <Loader2 size={14} className={styles.spin} /> : null}
              Платит родитель? <span>Отправить ему заказ ссылкой</span>
            </button>
          </section>
        ) : (
          <section className={styles.flow} aria-label="Как купить">
            <div className={styles.choices}>
              <a href={registerHref} className={styles.choiceMain} onClick={() => safeSet("session", PACK_KEY, String(selected))}>
                <b><UserPlus size={18} /> Купить со скидкой −1%</b>
                <small>вход через Telegram, ВК или почту</small>
              </a>
              <button type="button" className={`${styles.choiceAlt} ${path === "guest" ? styles.choiceOpen : ""}`} aria-expanded={path === "guest"} aria-controls="codes-guest" onClick={() => setPath(path === "guest" ? null : "guest")}>
                <b>Без регистрации</b>
                <small>код придёт на почту</small>
              </button>
            </div>
            <p className={styles.loginLine}>Уже есть аккаунт? <a href={loginHref}>Войти</a></p>

            {path === "guest" && (
              <div id="codes-guest" className={styles.guest}>
                <label className={styles.field}>
                  <span>Email для получения кода</span>
                  <span className={`${styles.input} ${email && !emailValid ? styles.inputBad : ""}`}>
                    <Mail size={18} />
                    <input type="email" inputMode="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} aria-invalid={Boolean(email) && !emailValid} />
                  </span>
                  {email && !emailValid && <small className={styles.fieldError}>Проверьте адрес — в нём ошибка.</small>}
                </label>
                <Consent agreed={agreed} onChange={setAgreed} />
                <button type="button" className={`${styles.primary} ${styles.wide}`} disabled={blocked || !emailValid || !agreed || busy !== null} onClick={() => submit("self")}>
                  {busy === "self" ? <Loader2 size={18} className={styles.spin} /> : <CreditCard size={18} />}
                  Оплатить {pack ? rub(pack.finalAmountKopecks) : ""}
                </button>
                <button type="button" className={styles.parentLink} disabled={blocked || !emailValid || busy !== null} onClick={() => submit("share")}>
                  {busy === "share" ? <Loader2 size={14} className={styles.spin} /> : <Send size={14} />}
                  Платит родитель? <span>Отправить ему заказ ссылкой</span>
                </button>
              </div>
            )}
            {path !== "guest" && (
              <button type="button" className={styles.parentLink} onClick={() => setPath("guest")}>
                Платит родитель? <span>Отправить ему заказ ссылкой</span>
              </button>
            )}
          </section>
        )}
      </div>

      {error && <p className={styles.error} role="alert"><CircleAlert size={16} /> {error}</p>}

      <a className={styles.wbLink} href="/guide?source=wb">
        <KeyRound size={16} />
        <span>Купили карточку на Wildberries? Её код вводится не здесь — <b>активировать карточку WB</b></span>
      </a>

      {pack && (
        <div className={`${styles.stickyBar} ${barVisible && !typing ? styles.stickyOn : ""}`} aria-hidden={!barVisible || typing}>
          <span>
            <b>{robux(pack.denomination)} Robux</b>
            <small>{mode === "gift" ? "в подарок" : "код"} · {rub(pack.finalAmountKopecks)} · сразу на баланс</small>
          </span>
          <button type="button" tabIndex={barVisible && !typing ? 0 : -1} onClick={scrollToActions}>{mode === "gift" ? "Подарить" : "Купить"}</button>
        </div>
      )}
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
