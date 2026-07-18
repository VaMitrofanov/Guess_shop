import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  CircleCheck,
  Clock3,
  Gift,
  Gamepad2,
  KeyRound,
  ShieldCheck,
  Sparkles,
  TimerReset,
  WalletCards,
} from "lucide-react";
import Navbar from "@/components/navbar";
import Footer from "@/components/footer";
import Calculator from "@/components/calculator";
import { CODE_DENOMINATIONS, CODE_PRICES } from "@/lib/codes-pricing";
import styles from "./storefront.module.css";

const steps = [
  {
    number: "01",
    icon: Sparkles,
    title: "Выбери количество",
    text: "Калькулятор сразу покажет стоимость. Итоговая цена фиксируется перед оплатой.",
  },
  {
    number: "02",
    icon: Gamepad2,
    title: "Создай геймпасс",
    text: "Новая инструкция проведёт по Creator Hub и рассчитает правильную цену пасса.",
    href: "/guide?source=site&amount=1000",
  },
  {
    number: "03",
    icon: CircleCheck,
    title: "Оформи заказ",
    text: "Введи ник, выбери найденный геймпасс и следи за состоянием заказа на сайте.",
  },
];

const assurances = [
  { icon: WalletCards, title: "Два способа", text: "Код для простоты или геймпасс для выгоды." },
  { icon: TimerReset, title: "Код за 10–15 минут", text: "Без создания пасса и ожидания выкупа." },
  { icon: BadgeCheck, title: "Глобальные коды", text: "Одинаково активируются в любом регионе." },
  { icon: ShieldCheck, title: "Цена заранее", text: "Сумма и количество Robux видны до оплаты." },
];

const codePacks = CODE_DENOMINATIONS.map((amount) => ({
  amount,
  price: CODE_PRICES[amount],
}));

