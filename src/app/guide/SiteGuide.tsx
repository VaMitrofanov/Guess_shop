"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  ChevronDown,
  CircleAlert,
  Clock3,
  Copy,
  ExternalLink,
  Gamepad2,
  LockKeyhole,
  Search,
  ShieldCheck,
} from "lucide-react";
import Navbar from "@/components/navbar";
import Footer from "@/components/footer";
import styles from "./site-guide.module.css";

const PACKS = [500, 1000, 2000, 5000, 10000, 20000];
const RATE = 0.7;
const passPrice = (amount: number) => Math.ceil(amount / RATE);

const guideSteps = [
  {
    number: 1,
    title: "Открой Creator Hub",
    text: "Перейди на официальный сайт Roblox Creator Hub. Лучше открыть его в браузере, где ты уже вошёл в Roblox.",
    action: { label: "Открыть Creator Hub", href: "https://create.roblox.com/dashboard/creations" },
  },
  {
    number: 2,
    title: "Выбери свою игру",
    text: "В разделе Creations открой карточку игры, названной по твоему нику. Такая игра есть даже у нового аккаунта.",
    image: "/guide/wb-step2-place.png",
    imageAlt: "Карточка игры в Roblox Creator Hub",
  },
  {
    number: 3,
    title: "Перейди в Passes",
    text: "Открой меню слева: Monetization → Passes. Здесь создаются геймпассы, которые можно купить.",
    image: "/guide/wb-step3-passesnav-poster.jpg",
    imageAlt: "Переход в раздел Passes",
  },
  {
    number: 4,
    title: "Создай новый геймпасс",
    text: "Нажми Create Pass, укажи любое название — например VIP. Картинку и описание добавлять необязательно.",
    image: "/guide/wb-step5-create.png",
    imageAlt: "Форма создания геймпасса",
  },
  {
    number: 5,
    title: "Включи продажу и поставь цену",
    text: "Открой новый пасс → Sales. Включи Item for sale, вставь рассчитанную цену и сохрани изменения.",
    image: "/guide/wb-step6-sales.png",
    imageAlt: "Настройка цены и продажи геймпасса",
    critical: true,
  },
];

