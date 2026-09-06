/* ─────────────────────────────────────────────────────────────────────────────
   Квест «ник → что нашли → как сделаем → заказ» — общий текст для TG и VK.

   Зачем отдельный модуль. Тот же квест уже живёт на сайте
   (`src/app/guide/GamepassCheck.tsx`): проверка ника, разбор плана, экран
   выбора способа, ветка ключа. В ботах он был другим — пять текстовых веток,
   один пасс на заказ и ни слова про ключ, — и покупатель, начав в боте и
   продолжив на сайте, видел РАЗНЫЕ требования к одному и тому же заказу.

   Здесь только СЛОВА и КНОПКИ, без ввода-вывода: что показать, решает разбор
   плана (`gamepass-plan.ts`), а как показать — бот. TG рисует HTML и inline-
   клавиатуру, VK — тот же текст без тегов и свои payload-кнопки, поэтому
   разметка ограничена `<b>` и `<code>` (`plainText` снимает их для VK).

   Лимиты VK (10 кнопок, 6 рядов, 5 в ряду) — потолок для КАЖДОГО экрана
   отсюда: ряды строятся так, чтобы влезал самый тесный из двух ботов.
   ───────────────────────────────────────────────────────────────────────── */

import {
  coveredRobux,
  targetsToCreate,
  type CheckPlan,
  type CreateTarget,
} from "./gamepass-plan";

/**
 * Идентификаторы действий. Часть из них — уже живущие в ботах callback'и
 * (`find_gp`, `send_gp_link`): второй кнопки с тем же смыслом не заводим.
 */
export const QUEST = {
  /** Подтвердить собранный план и оформить заказ. */
  confirm: "quest_ok",
  /** Экран выбора способа (три двери). */
  fork: "quest_fork",
  /** Ветка «сделаем за тебя по ключу». */
  key: "quest_key",
  /** Вернуться к полю ключа после отказа. */
  keyRetry: "quest_key_retry",
  /** Ввести другой ник (существующий callback ботов). */
  nick: "find_gp",
  /** Перепроверить тот же ник (существующий callback ботов). */
  recheck: "find_gp_retry",
  /** Прислать Pass ID / ссылку (существующий callback ботов). */
  passid: "send_gp_link",
} as const;

export type QuestActionId = typeof QUEST[keyof typeof QUEST];

export interface QuestButton {
  /** `url` рисуется ссылкой, остальное — кнопкой действия. */
  id: QuestActionId | "url";
  label: string;
  url?: string;
  /** Подсказка цвета для VK; TG цвета кнопок не знает. */
  tone?: "primary" | "positive" | "secondary";
}

export interface QuestScreen {
  /** Текст с минимальной HTML-разметкой (`<b>`, `<code>`). */
  text: string;
  /** Ряды кнопок: внешний массив — ряды, внутренний — кнопки в ряду. */
  rows: QuestButton[][];
  /** Кадры инструкции (только ветка ключа); VK их не шлёт. */
  photos?: string[];
}

const nf = (n: number): string => n.toLocaleString("ru-RU");

/** VK не понимает HTML — тот же текст без тегов. */
export function plainText(html: string): string {
  return html
    .replace(/<\/?(b|code|i|u)>/g, "")
    .replace(/<a href="([^"]+)">([^<]*)<\/a>/g, "$2 $1")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/** Персональная ссылка на инструкцию: код открывает нужный заказ, ник — проверку. */
export function guideUrlFor(wbCode: string, nick?: string): string {
  const base = `https://robloxbank.ru/guide?source=wb&skip=1&code=${encodeURIComponent(wbCode)}`;
  return nick ? `${base}&username=${encodeURIComponent(nick)}` : base;
}

/** Готов ли план к оформлению: создавать больше нечего. */
export function planIsReady(plan: CheckPlan): boolean {
  return plan.kind === "ready" || plan.kind === "assembled";
}

