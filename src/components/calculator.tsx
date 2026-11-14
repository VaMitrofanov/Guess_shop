"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Gamepad2, Loader2, LockKeyhole, WalletCards } from "lucide-react";
import { usePricing } from "@/hooks/usePricing";
import CorridorNotice from "@/components/corridor-notice";
import { gamepassPriceMatches } from "@/lib/gamepass-search-view";
import { CODE_PRICES } from "@/lib/codes-pricing";
import styles from "@/app/storefront.module.css";

const PACKS = [500, 1000, 2000, 5000];
/** «ХИТ» у геймпасса — 1 000 (решение владельца 14.11.2026; у кодов — 800). */
const HIT_PACK = 1000;
const grossPassPrice = (amount: number) => Math.ceil(amount / 0.7);
const formatCustomerRate = (rate: number) => rate.toLocaleString("ru-RU", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 3,
});

type LookupState = {
  status: "idle" | "loading" | "ready" | "wrong-price" | "no-passes" | "not-found" | "error";
  key?: string;
  account?: { username: string; displayName: string; avatarUrl?: string | null };
  passes?: Array<{ id: string | number; price: number }>;
};

export default function Calculator() {
  const [robux, setRobux] = useState("1000");
  const [username, setUsername] = useState("");
  const [lookup, setLookup] = useState<LookupState>({ status: "idle" });
  const { loading, getPrice, getBreakdown } = usePricing();
  const amount = Math.max(0, Number(robux) || 0);
  const price = getPrice(amount);
  const breakdown = getBreakdown(amount);
  const normalizedUsername = username.trim();
  const validUsername = /^[A-Za-z0-9_]{3,20}$/.test(normalizedUsername);
  const lookupKey = `${normalizedUsername.toLowerCase()}:${amount}`;
  const currentLookup: LookupState = lookup.key === lookupKey
    ? lookup
    : { status: validUsername ? "loading" : "idle", key: lookupKey };

  useEffect(() => {
    fetch("/api/account/me")
      .then((response) => (response.ok ? response.json() : null))
      .then((account) => {
        if (account?.robloxUsername) setUsername(account.robloxUsername);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!validUsername || amount < 100 || amount > 100_000) {
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLookup({ status: "loading", key: lookupKey });
      try {
        const response = await fetch(`/api/roblox/gamepasses?query=${encodeURIComponent(normalizedUsername)}`, { signal: controller.signal });
        const data = await response.json();
        if (!response.ok || !data.success) {
          setLookup({ status: "error", key: lookupKey });
          return;
        }
        if (data.userExists === false) {
          setLookup({ status: "not-found", key: lookupKey });
          return;
        }
        const passes = (data.gamepasses ?? []) as Array<{ id: string | number; price: number }>;
        const account = data.account ?? { username: normalizedUsername, displayName: normalizedUsername };
        if (passes.length === 0) {
          setLookup({ status: "no-passes", key: lookupKey, account, passes });
          return;
        }
        const expected = grossPassPrice(amount);
        setLookup({
          status: passes.some((pass) => gamepassPriceMatches(Number(pass.price), expected)) ? "ready" : "wrong-price",
          key: lookupKey,
          account,
          passes,
        });
      } catch (error) {
        if ((error as Error).name !== "AbortError") setLookup({ status: "error", key: lookupKey });
      }
    }, 550);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [amount, lookupKey, normalizedUsername, validUsername]);

  const matchingPasses = currentLookup.passes?.filter((pass) => gamepassPriceMatches(Number(pass.price), grossPassPrice(amount))) ?? [];
  const checkoutHref = `/checkout?amount=${amount || 1000}&username=${encodeURIComponent(normalizedUsername)}${matchingPasses.length === 1 ? `&gamepassId=${matchingPasses[0].id}` : ""}`;
  const guideHref = `/guide?source=site&flow=order&amount=${amount || 1000}&username=${encodeURIComponent(normalizedUsername)}`;
  const needsGuide = currentLookup.status === "not-found" || currentLookup.status === "no-passes" || currentLookup.status === "error";

  return (
    <div className={styles.calculator}>
      <div className={styles.calculatorBadge}>Калькулятор</div>
      <div className={styles.calculatorHead}>
        <div><span>Твой пакет</span><h2>Сколько Robux нужно?</h2></div>
        <div className={styles.rateState}><i /> Курс обновлён</div>
      </div>

      <label className={styles.fieldLabel} htmlFor="robux-amount">
        <span>Получишь на аккаунт</span><strong>R$</strong>
      </label>
      <div className={styles.amountField}>
        <input
          id="robux-amount"
          inputMode="numeric"
          min="100"
          max="10000"
          type="number"
          value={robux}
          onChange={(event) => setRobux(event.target.value)}
          aria-label="Количество Robux"
        />
        <span>R$</span>
      </div>
      <div className={styles.packGrid}>
        {PACKS.map((pack) => (
          <button
            key={pack}
            type="button"
            aria-pressed={amount === pack}
            className={`${amount === pack ? styles.packActive : styles.pack} ${styles.packTall}`}
            onClick={() => setRobux(String(pack))}
          >
            {pack === HIT_PACK && <span className={styles.packHit}>ХИТ</span>}
            <b>{pack.toLocaleString("ru-RU")}</b>
            <small>{loading ? "…" : `${getPrice(pack).toLocaleString("ru-RU")} ₽`}</small>
            {amount === pack && <Check size={13} className={styles.packTick} />}
          </button>
        ))}
      </div>

      <div className={styles.priceSummary}>
        <div><span>Количество</span><strong>{amount.toLocaleString("ru-RU")} R$</strong></div>
        <div><span>Комиссия Roblox</span><strong>Учтена в цене пасса</strong></div>
        <div className={styles.total}><span>К оплате</span><strong>{loading ? "…" : `${price.toLocaleString("ru-RU")} ₽`}</strong></div>
      </div>
      {!loading && amount > 0 && (
        <p className={styles.tierNote}>Твой курс: {formatCustomerRate(breakdown.rubPerRobux)} ₽/R$</p>
      )}
      {/* Мостик в коды (витрина 2.0): без «вы экономите» — только честная альтернатива. */}
      <a href="#codes" className={styles.codeBridge}>
        {CODE_PRICES[amount] ? `Кодом — ${CODE_PRICES[amount].toLocaleString("ru-RU")} ₽, зато сразу на баланс →` : "Кодом — сразу на баланс, без геймпасса →"}
      </a>
      <CorridorNotice className={styles.corridorNotice} linkClassName={styles.corridorNoticeLink} />
      <label className={styles.nicknameLabel} htmlFor="calculator-username">Куда зачислить Robux</label>
      <div className={`${styles.nicknameField} ${validUsername ? styles.nicknameFieldReady : ""}`}>
        <Gamepad2 size={20} />
        <input
          id="calculator-username"
          value={username}
          onChange={(event) => setUsername(event.target.value.replace(/[^A-Za-z0-9_]/g, "").slice(0, 20))}
          placeholder="Введи ник Roblox"
          autoComplete="off"
          aria-describedby="calculator-username-note"
        />
        {validUsername && <Check size={19} />}
      </div>
      <p id="calculator-username-note" className={styles.nicknameNote}>
        {username && !validUsername ? "Нужно 3–20 латинских букв, цифр или _." : "Для зарегистрированных подставим сохранённый ник — его можно изменить."}
      </p>
      {validUsername && currentLookup.status !== "idle" && <div className={styles.robloxLookup} aria-live="polite">
        {currentLookup.status === "loading" ? <><span className={styles.lookupIcon}><Loader2 size={20} className={styles.lookupSpin} /></span><div><strong>Проверяем аккаунт и геймпассы…</strong><small>Обычно это занимает несколько секунд.</small></div></> : <>
          <span className={styles.lookupAvatar}>{currentLookup.account?.avatarUrl ? <img src={currentLookup.account.avatarUrl} alt={`Аватар ${normalizedUsername}`} /> : <Gamepad2 size={21} />}</span>
          <div><strong>{currentLookup.account ? `${currentLookup.account.displayName} · @${currentLookup.account.username}` : normalizedUsername}</strong><small>{currentLookup.status === "ready" ? `Готово: ${matchingPasses.length} подходящ${matchingPasses.length === 1 ? "ий геймпасс" : "их геймпасса"}.` : currentLookup.status === "wrong-price" ? `Найдено ${currentLookup.passes?.length ?? 0}: можно выбрать другой доступный пакет.` : currentLookup.status === "no-passes" ? "Аккаунт найден, но геймпассов на продажу нет." : currentLookup.status === "not-found" ? "Такой аккаунт Roblox не найден." : "Roblox временно не ответил — продолжим по инструкции."}</small></div>
          {currentLookup.status === "ready" ? <Check size={20} /> : <WalletCards size={20} />}
        </>}
      </div>}
      <Link
        href={needsGuide ? guideHref : checkoutHref}
        aria-disabled={!validUsername || currentLookup.status === "loading"}
        onClick={(event) => { if (!validUsername || currentLookup.status === "loading") event.preventDefault(); }}
        className={validUsername && currentLookup.status !== "loading" ? styles.checkoutAction : styles.checkoutActionDisabled}
      >
        {needsGuide ? "Продолжить по инструкции" : currentLookup.status === "wrong-price" ? "Выбрать найденный геймпасс" : "Проверить и оформить"} <ArrowRight size={18} />
      </Link>
      {currentLookup.status === "wrong-price" && <Link href={guideHref} className={styles.lookupGuideLink}>Создать геймпасс ровно на {grossPassPrice(amount).toLocaleString("ru-RU")} R$ по инструкции</Link>}
      <p className={styles.securityNote}><LockKeyhole size={13} /> Пароль Roblox не потребуется</p>
    </div>
  );
}
