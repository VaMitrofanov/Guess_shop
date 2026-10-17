/**
 * Contract: типографика публичных экранов (D8, ultra-review 2026-07-28).
 *
 * Правило проекта — на телефоне и планшете (основные устройства владельца)
 * читаемый минимум 14 px; исключение только для микро-бейджей, и не мельче
 * 12 px. До волны 3 на витрине и в ЛК жили 9–12 px: бейдж «Популярный» 9 px,
 * подписи шагов заказа 10 px, согласие на уведомления 11 px, «Забыли пароль?»
 * 12 px — то есть мельче всего оказывались как раз интерактив и юридически
 * значимый текст.
 *
 * Тест разбирает сами CSS-модули, поэтому ловит регресс в любом новом правиле,
 * а не только в тех, что чинились руками. Админка (`admin-shell`) сознательно
 * вне периметра: это внутренний экран владельца, а не публичная поверхность.
 */

import { readFileSync } from "fs";
import path from "path";

const ROOT = path.join(__dirname, "..", "..");

/** Публичные поверхности: витрина, вход, ЛК, чекаут, статус оплаты, инструкция, ошибки. */
const PUBLIC_MODULES = [
  "src/app/storefront.module.css",
  "src/app/auth-shell.module.css",
  "src/app/public-sections.module.css",
  "src/app/error-pages.module.css",
  "src/app/checkout/checkout.module.css",
  "src/app/dashboard/dashboard.module.css",
  "src/app/payment/status/page.module.css",
  "src/app/guide/site-guide.module.css",
  // Оферта, политика и реквизиты: юридически значимый текст, который читают
  // с телефона. Переведены на общий шелл 28.07.2026 — до этого жили в старом
  // тёмном макете с собственной палитрой и в этот контракт не попадали.
  "src/app/legal/legal.module.css",
];

/** Абсолютный пол: мельче этого не должно быть ничего, даже бейджа. */
const HARD_FLOOR_PX = 12;
/** Пол для того, что человек нажимает: кнопки и ссылки. */
const INTERACTIVE_FLOOR_PX = 14;

type Declaration = { file: string; line: number; selector: string; px: number };

/** Убирает комментарии, чтобы закомментированный размер не считался объявлением. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, " "));
}

/**
 * Возвращает каждое объявление `font-size: Npx` вместе с ближайшим селектором.
 * Разбор идёт по фигурным скобкам, поэтому правила внутри медиазапросов
 * получают свой селектор, а не `@media`.
 */
function collectFontSizes(file: string): Declaration[] {
  const css = stripComments(readFileSync(path.join(ROOT, file), "utf8"));
  const found: Declaration[] = [];
  const stack: string[] = [];
  let buffer = "";
  let line = 1;

  for (const char of css) {
    if (char === "\n") line += 1;
    if (char === "{") {
      stack.push(buffer.trim());
      buffer = "";
      continue;
    }
    if (char === "}") {
      stack.pop();
      buffer = "";
      continue;
    }
    if (char === ";") {
      const match = /font-size\s*:\s*(\d+(?:\.\d+)?)px/.exec(buffer);
      // Ближайший селектор — верх стека; @media/@supports пропускаем.
      const selector = [...stack].reverse().find((entry) => !entry.startsWith("@"));
      if (match && selector) found.push({ file, line, selector, px: Number(match[1]) });
      buffer = "";
      continue;
    }
    buffer += char;
  }
  return found;
}

/** Последний компаунд селектора без псевдоклассов: по нему видно, что именно стилизуется. */
function lastCompound(selectorPart: string): string {
  const compound = selectorPart.trim().split(/[\s>+~]+/).filter(Boolean).pop() ?? "";
  return compound.replace(/:not\([^)]*\)/g, "").replace(/::?[a-z-]+(\([^)]*\))?/g, "");
}

/** Кнопка или ссылка: либо сам элемент `a`/`button`, либо класс, названный как действие. */
function isInteractive(selector: string): boolean {
  return selector.split(",").some((part) => {
    const compound = lastCompound(part);
    if (compound === "a" || compound === "button") return true;
    return /\.[a-z0-9_-]*(link|button|action|submit)/i.test(compound);
  });
}

describe("типографика публичных экранов (D8)", () => {
  const declarations = PUBLIC_MODULES.flatMap(collectFontSizes);

  it("разбирает модули и находит объявления размеров", () => {
    expect(declarations.length).toBeGreaterThan(50);
    for (const file of PUBLIC_MODULES) {
      expect({ file, parsed: declarations.some((d) => d.file === file) }).toEqual({ file, parsed: true });
    }
  });

  it(`не содержит текста мельче ${HARD_FLOOR_PX}px`, () => {
    const tooSmall = declarations
      .filter((d) => d.px < HARD_FLOOR_PX)
      .map((d) => `${d.file}:${d.line} ${d.selector} → ${d.px}px`);
    expect(tooSmall).toEqual([]);
  });

  it(`держит кнопки и ссылки не мельче ${INTERACTIVE_FLOOR_PX}px`, () => {
    const tooSmall = declarations
      .filter((d) => d.px < INTERACTIVE_FLOOR_PX && isInteractive(d.selector))
      .map((d) => `${d.file}:${d.line} ${d.selector} → ${d.px}px`);
    expect(tooSmall).toEqual([]);
  });

  it("распознаёт интерактивные селекторы и не путает их с вложенным текстом", () => {
    expect(isInteractive(".formMeta a")).toBe(true);
    expect(isInteractive(".channelCard button,.channelPrimaryLink")).toBe(true);
    expect(isInteractive(".channelCard>a:not(.channelPrimaryLink)")).toBe(true);
    expect(isInteractive(".primaryAction:focus-visible")).toBe(true);
    // Вложенная подпись внутри ссылки — это текст, а не сама цель нажатия.
    expect(isInteractive(".railTrack a small")).toBe(false);
    expect(isInteractive(".linkAction p")).toBe(false);
    expect(isInteractive(".seal::after")).toBe(false);
  });
});