/* ── 1. Результат проверки ─────────────────────────────────────────────── */

/**
 * Что мы нашли на аккаунте и что с этим делать.
 *
 * Список — ТОЛЬКО реально найденное (правка сайта от 06.09.2026: строка «пасс
 * на 2143 · создать» в списке найденного читалась как найденный пасс), а
 * недостающее вынесено в отдельный блок «что нужно сделать».
 */
export function questResultScreen(opts: {
  amount: number;
  nick: string;
  plan: CheckPlan;
  /** Метод «по ключу» включён флагом. */
  keyEnabled: boolean;
  wbCode: string;
}): QuestScreen {
  const { amount, nick, plan, keyEnabled, wbCode } = opts;
  const covered = coveredRobux(plan);
  const create = targetsToCreate(plan);
  const parts = plan.kind === "empty" ? [] : plan.parts;
  const ready = planIsReady(plan);

  const head: Record<CheckPlan["kind"], { k: string; h: string; s: string }> = {
    ready: {
      k: "✅ ВСЁ УЖЕ ГОТОВО",
      h: "Создавать ничего не нужно",
      s: "У тебя уже выставлены геймпассы с нужными ценами — мы подставили их сами.",
    },
    assembled: {
      k: "🧩 СОБРАЛИ ИЗ ТВОИХ",
      h: "Создавать ничего не нужно",
      s: `Твои геймпассы складываются ровно в <b>${nf(amount)} R$</b> без остатка. Один из них выкупим несколько раз — покупки идут с разных аккаунтов, тебе делать ничего не надо.`,
    },
    build: {
      k: "➕ БЕРЁМ ТВОЙ И ДОБАВЛЯЕМ",
      h: "Твой геймпасс подходит — нужен ещё один",
      s: `Твой закрывает <b>${nf(covered)} R$</b> из ${nf(amount)}. Ровно этим не добрать, поэтому под остаток нужен ещё один геймпасс.`,
    },
    empty: {
      k: "🔍 ПОДХОДЯЩЕГО НЕ НАШЛИ",
      h: "На аккаунте нет геймпасса, который мы можем купить",
      s: "<b>Геймпасс — это платная вещь внутри твоей игры в Roblox.</b> Ты её выставляешь, мы покупаем — Roblox переводит тебе робуксы. Такой вещи у тебя пока нет.",
    },
  };
  const h = head[plan.kind];

  const lines: string[] = [
    `${h.k}`,
    "",
    `<b>${h.h}</b>`,
    h.s,
    "",
    `👤 Аккаунт: <b>${nick}</b> — робуксы придут на него.`,
  ];

  if (parts.length > 0) {
    lines.push("", parts.length > 1 ? "🧩 Заказ соберём так:" : "🎯 Берём твой геймпасс:");
    parts.forEach((part, i) => {
      const repeat = part.repeat ? " · тот же пасс, купим с другого аккаунта" : "";
      lines.push(`${i + 1}. «${part.name}» · <b>${part.price} R$</b> → ${nf(part.amount)} R$ на руки${repeat}`);
    });
  }

  if (!ready && create.length > 0) {
    lines.push("", "⚠️ ЧТО НУЖНО СДЕЛАТЬ");
    if (create.length === 1) {
      lines.push(
        `Выставить ${parts.length > 0 ? "ещё один геймпасс" : "один геймпасс"} ценой <b>${create[0].price} R$</b>`,
        parts.length > 0
          ? `Он закроет недостающие <b>${nf(create[0].amount)} R$</b>.`
          : `С него придёт <b>${nf(create[0].amount)} R$</b>.`,
      );
    } else {
      lines.push(
        `Нужны два геймпасса: <b>${create[0].price} R$</b> и <b>${create[1].price} R$</b>.`,
        `С них придёт ${nf(create[0].amount)} R$ и ${nf(create[1].amount)} R$ — вместе ровно <b>${nf(amount)} R$</b>.`,
        "Два вместо одного дорогого: так заказ выкупается быстрее, а сумма та же.",
      );
    }
  }

  if (ready) lines.push("", `💰 Итого на руки: <b>${nf(amount)} R$</b>`);

  const rows: QuestButton[][] = ready
    ? [
        [{ id: QUEST.confirm, label: "✅ Подтвердить заказ", tone: "positive" }],
        [{ id: QUEST.nick, label: "✏️ Это не мои пассы", tone: "secondary" }],
      ]
    : [
        [{ id: QUEST.fork, label: "➡️ Выбрать, как это сделать", tone: "positive" }],
        [{ id: QUEST.nick, label: "✏️ Другой ник", tone: "secondary" }],
      ];

  if (!ready) {
    lines.push("", keyEnabled ? "Способа три — выбери любой, результат одинаковый." : "Способа два — выбери любой, результат одинаковый.");
    rows.splice(1, 0, [{ id: "url", label: "📖 Инструкция", url: guideUrlFor(wbCode, nick) }]);
  }

  return { text: lines.join("\n"), rows };
}

