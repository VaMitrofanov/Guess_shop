/**
 * Contract: в шапке не бывает диапазона ширины, где секции сайта недоступны
 * (D2/D12, ultra-review 2026-07-28).
 *
 * История: сначала ссылка в ЛК была `lg:flex`, а бургер `md:hidden` — на
 * 768–1023 px (все iPad в портрете) не было ни того, ни другого. Починили ЛК,
 * но ссылки секций остались `md:flex`, и на 768 px шапка перестала помещаться:
 * `scrollWidth` 928 при `clientWidth` 768. На витрине это маскировал
 * `overflow-x:hidden`, а на `/login` — нет.
 *
 * Инвариант простой: **бургер прячется ровно на том брейкпоинте, на котором
 * появляются ссылки секций.** Разъехались — значит появилась дыра (ссылок нет
 * нигде) или перегруз (и ссылки, и бургер сразу).
 */

import { readFileSync } from "fs";
import path from "path";

const navbar = readFileSync(path.join(__dirname, "..", "components", "navbar.tsx"), "utf8");

/** Брейкпоинт, на котором горизонтальный список ссылок секций становится видимым. */
function navLinksBreakpoint(): string {
  const match = /className="hidden items-center gap-1 (\w+):flex"/.exec(navbar);
  if (!match) throw new Error("не найден контейнер ссылок секций в navbar.tsx");
  return match[1];
}

/** Брейкпоинт, на котором прячется кнопка-бургер. */
function burgerBreakpoint(): string {
  const match = /aria-label=\{open \? "Закрыть меню" : "Открыть меню"\}/.exec(navbar);
  if (!match) throw new Error("не найдена кнопка-бургер в navbar.tsx");
  const button = navbar.slice(navbar.lastIndexOf("<button", match.index), match.index + match[0].length);
  const hidden = /(\w+):hidden/.exec(button);
  if (!hidden) throw new Error("у бургера нет класса *:hidden");
  return hidden[1];
}

describe("брейкпоинты шапки (D2, D12)", () => {
  it("бургер прячется там же, где появляются ссылки секций", () => {
    expect(burgerBreakpoint()).toBe(navLinksBreakpoint());
  });

  it("выпадающее меню доступно везде, где виден бургер", () => {
    const panel = /className="border-t border-\[var\(--rb-border\)\] bg-\[var\(--rb-bg\)\] px-5 py-4 (\w+):hidden"/.exec(navbar);
    expect(panel?.[1]).toBe(burgerBreakpoint());
  });

  it("вход в личный кабинет виден на планшетах — не позже, чем прячется бургер", () => {
    // D2: на 768–1023 px в ЛК было не попасть вообще. Ссылка должна появляться
    // на md, то есть раньше или одновременно с исчезновением бургера.
    expect(navbar).toMatch(/aria-label=\{loggedIn \? "Личный кабинет" : "Войти"\}[^>]*md:flex/);
  });

  it("подпись кнопки в мобильном меню зависит от того, вошёл ли клиент (D7)", () => {
    const menu = navbar.slice(navbar.indexOf("grid grid-cols-2"));
    expect(menu).toMatch(/loggedIn \? "Кабинет" : "Войти"/);
  });

  it("в шапке и меню нет литеральных цветов, кроме фирменного знака (D1)", () => {
    // Комментарии цитируют старые литералы — смотрим только на код.
    const code = navbar.replace(/\/\*[\s\S]*?\*\//g, "");
    const literals = [...code.matchAll(/(?:bg|text|border)-\[#[0-9a-fA-F]{3,8}\]/g)].map((m) => m[0]);
    // Фирменный знак R$ — единственное исключение, оно зафиксировано в
    // docs/launch-roadmap.md §6.
    expect(literals).toEqual(["bg-[#7556e8]"]);
  });
});
