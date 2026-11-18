/* 🪪 Карточка профиля в кабинете (18.11.2026).

   Кабинет ощущается продолжением Roblox: настоящий аватар игрока и его имя.
   Но ник бывает неприличным, а школьник потом просит родителей оплатить —
   поэтому человек сам выбирает, как его показывать: имя из Roblox, Telegram,
   ВК, своё или просто «Игрок». Плюс вид аватара и фон карточки.

   Модуль чистый — без базы и сети; хранится в `User.profileStyle` (JSON). */

export const NAME_MODES = ["roblox", "tg", "vk", "custom", "hidden"] as const;
export const AVATAR_MODES = ["podium", "bust", "portrait", "badge"] as const;
export const BACKGROUNDS = ["violet", "mint", "sunset", "sky", "night", "newyear"] as const;

export type NameMode = (typeof NAME_MODES)[number];
export type AvatarMode = (typeof AVATAR_MODES)[number];
export type Background = (typeof BACKGROUNDS)[number];

export type ProfileStyle = {
  nameMode: NameMode;
  customName: string | null;
  avatarMode: AvatarMode;
  background: Background;
};

export const DEFAULT_STYLE: ProfileStyle = { nameMode: "roblox", customName: null, avatarMode: "podium", background: "violet" };

export const BACKGROUND_CSS: Record<Background, string> = {
  violet: "linear-gradient(135deg, #7556e8 0%, #4b33b8 55%, #241b3b 100%)",
  mint: "linear-gradient(135deg, #2fb58c 0%, #1c6e57 55%, #12392f 100%)",
  sunset: "linear-gradient(135deg, #ff8a5c 0%, #b8336a 55%, #4a1838 100%)",
  sky: "linear-gradient(135deg, #3d8bff 0%, #2a4bb8 55%, #17275f 100%)",
  night: "linear-gradient(135deg, #2e2350 0%, #1a1430 55%, #0b0912 100%)",
  newyear: "linear-gradient(135deg, #c8333f 0%, #8a2433 50%, #1d5c3c 100%)",
};

export const BACKGROUND_LABEL: Record<Background, string> = {
  violet: "Фиолетовый", mint: "Мятный", sunset: "Закат", sky: "Небо", night: "Ночь", newyear: "Новый год",
};

const MAX_CUSTOM = 24;
const LINK_RE = /(https?:|www\.|\.(ru|com|net|org|me|io|gg)\b|t\.me|@)/i;
const ALLOWED_RE = /^[\p{L}\p{N} ._-]+$/u;
// Корни грубых слов: своё имя видят родители и поддержка. Не цензор на все
// случаи — защита от очевидного.
// «еб»/«сосу» — только с начала слова: иначе «Хлебушек» и «Глеб» уходили в отказ.
const RUDE_RE = /(ху[йияеё]|пизд|п[иі]д[оа]р|(?<![а-яё])[её]б[аулнт]|бля|сук[аи]|мудак|гандон|шлюх|залуп|дроч|(?<![а-яё])сосу|fuck|shit|dick|bitch|cunt|porn|nigg)/i;

/** Проверка своего имени. `null` — годится, иначе — причина для человека. */
export function customNameProblem(raw: string): string | null {
  const name = raw.replace(/\s+/g, " ").trim();
  if (name.length < 2) return "Имя — хотя бы 2 буквы";
  if (name.length > MAX_CUSTOM) return `Имя — не длиннее ${MAX_CUSTOM} символов`;
  if (LINK_RE.test(name)) return "Без ссылок и @";
  if (!ALLOWED_RE.test(name)) return "Только буквы, цифры, пробел, точка, дефис";
  const lower = name.toLowerCase();
  if (RUDE_RE.test(lower) || RUDE_RE.test(lower.replace(/[\s._-]/g, ""))) return "Такое имя не подойдёт — выберите другое";
  return null;
}

const pick = <T extends string>(list: readonly T[], value: unknown, fallback: T): T =>
  typeof value === "string" && (list as readonly string[]).includes(value) ? (value as T) : fallback;

/** Разобрать то, что лежит в базе: мусор и устаревшие значения — к умолчаниям. */
export function parseProfileStyle(raw: unknown): ProfileStyle {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const custom = typeof o.customName === "string" ? o.customName.replace(/\s+/g, " ").trim() : "";
  const customName = custom && !customNameProblem(custom) ? custom : null;
  let nameMode = pick(NAME_MODES, o.nameMode, DEFAULT_STYLE.nameMode);
  if (nameMode === "custom" && !customName) nameMode = DEFAULT_STYLE.nameMode;
  return {
    nameMode,
    customName,
    avatarMode: pick(AVATAR_MODES, o.avatarMode, DEFAULT_STYLE.avatarMode),
    background: pick(BACKGROUNDS, o.background, DEFAULT_STYLE.background),
  };
}

/** Проверить то, что прислал браузер. Ошибка — текстом для человека. */
export function validateProfileStyleInput(raw: unknown): { ok: true; style: ProfileStyle } | { ok: false; error: string } {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!o) return { ok: false, error: "Пустой запрос" };
  if (!NAME_MODES.includes(o.nameMode as NameMode)) return { ok: false, error: "Неизвестный вариант имени" };
  if (!AVATAR_MODES.includes(o.avatarMode as AvatarMode)) return { ok: false, error: "Неизвестный вид аватара" };
  if (!BACKGROUNDS.includes(o.background as Background)) return { ok: false, error: "Неизвестный фон" };
  let customName: string | null = null;
  if (typeof o.customName === "string" && o.customName.trim()) {
    const problem = customNameProblem(o.customName);
    if (problem) return { ok: false, error: problem };
    customName = o.customName.replace(/\s+/g, " ").trim();
  }
  if (o.nameMode === "custom" && !customName) return { ok: false, error: "Впишите своё имя" };
  return {
    ok: true,
    style: { nameMode: o.nameMode as NameMode, customName, avatarMode: o.avatarMode as AvatarMode, background: o.background as Background },
  };
}

export type NameSources = {
  roblox: { displayName: string; username: string } | null;
  tg: string | null;
  vk: string | null;
};

/** Какие варианты имени доступны человеку (нет Telegram — нет и «имени из Telegram»). */
export function availableNameModes(sources: NameSources): NameMode[] {
  return NAME_MODES.filter((mode) =>
    mode === "roblox" ? Boolean(sources.roblox) : mode === "tg" ? Boolean(sources.tg) : mode === "vk" ? Boolean(sources.vk) : true);
}

/** Имя на карточке и показан ли под ним ник Roblox. */
export function shownName(style: ProfileStyle, sources: NameSources): { name: string; showsRoblox: boolean } {
  const fallback = (): { name: string; showsRoblox: boolean } =>
    sources.roblox ? { name: sources.roblox.displayName || sources.roblox.username, showsRoblox: true } : { name: "Игрок", showsRoblox: false };
  switch (style.nameMode) {
    case "roblox": return fallback();
    case "tg": return sources.tg ? { name: sources.tg, showsRoblox: false } : fallback();
    case "vk": return sources.vk ? { name: sources.vk, showsRoblox: false } : fallback();
    case "custom": return style.customName ? { name: style.customName, showsRoblox: false } : fallback();
    case "hidden": return { name: "Игрок", showsRoblox: false };
  }
}

/** Приветствие по часу на устройстве человека. */
export function greetingFor(hour: number): string {
  if (hour >= 5 && hour < 12) return "Доброе утро";
  if (hour >= 12 && hour < 17) return "Добрый день";
  if (hour >= 17 && hour < 23) return "Добрый вечер";
  return "Доброй ночи";
}
