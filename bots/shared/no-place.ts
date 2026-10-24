/**
 * «Нет игры» в ветке ключа → сразу инструкция «создай плейс» (20.10.2026).
 *
 * Владелец: ответ «у аккаунта нет игры» в шаге ключа бывает часто, и почти
 * всегда это новый аккаунт. У нового аккаунта нет ни одного плейса: Roblox не
 * создаёт его сам, а без плейса геймпасс не сделать ни ключом, ни руками.
 * Плейс создаётся только в Roblox Studio (по API — нельзя, см.
 * `docs/roblox-gamepass-autocreate.md`), это два действия.
 *
 * Вопроса «аккаунт новый?» нет — по решению владельца это просто пояснение
 * («скорее всего аккаунт новый, это нормально»), за которым сразу идут шаги.
 * Админам при этом уходит карточка: видно, что у покупателя нет плейса.
 *
 * Модуль без зависимостей — его читают и клиентские компоненты сайта.
 * Карточка админам и событие заказа — в `no-place-notice.ts`.
 */

const SITE = "https://robloxbank.ru";

/** Официальная страница загрузки Studio — публичная, без входа. */
export const STUDIO_DOWNLOAD_URL = "https://create.roblox.com/download";

/** Вердикты ключа, после которых показываем инструкцию по плейсу. */
export const PLACE_HELP_VERDICTS = ["no_universe", "games_hidden"] as const;

export function showsPlaceHelp(verdictCode?: string | null): boolean {
  return Boolean(verdictCode) && (PLACE_HELP_VERDICTS as readonly string[]).includes(verdictCode as string);
}

/** Событие заказа: бот/сайт показали инструкцию по плейсу. */
export const PLACE_HELP_EVENT = "BOT_NO_PLACE_HELP";

/**
 * Пояснение — формулировка владельца. У `games_hidden` игра может быть,
 * просто скрыта, поэтому там фраза мягче: «если игры нет».
 */
export function placeHelpInfo(verdictCode?: string | null): string {
  return verdictCode === "games_hidden"
    ? "Если своей игры у тебя ещё нет — скорее всего, аккаунт новый, и это нормально. Сейчас покажем, как создать плейс раз и навсегда."
    : "Скорее всего у тебя новый аккаунт, и на нём ещё нет плейса — это нормально. Сейчас покажем, как создать его раз и навсегда.";
}

export interface PlaceStep {
  /** Кадр — абсолютный адрес: его берут и боты, и сайт. */
  image: string;
  /** Подпись к кадру — без HTML (VK, alt сайта). */
  caption: string;
}

/**
 * Кадры: 0 — как выглядит плейс (проверка «есть ли он»), 1–2 — Studio.
 * Пометки нарисованы на самих картинках, поэтому годятся и ботам.
 */
export const PLACE_STEPS: readonly PlaceStep[] = [
  {
    image: `${SITE}/guide/place-hub.jpg`,
    caption: "Так выглядит плейс: Creator Hub → Creations. Если такая карточка у тебя есть — пришли ссылку на неё. Если пусто — шаги ниже.",
  },
  {
    image: `${SITE}/guide/place-studio-new.jpg`,
    caption: "Шаг 1. Скачай Roblox Studio, войди в свой аккаунт и нажми New Experience.",
  },
  {
    image: `${SITE}/guide/place-studio-publish.jpg`,
    caption: "Шаг 2. Сверху File → Publish to Roblox. Название любое — нажми Create. Готово, плейс есть.",
  },
] as const;

/** Личная инструкция, открытая сразу на разделе плейса. */
export function placeGuideUrl(wbCode?: string | null, nick?: string | null): string {
  const code = (wbCode ?? "").trim();
  const corridor = /^[A-Za-z0-9]{7}$/.test(code) && !code.startsWith("DIR-") && !code.startsWith("AV-");
  let url = corridor
    ? `${SITE}/guide?source=wb&skip=1&code=${encodeURIComponent(code)}`
    : `${SITE}/guide?source=direct`;
  if (corridor && nick) url += `&username=${encodeURIComponent(nick)}`;
  return `${url}&stage=place`;
}

/** Шаги текстом — под кадрами (Telegram HTML; для VK — `plainText`). */
export function placeStepsText(): string {
  return [
    "🛠 <b>Как создать плейс — 2 минуты, один раз:</b>",
    "",
    "1️⃣ Скачай <b>Roblox Studio</b> — кнопка ниже. Он работает только на компьютере (Windows или Mac).",
    "2️⃣ Открой Studio, войди в свой аккаунт и нажми <b>New Experience</b>.",
    "3️⃣ Сверху <b>File → Publish to Roblox</b>, название любое, нажми <b>Create</b>.",
    "",
    "Готово — пришли сюда ключ ещё раз (тот же самый, новый делать не нужно), и мы создадим геймпасс.",
    "",
    "<i>Компьютера нет? Напиши нам — поможем.</i>",
  ].join("\n");
}
