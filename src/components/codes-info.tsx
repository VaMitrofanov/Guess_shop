import {
  ArrowUpRight,
  BadgePercent,
  CircleHelp,
  Headphones,
  KeyRound,
  LockKeyhole,
  Mail,
  ReceiptText,
  Send,
  ShieldCheck,
  Users,
} from "lucide-react";
import { CODE_DISCOUNT_TIERS } from "@/lib/codes-pricing";
import styles from "./codes-info.module.css";

/**
 * Всё, что под интерактивным блоком покупки кода: условия и выгода → шкала
 * скидок → инструкция активации → вопросы и поддержка. Серверный компонент —
 * чистый текст, без запросов.
 */

const REDEEM_URL = "https://www.roblox.com/redeem";

const benefits = [
  { icon: LockKeyhole, title: "Без пароля и ника", text: "Для покупки кода не нужны пароль Roblox, игровой ник и геймпасс." },
  { icon: Mail, title: "Код на почту или в кабинет", text: "Гостю — письмом на указанный email, с аккаунтом — в личном кабинете." },
  { icon: Send, title: "Может оплатить родитель", text: "Соберите заказ и отправьте ссылку: оплатить можно с другого телефона, без входа." },
  { icon: ReceiptText, title: "Цена без сюрпризов", text: "Сумма на кнопке — окончательная: без налогов и комиссий сверху. Чек придёт на email." },
];

const steps = [
  { title: "Откройте roblox.com/redeem", text: "Страница активации на официальном сайте Roblox." },
  { title: "Войдите в нужный аккаунт", text: "Тот, на который должны прийти Robux. Вход — только на сайте Roblox." },
  { title: "Введите код", text: "Скопируйте его из письма или из личного кабинета." },
  { title: "Нажмите «Активировать»", text: "Robux сразу появятся на балансе этого аккаунта." },
];

const faq = [
  {
    q: "Когда придёт код?",
    a: "Сразу после того, как банк подтвердит оплату: обычно это меньше минуты. Гостю код приходит письмом, клиенту с аккаунтом — в личный кабинет (и письмом, если почта аккаунта подтверждена).",
  },
  {
    q: "Оплата прошла — Robux уже на аккаунте?",
    a: "Ещё нет. Оплата и письмо означают, что код у вас. Robux поступят, когда вы введёте код на roblox.com/redeem в нужном аккаунте.",
  },
  {
    q: "Письмо не пришло. Что делать?",
    a: "Проверьте «Спам» и «Промоакции». На странице заказа есть кнопка «Отправить письмо ещё раз» — придёт тот же код, без новой оплаты. Клиенты с аккаунтом всегда видят код в кабинете.",
  },
  {
    q: "Как оплатить за ребёнка?",
    a: "Ребёнок выбирает номинал и нажимает «Отправить ссылку на оплату». Родитель открывает ссылку на своём телефоне и платит — входить в аккаунт ребёнка не нужно. Код придёт туда, куда указал ребёнок.",
  },
  {
    q: "Чем код отличается от покупки через геймпасс?",
    a: "Геймпасс выгоднее, но нужно создать пасс в Roblox и дождаться выкупа. Код проще: ничего создавать не нужно — оплатил, получил, ввёл на сайте Roblox.",
  },
  {
    q: "Я купил карточку на Wildberries — это сюда?",
    a: "Нет. Код с карточки Wildberries активируется по отдельной инструкции — кнопка «Ввести код» в начале страницы. Платить второй раз не нужно.",
  },
];

export default function CodesInfo() {
  return (
    <section className={styles.wrap} aria-labelledby="codes-info-title">
      <div className={styles.heading}>
        <span className={styles.kicker}>Код активации</span>
        <h2 id="codes-info-title">Условия, скидки<br />и как активировать</h2>
      </div>

      <div className={styles.benefits}>
        {benefits.map(({ icon: Icon, title, text }) => (
          <article key={title} className={styles.benefit}>
            <span className={styles.benefitIcon}><Icon size={19} /></span>
            <strong>{title}</strong>
            <p>{text}</p>
          </article>
        ))}
      </div>

      <div className={styles.ladderCard}>
        <div className={styles.ladderHead}>
          <span className={styles.ladderIcon}><BadgePercent size={22} /></span>
          <div>
            <h3>Накопительная скидка на коды</h3>
            <p><b>1% — сразу после регистрации.</b> До 5% — за друзей, которых вы пригласите.</p>
          </div>
        </div>
        <ol className={styles.ladder}>
          {CODE_DISCOUNT_TIERS.map((tier, index) => (
            <li key={tier.percent} className={index === 0 ? styles.ladderFirst : undefined}>
              <strong>{tier.percent}%</strong>
              <span>{tier.invited === 0 ? "Регистрация" : `${tier.invited} покупателей`}</span>
              <i aria-hidden="true" style={{ height: `${28 + index * 16}px` }} />
            </li>
          ))}
        </ol>
        <ul className={styles.ladderRules}>
          <li><Users size={15} /> Засчитывается друг, который зарегистрировался по вашей ссылке и впервые оплатил и получил код.</li>
          <li><ShieldCheck size={15} /> Уровни заменяют друг друга, а не складываются. Прогресс не сгорает.</li>
          <li><KeyRound size={15} /> Скидка действует на коды; условия геймпасса и карточек WB не меняются.</li>
        </ul>
      </div>

      <div className={styles.guide}>
        <div className={styles.guideHead}>
          <h3>Как активировать код</h3>
          <a href={REDEEM_URL} target="_blank" rel="noopener noreferrer" className={styles.redeem}>
            Активировать на Roblox <ArrowUpRight size={17} />
          </a>
        </div>
        <ol className={styles.steps}>
          {steps.map((step, index) => (
            <li key={step.title}>
              <span>{index + 1}</span>
              <div><strong>{step.title}</strong><p>{step.text}</p></div>
            </li>
          ))}
        </ol>
        <p className={styles.guideNote}>Магазин выдаёт код, активирует его покупатель на сайте Roblox. Оплата и письмо ещё не означают, что Robux на аккаунте.</p>
      </div>

      <div className={styles.faq}>
        <h3><CircleHelp size={20} /> Вопросы</h3>
        {faq.map((item) => (
          <details key={item.q}>
            <summary>{item.q}</summary>
            <p>{item.a}</p>
          </details>
        ))}
        <a className={styles.support} href="https://t.me/RobloxBank_PA" target="_blank" rel="noopener noreferrer">
          <Headphones size={18} /> Не нашли ответ? Напишите в поддержку — @RobloxBank_PA
        </a>
      </div>
    </section>
  );
}
