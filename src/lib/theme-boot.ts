/**
 * Тема, применённая ДО первой отрисовки (D3, ultra-review 28.07).
 *
 * Проблема: `data-theme` ставился только в `useEffect` ThemeProvider, а вся
 * тёмная тема модульных стилей завязана на `html[data-theme="dark"]` — 45
 * правил в storefront, 34 в checkout, 24 в guide, 5 в dashboard и ноль
 * fallback-ов на `prefers-color-scheme`. При этом токены `--rb-*` в
 * globals.css переключались сразу. На телефоне с тёмной системной темой первый
 * кадр получался «светлая страница с тёмной шапкой», и только после гидратации
 * всё скачком перекрашивалось.
 *
 * Скрипт обязан быть синхронным и стоять в `<head>` до разметки: единственный
 * способ проставить атрибут раньше, чем браузер посчитает стили.
 *
 * ВАЖНО: строка — источник правды и для вставки в HTML, и для CSP-хеша
 * (`next-security.ts` считает `sha256` от неё же). Правка литерала
 * автоматически меняет хеш; вписывать хеш руками нельзя.
 *
 * Ключ хранилища обязан совпадать со `STORAGE_KEY` в `theme-provider.tsx` —
 * это покрыто тестом `src/__tests__/theme-boot.test.ts`.
 */
export const THEME_STORAGE_KEY = "robloxbank-theme";

export const THEME_BOOT_SCRIPT =
  `(function(){try{` +
  `var s=localStorage.getItem('${THEME_STORAGE_KEY}');` +
  `var p=(s==='light'||s==='dark'||s==='auto')?s:'auto';` +
  `var d=p==='dark'||(p==='auto'&&window.matchMedia('(prefers-color-scheme: dark)').matches);` +
  `var e=document.documentElement;` +
  `e.dataset.theme=d?'dark':'light';` +
  `e.dataset.themeMode=p;` +
  `e.style.colorScheme=d?'dark':'light';` +
  `}catch(_){}})();`;
