/* ─────────────────────────────────────────────────────────────────────────────
   Апдейты: крупные изменения продукта (14.11.2026).

   Владелец: «тема "Апдейты" в беседе админов — краткая выжимка по крупным
   апдейтам (система рефералов и т.п.), без спама вроде "поменял кнопку"». И то
   же для клиентов — в канал и сообщество, нарядным текстом.

   Как это работает:
   • запись добавляется СЮДА вместе с кодом фичи (правило в AGENTS.md) — поэтому
     апдейт уходит в беседу ровно тогда, когда его код выкачен и бот перезапустился;
   • TG-бот при старте и раз в полчаса шлёт в тему «Апдейты» записи, которых
     ещё не слал (`WbSyncCursor` stream `release-notes`), — повторов не бывает;
   • текст для клиентов (`public`) САМ не публикуется: под превью две кнопки,
     «Опубликовать в канал и ВК» и «Не публиковать». Решает человек — пост в
     канал виден всем и обратно не забирается.

   Что сюда НЕ пишем: правки текстов и кнопок, мелкие баги, рефакторинг, всё, что
   клиент или админ не заметит. Ориентир — 1–4 записи в месяц.
   ───────────────────────────────────────────────────────────────────────── */

/** Пост для клиентов: Telegram — HTML Bot API, ВК — простой текст (стена форматирования не умеет). */
export interface PublicPost {
  /**
   * Подпись к обложке в Telegram. Разрешены: <b> <i> <u> <s> <code> <a href>,
   * <tg-spoiler>, <blockquote> и <blockquote expandable> (сворачиваемая).
   * Видимый текст ≤ 1024 символов — лимит подписи к фото.
   */
  tgHtml: string;
  /** Тот же смысл для стены ВК — без разметки. */
  vkText: string;
  /** Файл обложки в `bots/shared/assets/updates/` (scripts/render-update-cover.mjs). */
  cover?: string;
  /** Кнопки-ссылки под постом в Telegram, по рядам. */
  buttons?: { label: string; url: string }[][];
  /** Ссылка во вложении поста ВК — ВК покажет карточку сайта с картинкой. */
  link?: string;
}

export interface ReleaseNote {
  /** Стабильный ключ: `YYYY-MM-DD-slug`. Никогда не менять у отправленной записи. */
  id: string;
  /** Дата выката, `YYYY-MM-DD`. */
  date: string;
  /** Заголовок для админов, коротко. */
  title: string;
  /** 2–5 пунктов «что изменилось и что делать админам». Простой текст. */
  admin: string[];
  /** Что-то нужно сделать/включить — одна строка. */
  todo?: string;
  /** Пост для клиентов (канал TG и стена ВК). Нет — клиентам не объявляем. */
  public?: PublicPost;
}

const SITE = "https://robloxbank.ru";

