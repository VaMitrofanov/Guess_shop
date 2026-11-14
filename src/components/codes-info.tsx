import {
  ArrowUpRight,
  CircleHelp,
  Headphones,
  LockKeyhole,
  Mail,
  ReceiptText,
  Send,
} from "lucide-react";
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

const faqWhen = {
  instant: "Сразу после того, как банк подтвердит оплату: обычно это меньше минуты. Гостю код приходит письмом, клиенту с аккаунтом — в личный кабинет (и письмом, если почта аккаунта подтверждена), покупателю в боте — в чат.",
  manual: "После оплаты мы готовим код и присылаем его туда же: гостю — письмом, клиенту с аккаунтом — в личный кабинет (и письмом, если почта подтверждена), покупателю в боте — в чат. Ничего делать не нужно: о готовности напишем.",
};

const faq = [
  {
    q: "Можно подарить код?",
    a: "Да. Включите «В подарок», выберите открытку, напишите пару слов и почту получателя. Он получит письмо-открытку и откроет код по кнопке. Можно выбрать день и время отправки.",
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

export default function CodesInfo({ instant = true }: { instant?: boolean }) {
  return (
    <section className={styles.wrap} aria-labelledby="codes-info-title">
      <div className={styles.heading}>
        <span className={styles.kicker}>Код активации</span>
        <h2 id="codes-info-title">Условия<br />и как активировать</h2>
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
        {[{ q: "Когда придёт код?", a: instant ? faqWhen.instant : faqWhen.manual }, ...faq].map((item) => (
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
