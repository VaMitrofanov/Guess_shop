import Link from "next/link";
import { ArrowRight, Clock3, Gamepad2, Percent, ShoppingCart } from "lucide-react";
import Navbar from "@/components/navbar";
import Footer from "@/components/footer";
import shared from "../public-sections.module.css";
import styles from "./pending.module.css";
import type { Metadata } from "next";

/**
 * «Где мои робуксы?» — объяснение геймпасса и Pending (24.10.2026).
 *
 * Самый частый вопрос в поддержке — «оплатил, где робуксы». Ответ всегда
 * один и тот же, поэтому он живёт здесь, а бот и сообщение о выкупе ссылаются
 * на эту страницу (`PENDING_INFO_URL` в `bots/shared/robux-eta.ts`).
 *
 * Не под гейтом техработ (`src/proxy.ts`): страницу открывают из ботов, и
 * она должна отвечать, даже когда витрина закрыта.
 */

export const metadata: Metadata = {
  title: "Где мои робуксы? Как работает геймпасс и Pending — RobloxBank",
  description:
    "Почему робуксы за геймпасс приходят не сразу: Roblox держит их в статусе Pending. Если робуксы в Pending — с нашей стороны всё. Как проверить за минуту.",
  alternates: { canonical: "/pending" },
};

const steps = [
  {
    icon: Gamepad2,
    tag: "Шаг 1 · ты",
    title: "Создаёшь геймпасс",
    text: "Геймпасс — это «товар» в твоей игре Roblox. Ты ставишь на него цену, и любой игрок может его купить.",
  },
  {
    icon: ShoppingCart,
    tag: "Шаг 2 · мы",
    title: "Мы его покупаем",
    text: "Наш аккаунт покупает твой геймпасс за робуксы. С этой секунды робуксы уже твои — мы свою часть выполнили.",
  },
  {
    icon: Percent,
    tag: "Шаг 3 · Roblox",
    title: "Roblox берёт 30 %",
    text: "С каждой продажи Roblox удерживает комиссию. Цена геймпасса уже учитывает её — тебе приходит ровно сумма заказа.",
  },
  {
    icon: Clock3,
    tag: "Шаг 4 · Roblox",
    title: "Держит в Pending",
    text: "Доход с продаж Roblox сначала кладёт в Pending — «в ожидании». Когда перевести робуксы на баланс, решает только Roblox: они переходят туда сами.",
  },
];

const situations = [
  {
    q: "На балансе пусто, а в Pending есть число",
    a: "Всё нормально. Если в строке Pending Robux стоит число не меньше суммы заказа — робуксы твои, с нашей стороны всё сделано. Roblox их просто ещё держит. Ничего делать не нужно.",
  },
  {
    q: "В Pending Robux стоит 0",
    a: "Сначала проверь аккаунт: робуксы приходят на тот аккаунт, где создан геймпасс, а не на тот, где ты сейчас играешь. Загляни и в баланс — робуксы могли уже перейти туда из Pending. Если аккаунт тот, а робуксов нет ни в Pending, ни на балансе — нажми в боте «Робуксов нет» и пришли скриншот страницы Transactions: менеджер проверит выкуп.",
  },
  {
    q: "Робуксы давно в Pending и не переходят на баланс",
    a: "Так бывает: сколько держать робуксы, решает Roblox, и в последнее время он держит дольше прежнего. Ускорить это не может ни наша поддержка, ни мы. Робуксы никуда не денутся — они придут сами.",
  },
  {
    q: "Можно ускорить?",
    a: "Нет. Срок задаёт Roblox, одинаково для всех продавцов геймпассов — и у нас, и у любого другого магазина.",
  },
  {
    q: "Почему через геймпасс, а не переводом?",
    a: "Roblox не разрешает переводить робуксы между игроками. Продажа геймпасса — официальный способ получить робуксы от другого игрока, без пароля и без доступа к твоему аккаунту.",
  },
];

export default function PendingPage() {
  return (
    <main className={shared.page}>
      <Navbar />
      <div className={shared.shell}>
        <header className={shared.hero}>
          <div className={shared.heroCopy}>
            <span className={shared.kicker}>Как работает геймпасс</span>
            <h1>
              Где мои робуксы?<br />
              <span>Уже у тебя.</span>
            </h1>
            <p>
              Roblox держит робуксы за проданный геймпасс в статусе <b>Pending</b>. Так он делает с
              каждой продажей у любого продавца. Если робуксы в Pending — с нашей стороны всё, дальше
              решает Roblox.
            </p>
          </div>
          <div className={shared.seal}>R$</div>
        </header>

        <div className={shared.sectionTop}>
          <h2>Что происходит с заказом</h2>
          <p>Четыре шага. Два последних делает сам Roblox — повлиять на них не может никто.</p>
        </div>
        <ol className={styles.flow}>
          {steps.map(({ icon: Icon, tag, title, text }) => (
            <li key={title} className={styles.step}>
              <div className={shared.cardIcon}><Icon size={25} /></div>
              <span className={shared.cardTag}>{tag}</span>
              <h3>{title}</h3>
              <p>{text}</p>
            </li>
          ))}
        </ol>

        <div className={shared.sectionTop}>
          <h2>Как проверить за минуту</h2>
          <p>Открывай в браузере: в приложении Roblox этой страницы нет.</p>
        </div>
        <section className={styles.check}>
          <ol className={styles.checkList}>
            <li>
              Войди в Roblox в <b>тот аккаунт, где создан геймпасс</b> — робуксы приходят именно на него.
            </li>
            <li>
              Открой{" "}
              <a href="https://www.roblox.com/transactions" target="_blank" rel="noreferrer">
                roblox.com/transactions
              </a>
              , вкладка <b>Summary</b>.
            </li>
            <li>
              Найди строку <b>Pending Robux</b>. Она есть у всех — важно <b>число</b> в ней: там должна
              стоять сумма заказа или больше, а не 0.
            </li>
          </ol>
          <figure className={styles.mock} aria-label="Схема страницы Transactions">
            <div className={styles.mockBar}>
              <span>Transactions</span>
              <span className={styles.mockTabs}><b>Summary</b> · Purchases · Sales</span>
            </div>
            <div className={styles.mockRow}><span>Sales of Goods</span><span>0</span></div>
            <div className={styles.mockRow}><span>Premium Payouts</span><span>0</span></div>
            <div className={`${styles.mockRow} ${styles.mockHit}`}>
              <span>Pending Robux</span><span>1 000</span>
            </div>
            <figcaption>
              Схема, не скриншот. В строке Pending Robux — сумма твоего заказа: значит, всё в порядке.
            </figcaption>
          </figure>
        </section>

        <div className={shared.sectionTop}>
          <h2>Частые ситуации</h2>
          <p>Нажми на свою — ответ откроется.</p>
        </div>
        <div className={shared.faqList}>
          {situations.map(({ q, a }, i) => (
            <details key={q} className={shared.faqItem} open={i === 0}>
              <summary>{q}<i>+</i></summary>
              <div className={shared.faqAnswer}>{a}</div>
            </details>
          ))}
        </div>

        <section className={shared.cta}>
          <div className={shared.ctaText}>
            <h2>Остались вопросы?</h2>
            <p>Напиши боту «где робуксы?» — он покажет твой заказ и поможет проверить Pending.</p>
          </div>
          <Link href="https://t.me/RobloxBankBot" className={shared.button}>
            Открыть бота <ArrowRight size={19} />
          </Link>
        </section>
      </div>
      <Footer />
    </main>
  );
}