/* ── 2. Экран выбора способа ───────────────────────────────────────────── */

/**
 * Три двери. Порядок — решение владельца от 06.09.2026 и повторяет сайт:
 * «создам сам» → «сделайте за меня» → «он у меня уже есть».
 */
export function questForkScreen(opts: {
  targets: CreateTarget[];
  keyEnabled: boolean;
  wbCode: string;
  nick?: string;
}): QuestScreen {
  const { targets, keyEnabled, wbCode, nick } = opts;
  const many = targets.length > 1;

  const lines = [
    "ВЫБЕРИ, КАК СДЕЛАЕМ",
    "",
    `<b>${many ? "Нужно два геймпасса" : "Как сделаем геймпасс?"}</b>`,
    many
      ? `Нужны два: на <b>${targets[0].price}</b> и <b>${targets[1].price} R$</b>. Способ один на оба — результат одинаковый.`
      : `Нужен один геймпасс за <b>${targets[0]?.price ?? 0} R$</b>. Сделать его можно ${keyEnabled ? "тремя способами" : "двумя способами"} — результат одинаковый.`,
    "",
    "📖 <b>Создам сам</b> — покажем каждое нажатие с картинкой · 3–5 минут",
  ];
  if (keyEnabled) {
    lines.push("🔑 <b>Сделайте за меня</b> · НОВОЕ — пришлёшь один ключ из Roblox, создадим сами. Пароль не нужен · минута");
  }
  lines.push(
    "🔢 <b>Он у меня уже есть</b> — найдём по номеру, даже скрытый · 10 секунд",
    "",
    "Не знаешь, что выбрать? Жми первый — это обычный путь.",
  );

  const rows: QuestButton[][] = [
    [{ id: "url", label: "📖 Создам сам (инструкция)", url: guideUrlFor(wbCode, nick) }],
  ];
  if (keyEnabled) rows.push([{ id: QUEST.key, label: "🔑 Сделайте за меня", tone: "positive" }]);
  rows.push([{ id: QUEST.passid, label: "🔢 Он у меня уже есть", tone: "primary" }]);
  rows.push([{ id: QUEST.recheck, label: "🔄 Уже сделал — проверить", tone: "secondary" }]);

  return { text: lines.join("\n"), rows };
}

/* ── 3. Ветка ключа ────────────────────────────────────────────────────── */

