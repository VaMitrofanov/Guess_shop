import Link from "next/link";
import {
  ArrowRight,
  CircleCheck,
  Gamepad2,
  Gift,
  KeyRound,
  ShieldCheck,
  Sparkles,
  TimerReset,
  WalletCards,
} from "lucide-react";
import Navbar from "@/components/navbar";
import Footer from "@/components/footer";
import Calculator from "@/components/calculator";
import { CODE_DENOMINATIONS } from "@/lib/codes-pricing";
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
  { icon: ShieldCheck, title: "Без пароля", text: "Пароль Roblox не нужен ни на одном шаге." },
  { icon: WalletCards, title: "Цена заранее", text: "Сумма и количество Robux видны до оплаты." },
  { icon: TimerReset, title: "Понятный статус", text: "Каждый шаг заказа виден в личном кабинете." },
  { icon: KeyRound, title: "Коды — скоро", text: "Мгновенная активация без настройки аккаунта." },
];

// D4: номиналы показываем как анонс, без цены — товар пока не продаётся,
// а цена непродающегося товара это и вопрос к конверсии, и вопрос банка.
const codeDenominations = [...CODE_DENOMINATIONS];

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
            Покупка Robux за рубли
          </div>
          <h1 className={styles.title}>
            Robux.
            <br />
            Твой способ.
            <br />
            <span>Твой темп.</span>
          </h1>
          <p className={styles.lead}>
            Покупка через геймпасс: цена и количество Robux известны до оплаты, пароль Roblox не нужен.
            Коды мгновенной активации готовим к запуску.
          </p>
          <div className={styles.heroActions}>
            <a href="#calculator" className={styles.primaryAction}>
              Купить через геймпасс <ArrowRight size={18} />
            </a>
            {/* D4: вход в блок кодов — тихая ссылка, а не кнопка: покупка кодов
                ещё не включена, и первый экран не должен предлагать кнопку
                в неработающий сценарий. */}
            <a href="#codes" className={styles.heroTextLink}>
              <KeyRound size={16} /> Коды активации — скоро
            </a>
          </div>
          <div className={styles.heroFacts}>
            <span><ShieldCheck size={15} /> Без пароля Roblox</span>
            <span><Sparkles size={15} /> Цена фиксируется до оплаты</span>
          </div>
        </div>

        <div className={styles.methodDeck} aria-label="Способы покупки Robux">
          <article className={styles.gamepassHeroCard}>
            <div className={styles.methodTopline}>
              <span><Gamepad2 size={14} /> Основной способ</span>
              <small>от 160 ₽</small>
            </div>
            <div className={styles.methodCopy}>
              <span className={styles.methodIcon}><Gamepad2 size={24} /></span>
              <div>
                <p>Покупка через геймпасс</p>
                <h2>Больше Robux</h2>
              </div>
            </div>
            <ul className={styles.methodPoints}>
              <li><CircleCheck size={16} /> Цена и количество видны до оплаты</li>
              <li><CircleCheck size={16} /> Пароль Roblox не нужен</li>
              <li><CircleCheck size={16} /> Инструкция проведёт по шагам</li>
            </ul>
            <div className={styles.methodFooter}>
              <span><TimerReset size={16} /> Статус — в кабинете</span>
              <strong>Купить <ArrowRight size={17} /></strong>
            </div>
          </article>

          <div className={styles.codeTeaser}>
            <span className={styles.codeTeaserIcon}><KeyRound size={18} /></span>
            <p>
              <strong>Коды мгновенной активации</strong>
              <small>Готовим запуск</small>
            </p>
            <a href="#codes">Что это</a>
          </div>
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
            <span className={styles.sectionKicker}>Как купить Robux</span>
            <h2>Геймпасс сейчас,<br />коды — скоро</h2>
          </div>
          <p>Через геймпасс покупка работает уже сегодня: цена известна до оплаты, пароль не нужен. Коды мгновенной активации готовим к запуску.</p>
        </div>

        <div className={styles.productsGrid}>
          <div id="calculator" className={styles.calculatorWrap}>
            <div className={styles.gamepassLabel}>
              <span><Gamepad2 size={16} /> Через геймпасс</span>
              <small>Работает сейчас</small>
            </div>
            <Calculator />
          </div>

          <article id="codes" className={styles.codesStore}>
            <div className={styles.codesStoreHead}>
              <span className={styles.codesIcon}><Gift size={23} /></span>
              <h3>Коды мгновенной активации</h3>
              <span className={styles.soonBadge}>СКОРО</span>
            </div>
            <p className={styles.codesIntro}>Фиксированные номиналы Robux без настройки аккаунта: код активируется сразу после получения, выдача занимает 10–15 минут.</p>
            <div className={styles.codesGrid}>
              {codeDenominations.map((amount) => (
                <div key={amount} className={styles.codePack}>
                  <strong>{amount.toLocaleString("ru-RU")} <span>R$</span></strong>
                </div>
              ))}
            </div>
            {/* D4: вместо disabled-кнопки «Скоро в продаже» — честная строка
                состояния со ссылкой на способ, который работает. */}
            <p className={styles.codesStatus}>
              Покупка кодов пока не включена. Сейчас Robux можно купить <a href="#calculator">через геймпасс</a>.
            </p>
          </article>
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
            <p>Заказ через геймпасс проходит проверку и выкуп — каждый шаг виден в личном кабинете.</p>
          </div>
          <div className={styles.orderWidgets}>
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
          <h2>Купи Robux через геймпасс</h2>
        </div>
        <div className={styles.bottomActions}>
          <a href="#calculator" className={styles.primaryAction}>К калькулятору <ArrowRight size={18} /></a>
          <a href="#codes" className={styles.bottomTextLink}>Коды активации — скоро</a>
        </div>
      </section>

      <Footer />
    </main>
  );
}
