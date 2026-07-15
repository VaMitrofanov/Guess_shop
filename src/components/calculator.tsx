"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Gamepad2, LockKeyhole } from "lucide-react";
import { usePricing } from "@/hooks/usePricing";
import styles from "@/app/storefront.module.css";

const PACKS = [500, 1000, 2000, 5000];

export default function Calculator() {
  const [robux, setRobux] = useState("1000");
  const [username, setUsername] = useState("");
  const { loading, getPrice, getBreakdown } = usePricing();
  const amount = Math.max(0, Number(robux) || 0);
  const price = getPrice(amount);
  const breakdown = getBreakdown(amount);
  const normalizedUsername = username.trim();
  const validUsername = /^[A-Za-z0-9_]{3,20}$/.test(normalizedUsername);

  useEffect(() => {
    fetch("/api/account/me")
      .then((response) => (response.ok ? response.json() : null))
      .then((account) => {
        if (account?.robloxUsername) setUsername(account.robloxUsername);
      })
      .catch(() => {});
  }, []);

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
            className={amount === pack ? styles.packActive : styles.pack}
            onClick={() => setRobux(String(pack))}
          >
            {amount === pack && <Check size={13} />} {pack.toLocaleString("ru-RU")}
          </button>
        ))}
      </div>

      <div className={styles.priceSummary}>
        <div><span>Количество</span><strong>{amount.toLocaleString("ru-RU")} R$</strong></div>
        <div><span>Комиссия Roblox</span><strong>Учтена в цене пасса</strong></div>
        <div className={styles.total}><span>К оплате</span><strong>{loading ? "…" : `${price.toLocaleString("ru-RU")} ₽`}</strong></div>
      </div>
      {!loading && amount > 0 && (
        <p className={styles.tierNote}>Расчёт: {breakdown.rubPerRobux} ₽/R${breakdown.smallOrderSurcharge ? ` + ${breakdown.smallOrderSurcharge} ₽` : ""}</p>
      )}
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
      <Link
        href={`/checkout?amount=${amount || 1000}&username=${encodeURIComponent(normalizedUsername)}`}
        aria-disabled={!validUsername}
        onClick={(event) => { if (!validUsername) event.preventDefault(); }}
        className={validUsername ? styles.checkoutAction : styles.checkoutActionDisabled}
      >
        Найти мои геймпассы <ArrowRight size={18} />
      </Link>
      <p className={styles.securityNote}><LockKeyhole size={13} /> Пароль Roblox не потребуется</p>
    </div>
  );
}