export default function SiteGuide({ initialAmount, initialUsername, minAmount, maxAmount }: { initialAmount: number; initialUsername: string; minAmount: number; maxAmount: number }) {
  const [amountInput, setAmountInput] = useState(String(initialAmount));
  const [username, setUsername] = useState(initialUsername.replace(/[^A-Za-z0-9_]/g, "").slice(0, 20));
  const [copied, setCopied] = useState(false);
  const amount = useMemo(() => Math.min(maxAmount, Math.max(minAmount, Number.parseInt(amountInput, 10) || minAmount)), [amountInput, minAmount, maxAmount]);
  const price = useMemo(() => passPrice(amount), [amount]);
  const validUsername = /^[A-Za-z0-9_]{3,20}$/.test(username.trim());

  const copyPrice = async () => {
    await navigator.clipboard.writeText(String(price));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <main className={styles.page}>
      <Navbar />
      <header className={styles.hero}>
        <div className={styles.heroInner}>
          <div className={styles.heroCopy}>
            <span className={styles.kicker}>Инструкция для покупки на сайте</span>
            <h1>Создай геймпасс.<br /><span>Остальное сделаем мы.</span></h1>
            <p>Шесть понятных шагов: от Creator Hub до готового заказа. Пароль Roblox никому передавать не нужно.</p>
            <div className={styles.heroFacts}>
              <span><Clock3 size={16} /> 5–7 минут</span>
              <span><LockKeyhole size={16} /> Без пароля</span>
              <span><Search size={16} /> Покупка по нику</span>
            </div>
          </div>
          <aside className={styles.priceDock}>
            <div className={styles.priceDockLabel}>Твой пакет</div>
            <div className={styles.packButtons}>
              {PACKS.map((pack) => (
                <button key={pack} type="button" onClick={() => setAmountInput(String(pack))} className={amount === pack ? styles.packActive : styles.pack}>{amount === pack && <Check size={13} />}{pack.toLocaleString("ru-RU")} R$</button>
              ))}
            </div>
            <label className={styles.customAmountLabel} htmlFor="site-guide-amount">Или введи своё количество</label>
            <div className={styles.customAmountField}>
              <input
                id="site-guide-amount"
                type="number"
                inputMode="numeric"
                min={minAmount}
                max={maxAmount}
                value={amountInput}
                onChange={(event) => setAmountInput(event.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
                onBlur={() => setAmountInput(String(amount))}
                aria-describedby="site-guide-amount-range"
              />
              <strong>R$</strong>
            </div>
            <p id="site-guide-amount-range" className={styles.amountRange}>Доступно от {minAmount.toLocaleString("ru-RU")} до {maxAmount.toLocaleString("ru-RU")} R$</p>
            <div className={styles.priceResult}>
              <span>Цена геймпасса</span>
              <button type="button" onClick={copyPrice} aria-label="Скопировать цену геймпасса"><strong>{price.toLocaleString("ru-RU")} R$</strong>{copied ? <Check size={18} /> : <Copy size={18} />}</button>
            </div>
            <p>Roblox удерживает 30%. Чтобы на аккаунт пришло {amount.toLocaleString("ru-RU")} R$, у пасса должна стоять цена {price.toLocaleString("ru-RU")} R$.</p>
          </aside>
        </div>
        <a href="#steps" className={styles.scrollHint}>Начать инструкцию <ChevronDown size={17} /></a>
      </header>

      <section id="steps" className={styles.guideBody}>
        <aside className={styles.progressRail}>
          <span className={styles.kicker}>Прогресс</span>
          <strong>5 шагов в Roblox<br />+ оформление заказа</strong>
          <div className={styles.railTrack}>{["Creator Hub", "Выбор игры", "Раздел Passes", "Новый геймпасс", "Цена и продажа", "Оформление"].map((label, index) => <a key={label} href={`#step-${index + 1}`}><i>{index + 1}</i><span>{label} <small>(шаг {index + 1})</small></span></a>)}</div>
          <div className={styles.railHelp}><ShieldCheck size={19} /><span><strong>Что-то не получается?</strong><small>Можно вернуться к любому шагу — введённый пакет не потеряется.</small></span></div>
        </aside>

        <div className={styles.stepsColumn}>
          {guideSteps.map((step) => (
            <article key={step.number} id={`step-${step.number}`} className={styles.stepCard}>
              <div className={styles.stepHeading}><span>{step.number}</span><div><small>Шаг {step.number} из 6</small><h2>{step.title}</h2></div></div>
              <p>{step.text}</p>
              {step.action && <a className={styles.externalAction} href={step.action.href} target="_blank" rel="noopener noreferrer">{step.action.label} <ExternalLink size={16} /></a>}
              {step.image && <figure className={styles.figure} data-step={step.number}><Image src={step.image} alt={step.imageAlt ?? ""} width={1000} height={620} sizes="(max-width: 900px) 100vw, 720px" /><span className={styles.focusLabel}>Нажми здесь</span></figure>}
              {step.critical && (
                <div className={styles.criticalBox}>
                  <CircleAlert size={21} />
                  <div><strong>Managed pricing должен быть выключен</strong><p>Региональные цены могут изменить стоимость пасса. Проверь переключатель перед сохранением.</p></div>
                </div>
              )}
              {step.number === 5 && (
                <div className={styles.livePrice}><span>Вставь в поле Price</span><button type="button" onClick={copyPrice}><strong>{price.toLocaleString("ru-RU")} R$</strong>{copied ? "Скопировано" : "Скопировать"}</button></div>
              )}
            </article>
          ))}

          <article id="step-6" className={`${styles.stepCard} ${styles.finishCard}`}>
            <div className={styles.stepHeading}><span>6</span><div><small>Финальный шаг</small><h2>Найди геймпасс по нику</h2></div></div>
            <p>Введи ник аккаунта Roblox. Мы перенесём его и выбранный пакет в оформление заказа на сайте.</p>
            <label className={styles.nickLabel} htmlFor="site-guide-username">Ник Roblox</label>
            <div className={styles.nickField}>
              <Gamepad2 size={19} />
              <input id="site-guide-username" value={username} onInput={(event) => setUsername(event.currentTarget.value.replace(/[^A-Za-z0-9_]/g, "").slice(0, 20))} placeholder="Например, BuilderMax" autoComplete="off" />
              {validUsername && <Check size={18} />}
            </div>
            {username && !validUsername && <p className={styles.nickError}>Ник должен содержать 3–20 латинских букв, цифр или символов `_`.</p>}
            <Link href={`/checkout?amount=${amount}&username=${encodeURIComponent(username.trim())}`} aria-disabled={!validUsername} onClick={(event) => { if (!validUsername) event.preventDefault(); }} className={validUsername ? styles.buyAction : styles.buyActionDisabled}>
              Найти мой геймпасс и оформить заказ <ArrowRight size={18} />
            </Link>
            <div className={styles.finishNote}><LockKeyhole size={17} /><span>На следующем экране выберешь свою игру и геймпасс. Оплата появится только после проверки цены.</span></div>
          </article>
        </div>
      </section>
      <Footer />
    </main>
  );
}
