import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  BookOpen,
  CircleCheck,
  Clock3,
  Gamepad2,
  LockKeyhole,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import Navbar from "@/components/navbar";
import Footer from "@/components/footer";
import Calculator from "@/components/calculator";
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
  { icon: LockKeyhole, title: "Пароль не нужен", text: "Покупка проходит через твой геймпасс." },
  { icon: BadgeCheck, title: "Цена перед оплатой", text: "Сумма и количество Robux видны заранее." },
  { icon: Search, title: "Поиск по нику", text: "Сайт найдёт игры и доступные геймпассы." },
  { icon: ShieldCheck, title: "Заказ под контролем", text: "Статус и важные действия собраны в одном месте." },
];

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
            Покупка Robux через геймпасс
          </div>
          <h1 className={styles.title}>
            Robux.
            <br />
            Без пароля.
            <br />
            <span>Без лишних шагов.</span>
          </h1>
          <div className={styles.bankSignature}><strong>ROBLOXBANK</strong><span>цифровой сейф для твоих Robux</span></div>
          <p className={styles.lead}>
            Выбери количество, создай геймпасс по понятной инструкции и оформи заказ прямо на сайте.
          </p>
          <div className={styles.heroActions}>
            <a href="#calculator" className={styles.primaryAction}>
              Рассчитать стоимость <ArrowRight size={18} />
            </a>
            <Link href="/guide?source=site&amount=1000" className={styles.secondaryAction}>
              <BookOpen size={17} /> Открыть инструкцию
            </Link>
          </div>
          <div className={styles.heroFacts}>
            <span><LockKeyhole size={15} /> Без доступа к аккаунту</span>
            <span><Clock3 size={15} /> Инструкция занимает 5–7 минут</span>
          </div>
        </div>

        <div id="calculator" className={styles.calculatorWrap}>
          <Calculator />
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

      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <div>
            <span className={styles.sectionKicker}>Как это работает</span>
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
            <p>После оформления заказ получает понятный timeline: создан, оплачен, геймпасс проверен, выкуп завершён.</p>
          </div>
          <div className={styles.orderWidget}>
            <div className={styles.orderWidgetTop}>
              <span>Демо статуса заказа</span><strong>Геймпасс проверяется</strong>
            </div>
            <div className={styles.orderTrack}><i /><i /><i className={styles.current} /><i /></div>
            <div className={styles.orderLabels}><span>Создан</span><span>Оплачен</span><span>Проверка</span><span>Готово</span></div>
          </div>
        </div>
      </section>

      <section className={styles.bottomCta}>
        <div>
          <span className={styles.sectionKicker}>Готов начать?</span>
          <h2>Рассчитай свой пакет Robux</h2>
        </div>
        <a href="#calculator" className={styles.primaryAction}>К калькулятору <ArrowRight size={18} /></a>
      </section>

      <Footer />
    </main>
  );
}
