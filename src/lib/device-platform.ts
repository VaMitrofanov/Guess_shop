/**
 * Телефон или компьютер — для инструкции по созданию геймпасса.
 *
 * Путь к Creator Hub на этих двух устройствах разный (в приложении Roblox это
 * ☰ → Create, в браузере — пункт Create в шапке roblox.com), поэтому страница
 * показывает разные кадры. Угадываем в три слоя:
 *
 *   1. сервер — `User-Agent`, чтобы правильная версия пришла уже в первом HTML
 *      и не мигала после гидратации;
 *   2. браузер — `pointer: coarse`, правит планшет в «десктопном режиме»;
 *   3. человек — переключатель на странице, его выбор всегда главнее.
 *
 * Ни одна ветка не решает ничего, кроме подписей и картинок: заказ, цена и
 * возврат в бота/на сайт от платформы не зависят.
 */

export type GuidePlatform = "mobile" | "pc";

/** Ключ, под которым лежит выбор человека. Один на все три поверхности. */
export const GUIDE_PLATFORM_KEY = "rb_guide_platform";

/**
 * Мобильный `User-Agent`. Намеренно грубо: цена ошибки — не тот скриншот,
 * а не сломанный заказ, и поверх всё равно стоит переключатель.
 * `Android` без `Mobile` — это планшет, ему ближе десктопная раскладка.
 */
export function platformFromUserAgent(ua: string | null | undefined): GuidePlatform {
  if (!ua) return "pc";
  if (/iPhone|iPod|Windows Phone|IEMobile/i.test(ua)) return "mobile";
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? "mobile" : "pc";
  // iPad с iPadOS 13+ представляется макинтошем — ловим по тач-точкам в браузере.
  return "pc";
}

/** Значение из localStorage, если человек уже выбирал руками. */
export function storedPlatform(): GuidePlatform | null {
  try {
    const v = window.localStorage.getItem(GUIDE_PLATFORM_KEY);
    return v === "mobile" || v === "pc" ? v : null;
  } catch {
    return null;
  }
}

export function rememberPlatform(p: GuidePlatform): void {
  try {
    window.localStorage.setItem(GUIDE_PLATFORM_KEY, p);
  } catch {
    /* приватный режим — просто не запомним */
  }
}

/**
 * Уточнение уже в браузере. Умеет ровно одно: сказать «на самом деле это
 * сенсорное устройство» — так ловится айпад, который с iPadOS 13 представляется
 * макинтошем. Обратно, в `pc`, не переводит НИКОГДА: десктопный `User-Agent`
 * сервер и так читает как `pc`, а вот телефон, у которого `matchMedia` ответил
 * не то, ронять на десктопную версию нельзя — человек останется без своих
 * кадров. Возвращает `null`, когда добавить нечего.
 */
export function platformFromBrowser(): GuidePlatform | null {
  if (typeof window === "undefined") return null;
  const coarse = window.matchMedia?.("(pointer: coarse)")?.matches ?? false;
  const touch = (navigator.maxTouchPoints ?? 0) > 1;
  return coarse && touch ? "mobile" : null;
}