/** Кадры выпуска ключа под устройство — те же, что в инструкции на сайте. */
export const KEY_FRAMES: Record<"mobile" | "pc", string[]> = {
  mobile: [
    "https://robloxbank.ru/guide/wb-key-m-menu.jpg",
    "https://robloxbank.ru/guide/wb-key-m-search.jpg",
    "https://robloxbank.ru/guide/wb-key-m-createkey.jpg",
    "https://robloxbank.ru/guide/wb-key-m-system.jpg",
    "https://robloxbank.ru/guide/wb-key-m-ops.jpg",
    "https://robloxbank.ru/guide/wb-key-m-warning.jpg",
  ],
  pc: [
    "https://robloxbank.ru/guide/wb-key-pc-open.jpg",
    "https://robloxbank.ru/guide/wb-key-pc-search.jpg",
    "https://robloxbank.ru/guide/wb-key-pc-createkey.jpg",
    "https://robloxbank.ru/guide/wb-key-pc-system.jpg",
    "https://robloxbank.ru/guide/wb-key-pc-ops.jpg",
    "https://robloxbank.ru/guide/wb-key-pc-save.jpg",
  ],
};

/**
 * Пять шагов выпуска ключа — слово в слово с разделом инструкции на сайте
 * (`src/app/guide/KeyCreate.tsx`). Здесь они текстом: чат — не место для
 * пролистывания кадров, поэтому картинки идут альбомом, а шаги списком.
 */
export function questKeyScreen(opts: {
  targets: CreateTarget[];
  wbCode: string;
  nick?: string;
  withPhotos?: boolean;
  platform?: "mobile" | "pc";
  /**
   * Кто убирает сообщение с ключом из переписки. В личном чате Telegram бот
   * удаляет входящее сам; сообщество ВК чужие сообщения удалять не умеет, и
   * обещать это там нельзя — попросим человека.
   */
  deleteBy?: "bot" | "user";
}): QuestScreen {
  const { targets, wbCode, nick, withPhotos = false, platform = "mobile", deleteBy = "bot" } = opts;
  const prices = targets.map((t) => t.price);
  const many = prices.length > 1;

  const text = [
    "🔑 СДЕЛАЕМ ЗА ТЕБЯ",
    "",
    "<b>Пришли ключ — остальное на нас</b>",
    `Нужен один ключ из Roblox, это <b>минута</b>. <b>Пароль от Roblox не нужен</b> и никогда не понадобится: ключ умеет ровно одно — создавать геймпассы на твоём аккаунте.`,
    "",
    "<b>Как его выпустить:</b>",
    `1. ${platform === "pc" ? "Открой <b>Create</b> в верхнем меню roblox.com" : "Три полоски внизу справа → вниз до пункта <b>Create</b>"}`,
    "2. Нажми <b>лупу</b> и напиши <code>api</code> → первый пункт <b>API Extensions</b>",
    "3. Синяя кнопка <b>Create API Key</b> → имя любое, хоть <code>1</code>",
    "4. В поле <b>Select API System</b> напиши <code>pass</code> → выбери <b>game-passes</b> (соседний <b>legacy</b>-game-passes не подойдёт)",
    // Самое неочевидное место: права НЕ появляются сами. Ниже возникает блок
    // с названием системы, и рядом — пустая рамка со стрелочкой; пока в неё не
    // добавили обе операции, ключ не умеет ничего. Приёмка владельца 07.09.2026.
    `5. ${platform === "pc"
      ? "Ниже появится блок <b>game-passes</b>, а <b>справа от названия</b> — пустая рамка со стрелочкой ▾"
      : "Ниже появится блок <b>game-passes</b>, а <b>под названием</b> (ниже ползунка) — пустая рамка со стрелочкой ▾"}. Нажми на неё и отметь <b>обе</b> строки: <code>game-pass:read</code> и <code>game-pass:write</code>. Готово выглядит так: в рамке лежат две плашки. Пустая рамка = прав нет, пасс не создастся`,
    "6. <b>Save &amp; Generate Key</b> → галочка <b>I understand the security risks</b> → <b>Copy Key To Clipboard</b>",
    "",
    `Пришли ключ следующим сообщением — создадим ${many ? `два пасса на <b>${prices.join(" и ")} R$</b>` : `пасс на <b>${prices[0] ?? 0} R$</b>`} и сразу поставим в продажу.`,
    "",
    deleteBy === "bot"
      ? "🔒 Сообщение с ключом удалим из переписки сразу, как прочитаем. Сам ключ храним зашифрованным — чтобы поправить геймпасс без тебя; доступа к аккаунту он не даёт."
      : "🔒 Своё сообщение с ключом удали сразу, как я отвечу, — ВКонтакте чужие сообщения я стирать не умею. Сам ключ храним зашифрованным; доступа к аккаунту он не даёт.",
  ].join("\n");

  return {
    text,
    rows: [
      [{ id: "url", label: "📸 Те же шаги с картинками", url: `${guideUrlFor(wbCode, nick)}#key` }],
      [{ id: QUEST.fork, label: "↩️ Другой способ", tone: "secondary" }],
    ],
    photos: withPhotos ? KEY_FRAMES[platform] : undefined,
  };
}