export default function Home() {
  return (
    <main className={styles.page}>
      <Navbar />

      <section className={styles.hero}>
        <div className={styles.heroGlow} aria-hidden="true" />
        <div className={styles.vaultBackdrop} aria-hidden="true">
          <div className={styles.vaultDoor}>
            <div className={styles.vaultBolts}>{Array.from({ length: 8 }).map((_, index) => <i key={index} />)}</div>
            <div className={styles.vaultWheel}><span>R$</span></div>
          </div>
        </div>
        <div className={styles.heroCopy}>
          <div className={styles.eyebrow}>
            <span className={styles.statusDot} />
            Теперь два способа получить Robux
          </div>
          <h1 className={styles.title}>
            Robux.
            <br />
            Твой способ.
            <br />
            <span>Твой темп.</span>
          </h1>
          <p className={styles.lead}>
            Получи код мгновенной активации без настройки аккаунта или выбери выгодную покупку через геймпасс.
            Оба варианта — без передачи пароля Roblox.
          </p>
          <div className={styles.heroActions}>
            <a href="#codes" className={styles.primaryAction}>
              Выбрать код активации <ArrowRight size={18} />
            </a>
            <a href="#calculator" className={styles.secondaryAction}>
              <Gamepad2 size={17} /> Купить через геймпасс
            </a>
          </div>
          <div className={styles.heroFacts}>
            <span><KeyRound size={15} /> Код за 10–15 минут</span>
            <span><Clock3 size={15} /> Геймпасс — выгоднее</span>
          </div>
        </div>

        <div className={styles.methodDeck} aria-label="Способы покупки Robux">
          <article className={styles.codeMethodCard}>
            <div className={styles.methodTopline}>
              <span><Sparkles size={14} /> Новый способ</span>
              <small>Без настройки Roblox</small>
            </div>
            <div className={styles.methodCopy}>
              <span className={styles.methodIcon}><KeyRound size={24} /></span>
              <div>
                <p>Код мгновенной активации</p>
                <h2>Активируй сразу</h2>
              </div>
            </div>
            <div className={styles.codeTicket} aria-hidden="true">
              <div><span>ROBLOXBANK</span><strong>R$</strong></div>
              <p>••••&nbsp; ••••&nbsp; ••••</p>
              <small>Код появится в личном кабинете</small>
            </div>
            <div className={styles.methodFooter}>
              <span><TimerReset size={16} /> 10–15 минут</span>
              <strong>от 309 ₽</strong>
            </div>
          </article>

          <article className={styles.gamepassMethodCard}>
            <span className={styles.methodIcon}><Gamepad2 size={22} /></span>
            <div><small>Выгоднее</small><strong>Через геймпасс</strong></div>
            <span>от 160 ₽</span>
            <ArrowRight size={18} />
          </article>
        </div>
      </section>

      <section className={styles.assuranceStrip} aria-label="Преимущества покупки">
        {assurances.map(({ icon: Icon, title, text }) => (
          <article key={title} className={styles.assuranceItem}>
            <span className={styles.assuranceIcon}><Icon size={18} /></span>
            <span><strong>{title}</strong><small>{text}</small></span>
          </article>
        ))}
      </section>

      <section className={styles.productsSection}>
        <div className={styles.sectionHeading}>
          <div>
            <span className={styles.sectionKicker}>Выбери свой формат</span>
            <h2>Код или геймпасс —<br />решать тебе</h2>
          </div>
          <p>Код дороже, зато не нужно ничего создавать в Roblox. Геймпасс требует нескольких шагов, но даёт больше Robux за те же деньги.</p>
        </div>

        <div className={styles.productsGrid}>
          <article id="codes" className={styles.codesStore}>
            <div className={styles.codesStoreHead}>
              <span className={styles.codesIcon}><Gift size={23} /></span>
              <div>
                <span>Коды мгновенной активации Roblox</span>
                <h3>Выбери номинал</h3>
              </div>
              <span className={styles.newBadge}>NEW</span>
            </div>
            <p className={styles.codesIntro}>Фиксированные пакеты Robux. Код активируется сразу после получения; первое время выдаём его в личный кабинет в течение 10–15 минут.</p>
            <div className={styles.codesGrid}>
              {codePacks.map(({ amount, price }) => (
                <div key={amount} className={`${styles.codePack} ${amount === 800 ? styles.codePackPopular : ""}`}>
                  {amount === 800 && <small>Популярный</small>}
                  <strong>{amount.toLocaleString("ru-RU")} <span>R$</span></strong>
                  <span>{price.toLocaleString("ru-RU")} ₽</span>
                </div>
              ))}
            </div>
            <div className={styles.codesPromise}>
              <div><BadgeCheck size={18} /><span><strong>Глобальный код</strong><small>Подойдёт для любого региона</small></span></div>
              <div><TimerReset size={18} /><span><strong>Честные 10–15 минут</strong><small>Статус всегда виден в кабинете</small></span></div>
            </div>
            <button type="button" className={styles.codesAction} disabled>
              Скоро в продаже <ArrowRight size={18} />
            </button>
            <p className={styles.previewNote}>Визуальный предпросмотр — покупка кодов пока не включена</p>
          </article>

          <div id="calculator" className={styles.calculatorWrap}>
            <div className={styles.gamepassLabel}>
              <span><Gamepad2 size={16} /> Через геймпасс</span>
              <small>Лучше цена</small>
            </div>
            <Calculator />
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <div>
            <span className={styles.sectionKicker}>Геймпасс: как это работает</span>
            <h2>От выбора пакета<br />до готового заказа</h2>
          </div>
          <p>Технические детали остаются внутри сервиса. Пользователь видит только следующий понятный шаг.</p>
        </div>
        <div className={styles.stepsGrid}>
          {steps.map(({ number, icon: Icon, title, text, href }) => (
            <article key={number} className={styles.stepCard}>
              <div className={styles.stepTop}>
                <span>{number} / 03</span>
                <span className={styles.stepIcon}><Icon size={22} /></span>
              </div>
              <div className={styles.stepProgress}><i style={{ width: `${Number(number) * 33.33}%` }} /></div>
              <div>
                <h3>{title}</h3>
                <p>{text}</p>
                {href && <Link href={href}>Перейти к инструкции <ArrowRight size={15} /></Link>}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.controlSection}>
        <div className={styles.controlCard}>
          <div>
            <span className={styles.sectionKicker}>Статус заказа</span>
            <h2>Всегда понятно,<br />что происходит дальше</h2>
            <p>У каждого формата свой понятный путь: код готовится к выдаче, а геймпасс проходит проверку и выкуп.</p>
          </div>
          <div className={styles.orderWidgets}>
            <div className={`${styles.orderWidget} ${styles.codeOrderWidget}`}>
              <div className={styles.orderWidgetTop}>
                <span>Код мгновенной активации</span><strong>Выдаём код · до 15 минут</strong>
              </div>
              <div className={styles.orderTrack}><i /><i /><i className={styles.current} /></div>
              <div className={styles.orderLabels}><span>Оплачен</span><span>Готовится</span><span>Код выдан</span></div>
            </div>
            <div className={styles.orderWidget}>
              <div className={styles.orderWidgetTop}>
                <span>Через геймпасс</span><strong>Геймпасс проверяется</strong>
              </div>
              <div className={styles.orderTrack}><i /><i /><i className={styles.current} /><i /></div>
              <div className={styles.orderLabels}><span>Создан</span><span>Оплачен</span><span>Проверка</span><span>Готово</span></div>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.bottomCta}>
        <div>
          <span className={styles.sectionKicker}>Готов начать?</span>
          <h2>Выбери удобный способ</h2>
        </div>
        <div className={styles.bottomActions}>
          <a href="#codes" className={styles.secondaryAction}><KeyRound size={17} /> К кодам</a>
          <a href="#calculator" className={styles.primaryAction}>К геймпассам <ArrowRight size={18} /></a>
        </div>
      </section>

      <Footer />
    </main>
  );
}