export const RELEASE_NOTES: readonly ReleaseNote[] = [
  {
    id: "2026-11-14-admin-notify-topics",
    date: "2026-11-14",
    title: "Уведомления админам — отдельная беседа по темам",
    admin: [
      "Всё, что раньше сыпалось в личку, теперь в беседе «Уведы» по темам: Особые заказы, Прямые, Нужно действие, К выкупу, Отзывы, Лента (тихо), Система.",
      "Звук только там, где нужен человек. Кнопки карточек работают прямо из беседы.",
      "Важное дублируется в личку общего аккаунта @RobloxBank_PA.",
    ],
  },
  {
    id: "2026-11-14-key-first-guide",
    date: "2026-11-14",
    title: "Инструкция «ключ первым» — пасс по ключу Roblox",
    admin: [
      "На сайте и в ботах главный путь — пасс по ключу Roblox: бот сам находит скрытую игру и создаёт пасс нужной цены.",
      "Чужой ключ ловится по владельцу. Игр нет только у совсем новых аккаунтов.",
    ],
    public: {
      cover: "2026-11-14-key-first-guide.png",
      tgHtml: [
        "<b>🔑 Геймпасс теперь создаётся сам!</b>",
        "",
        "Больше не нужно искать игру и считать цену пасса вручную — вставьте <u>ключ Roblox</u>, и мы сами создадим пасс нужной цены.",
        "",
        "<blockquote>🎯 Цена пасса — точно под ваш заказ\n🔐 Пароль от Roblox по-прежнему не нужен</blockquote>",
        "",
        "<blockquote expandable><b>Что за ключ и где его взять?</b>\nЭто специальный ключ доступа только к геймпассам — он не даёт доступа к аккаунту и робуксам. На сайте есть пошаговая инструкция с картинками: от входа в Roblox до готового ключа.</blockquote>",
      ].join("\n"),
      vkText: "🔑 Геймпасс теперь создаётся сам!\n\nБольше не нужно искать игру и считать цену пасса вручную — вставьте ключ Roblox, и мы сами создадим пасс нужной цены.\n\n🎯 Цена пасса — точно под ваш заказ\n🔐 Пароль от Roblox по-прежнему не нужен\n\nКлюч даёт доступ только к геймпассам — не к аккаунту и не к робуксам. Пошаговая инструкция — на сайте.",
      buttons: [[{ label: "🎮 Купить через геймпасс", url: `${SITE}/#calculator` }]],
      link: `${SITE}/`,
    },
  },
  {
    id: "2026-11-14-site-activation-codes",
    date: "2026-11-14",
    title: "Коды активации на сайте + скидка за приглашения",
    admin: [
      "На сайте продаются коды Roblox на 8 номиналов (100–10 000 R$). Код приходит сразу после оплаты: гостю на почту, клиенту в кабинет.",
      "Можно отправить готовый заказ родителю ссылкой — он оплатит со своего телефона.",
      "Скидка на коды: 1% после регистрации, до 5% за приглашённых покупателей (3/10/20/30).",
      "Нет кода на складе после оплаты или второй платёж — алерт в «Нужно действие», деньги возвращаем вручную.",
    ],
    todo: "Продажа включается флагом CODES_SALES_ENABLED после загрузки кодов на склад (scripts/codes-import.ts). Клиентам объявлять — только после включения.",
    public: {
      cover: "2026-11-14-site-activation-codes.png",
      tgHtml: [
        "<b>🎁 Новинка: коды активации Roblox!</b>",
        "",
        "Оплатили — и код <u>сразу у вас</u>: на почте или в личном кабинете. Ввели на roblox.com/redeem — Robux на балансе.",
        "",
        "<blockquote>⚡ Без ожидания\n🔐 Без пароля от Roblox\n👨‍👩‍👧 Оплатить может родитель — по ссылке</blockquote>",
        "",
        "💜 Зарегистрируйтесь — скидка <b>1% сразу</b>, до <b>5%</b> за друзей.",
        "Самый выгодный номинал — <tg-spoiler>10 000 R$, около рубля за Robux</tg-spoiler> 👀",
        "",
        "<blockquote expandable><b>Как активировать код?</b>\n1. Откройте roblox.com/redeem и войдите в нужный аккаунт\n2. Введите код и нажмите «Активировать»\n3. Готово — Robux уже на балансе ✨</blockquote>",
      ].join("\n"),
      vkText: "🎁 Новинка: коды активации Roblox!\n\nОплатили — и код сразу у вас: на почте или в личном кабинете. Ввели на roblox.com/redeem — Robux на балансе.\n\n⚡ Без ожидания\n🔐 Без пароля от Roblox\n👨‍👩‍👧 Оплатить может родитель — по ссылке\n\n💜 Зарегистрируйтесь — скидка 1% сразу, до 5% за друзей.\n\nКак активировать: откройте roblox.com/redeem, войдите в нужный аккаунт, введите код — готово ✨",
      buttons: [
        [{ label: "🎟 Купить код", url: `${SITE}/#codes` }],
        [{ label: "🎁 Подарить другу", url: `${SITE}/#codes` }, { label: "❓ Как это работает", url: `${SITE}/#codes-info-title` }],
      ],
      link: `${SITE}/#codes`,
    },
  },
];

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function ruDate(date: string): string {
  const [y, m, d] = date.split("-");
  return `${d}.${m}.${y}`;
}

/** Сообщение в тему «Апдейты» (HTML Telegram). */
export function formatAdminUpdate(note: ReleaseNote): string {
  const lines = [
    `🚀 <b>${escapeHtml(note.title)}</b>`,
    `<i>${ruDate(note.date)}</i>`,
    "",
    ...note.admin.map((line) => `• ${escapeHtml(line)}`),
  ];
  if (note.todo) lines.push("", `👉 ${escapeHtml(note.todo)}`);
  return lines.join("\n").slice(0, 4000);
}

/** Подпись в Telegram без разметки — для проверки лимита в 1024 символа. */
export function visibleText(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

export const TG_CAPTION_LIMIT = 1024;
const ALLOWED_TAGS = new Set(["b", "i", "u", "s", "code", "a", "tg-spoiler", "blockquote"]);

/** Разметка, которую Telegram примет: только разрешённые теги, все закрыты. */
export function tgHtmlProblems(html: string): string[] {
  const problems: string[] = [];
  const stack: string[] = [];
  for (const match of html.matchAll(/<\/?([a-z-]+)([^>]*)>/gi)) {
    const tag = match[1].toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) problems.push(`тег <${tag}> Telegram не понимает`);
    if (match[0].startsWith("</")) {
      if (stack.pop() !== tag) problems.push(`незакрытый или лишний </${tag}>`);
    } else stack.push(tag);
  }
  if (stack.length) problems.push(`не закрыт <${stack.join(">, <")}>`);
  return problems;
}

/** Текст для стены ВК. */
export function vkPostText(note: ReleaseNote): string | null {
  return note.public ? note.public.vkText : null;
}

/** Записи, которых ещё не было в беседе, — от старых к новым. */
export function unsentNotes(sent: readonly string[], notes: readonly ReleaseNote[] = RELEASE_NOTES): ReleaseNote[] {
  const done = new Set(sent);
  return notes.filter((note) => !done.has(note.id)).slice().sort((a, b) => a.date.localeCompare(b.date));
}

export function findNote(id: string, notes: readonly ReleaseNote[] = RELEASE_NOTES): ReleaseNote | undefined {
  return notes.find((note) => note.id === id);
}