/** Ключ принят, пассы создаются. */
export function questKeyWorkingText(prices: number[]): string {
  return prices.length > 1
    ? `🔑 Ключ принят. Создаём два геймпасса — на ${prices.join(" и ")} R$…`
    : `🔑 Ключ принят. Создаём геймпасс на ${prices[0]} R$…`;
}

/**
 * Отказ по ключу. Формулировки — общие с сайтом
 * (`gamepass-create-messages.ts`), здесь только кнопки под чат.
 */
export function questKeyFailScreen(opts: {
  verdict: { title: string; text: string; retry: boolean };
  wbCode: string;
  nick?: string;
}): QuestScreen {
  const { verdict, wbCode, nick } = opts;
  const rows: QuestButton[][] = [];
  if (verdict.retry) {
    rows.push([{ id: QUEST.keyRetry, label: "🔁 Попробовать ещё раз", tone: "positive" }]);
  } else {
    rows.push([{ id: QUEST.keyRetry, label: "🔑 Прислать другой ключ", tone: "positive" }]);
  }
  rows.push([{ id: "url", label: "📖 Создам сам (инструкция)", url: guideUrlFor(wbCode, nick) }]);
  rows.push([{ id: QUEST.fork, label: "↩️ Другой способ", tone: "secondary" }]);

  return {
    text: [`❌ <b>${verdict.title}</b>`, "", verdict.text].join("\n"),
    rows,
  };
}

/* ── 4. Ник не сработал ────────────────────────────────────────────────── */

/** Такого аккаунта на Roblox нет — почти всегда опечатка. */
export function questNoAccountScreen(opts: { nick: string; wbCode: string }): QuestScreen {
  return {
    text: [
      `🤷 <b>Пользователя ${opts.nick} нет на Roblox</b>`,
      "",
      "Скорее всего опечатка. Скопируй ник прямо со страницы профиля и пришли заново.",
    ].join("\n"),
    rows: [
      [{ id: QUEST.nick, label: "✏️ Ввести ник ещё раз", tone: "positive" }],
      [{ id: "url", label: "📖 Где взять ник", url: guideUrlFor(opts.wbCode) }],
      [{ id: QUEST.passid, label: "🔢 У меня есть Pass ID", tone: "secondary" }],
    ],
  };
}

/** Поиск не дошёл до Roblox — это НЕ «ника нет». */
export function questSearchDownScreen(opts: { wbCode: string; nick?: string }): QuestScreen {
  return {
    text: [
      "⚠️ <b>Поиск по нику временно недоступен</b>",
      "",
      "Не получилось связаться с Roblox. Попробуй ещё раз через минуту — или пришли Pass ID геймпасса, этого тоже достаточно.",
    ].join("\n"),
    rows: [
      [{ id: QUEST.recheck, label: "🔄 Попробовать ещё раз", tone: "positive" }],
      [{ id: QUEST.passid, label: "🔢 Прислать Pass ID", tone: "primary" }],
      [{ id: "url", label: "📖 Инструкция", url: guideUrlFor(opts.wbCode, opts.nick) }],
    ],
  };
}
