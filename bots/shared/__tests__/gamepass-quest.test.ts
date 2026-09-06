export {};

/**
 * Квест «ник → что нашли → как сделаем» в ботах.
 *
 * Что здесь нельзя сломать молча:
 *   • **Экран влезает в клавиатуру VK.** Превышение лимита (10 кнопок / 6 рядов
 *     / 5 в ряду) отвергает ВСЮ отправку, и покупатель видит «Произошла
 *     ошибка» вместо сообщения (P0 04.07.2026).
 *   • **Недостающий пасс не выглядит найденным.** Ровно эту правку владелец
 *     принял на сайте 06.09.2026 (`c15c5d2`): строка «пасс на 2143 · создать»
 *     стояла в списке найденного и читалась как найденный.
 *   • **Дверь ключа не рисуется, когда метод выключен флагом.**
 *   • **Ветка ключа называет ПРАВИЛЬНЫЙ пункт Roblox.** `legacy-game-passes`
 *     стоит соседней строкой и не работает вовсе — час отладки 06.09.2026.
 */

import { planFromOwned, type OwnedPass } from "../gamepass-plan";
import {
  QUEST,
  plainText,
  questForkScreen,
  questKeyScreen,
  questNoAccountScreen,
  questResultScreen,
  type QuestScreen,
} from "../gamepass-quest";

const pass = (id: string, price: number, name = `Pass ${price}`): OwnedPass => ({
  gamepassId: id,
  name,
  price,
  isForSale: true,
});

const screenButtons = (screen: QuestScreen) => screen.rows.flat();

/** Лимиты VK — потолок для КАЖДОГО экрана: он самый тесный из двух ботов. */
function expectFitsVk(screen: QuestScreen): void {
  expect(screen.rows.length).toBeLessThanOrEqual(6);
  expect(screenButtons(screen).length).toBeLessThanOrEqual(10);
  for (const row of screen.rows) expect(row.length).toBeLessThanOrEqual(5);
}

describe("экран результата", () => {
  test("всё готово: подтверждение, итог на руки и ни слова про создание", () => {
    const plan = planFromOwned(500, [pass("1", 715)]);
    const screen = questResultScreen({ amount: 500, nick: "Nick", plan, keyEnabled: true, wbCode: "ABC1234" });

    expect(plan.kind).toBe("ready");
    expect(screen.text).toContain("Создавать ничего не нужно");
    expect(screen.text).toContain("Итого на руки");
    expect(screen.text).not.toContain("ЧТО НУЖНО СДЕЛАТЬ");
    expect(screenButtons(screen).map((b) => b.id)).toContain(QUEST.confirm);
    expectFitsVk(screen);
  });

  test("нечего выкупать: недостающее — в блоке «что нужно сделать», не в списке найденного", () => {
    const plan = planFromOwned(1000, []);
    const screen = questResultScreen({ amount: 1000, nick: "Nick", plan, keyEnabled: true, wbCode: "ABC1234" });

    expect(plan.kind).toBe("empty");
    expect(screen.text).toContain("ЧТО НУЖНО СДЕЛАТЬ");
    // Список найденного не рисуется вовсе: находить было нечего.
    expect(screen.text).not.toContain("Берём твой геймпасс");
    expect(screenButtons(screen).map((b) => b.id)).toContain(QUEST.fork);
    expect(screenButtons(screen).map((b) => b.id)).not.toContain(QUEST.confirm);
    expectFitsVk(screen);
  });

  test("достраиваем: свой пасс в списке, недостающий — задачей", () => {
    // 500 закрывается пассом на 715; до 1200 не хватает 700 — их создаём.
    const plan = planFromOwned(1200, [pass("1", 715)]);
    const screen = questResultScreen({ amount: 1200, nick: "Nick", plan, keyEnabled: true, wbCode: "ABC1234" });

    expect(plan.kind).toBe("build");
    expect(screen.text).toContain("нужен ещё один");
    expect(screen.text).toContain("ЧТО НУЖНО СДЕЛАТЬ");
    expectFitsVk(screen);
  });

  test("набор из нескольких частей показывается по строкам с суммой на руки", () => {
    // 2000 = 1500 + 500 по SPLIT_PLANS; оба пасса у покупателя уже есть.
    const plan = planFromOwned(2000, [pass("1", 2143), pass("2", 715)]);
    const screen = questResultScreen({ amount: 2000, nick: "Nick", plan, keyEnabled: true, wbCode: "ABC1234" });

    expect(plan.kind === "ready" || plan.kind === "assembled").toBe(true);
    expect(screen.text).toContain("Заказ соберём так");
    expect(screen.text).toContain("1.");
    expect(screen.text).toContain("2.");
    expectFitsVk(screen);
  });
});

describe("экран выбора способа", () => {
  const targets = [{ price: 1429, amount: 1000 }];

  test("три двери, когда метод по ключу включён", () => {
    const screen = questForkScreen({ targets, keyEnabled: true, wbCode: "ABC1234", nick: "Nick" });
    const ids = screenButtons(screen).map((b) => b.id);
    expect(ids).toContain("url");        // инструкция
    expect(ids).toContain(QUEST.key);    // сделаем за тебя
    expect(ids).toContain(QUEST.passid); // уже есть
    expect(screen.text).toContain("тремя способами");
    expectFitsVk(screen);
  });

  test("выключенный флаг убирает и кнопку, и обещание в тексте", () => {
    const screen = questForkScreen({ targets, keyEnabled: false, wbCode: "ABC1234", nick: "Nick" });
    expect(screenButtons(screen).map((b) => b.id)).not.toContain(QUEST.key);
    expect(screen.text).toContain("двумя способами");
    expect(screen.text).not.toContain("Сделайте за меня");
    expectFitsVk(screen);
  });

  test("привязанный ключ делает первой дверью «создать за меня»", () => {
    // Ради этого ключи и хранятся: человеку, который привязал ключ в кабинете,
    // идти в Roblox больше не нужно ни разу.
    const screen = questForkScreen({ targets, keyEnabled: true, wbCode: "ABC1234", nick: "Nick", storedKey: true });
    const ids = screenButtons(screen).map((b) => b.id);
    expect(ids[0]).toBe(QUEST.keyStored);
    // Второй кнопки «пришли ключ» при этом нет — он уже прислан.
    expect(ids).not.toContain(QUEST.key);
    expect(screen.text).toContain("ключ уже привязан");
    expectFitsVk(screen);
  });

  test("ссылка на инструкцию персональная: несёт код заказа и ник", () => {
    const screen = questForkScreen({ targets, keyEnabled: true, wbCode: "ABC1234", nick: "Nick" });
    const url = screenButtons(screen).find((b) => b.id === "url")?.url ?? "";
    expect(url).toContain("code=ABC1234");
    expect(url).toContain("username=Nick");
  });
});

describe("ветка ключа", () => {
  const screen = questKeyScreen({ targets: [{ price: 1429, amount: 1000 }], wbCode: "ABC1234", nick: "Nick" });

  test("называет рабочий API System и предупреждает про соседний legacy", () => {
    expect(screen.text).toContain("game-passes");
    expect(screen.text).toContain("read");
    expect(screen.text).toContain("write");
    expect(screen.text).toContain("legacy");
  });

  test("обещает то, что метод действительно делает: цену и «в продаже»", () => {
    expect(screen.text).toContain("1429");
    expect(screen.text).toContain("в продажу");
  });

  test("говорит, что пароль Roblox не нужен, и что сообщение с ключом уберём", () => {
    expect(screen.text).toContain("Пароль от Roblox не нужен");
    expect(screen.text).toContain("удалим");
  });

  test("ВК не обещает удалить чужое сообщение — там просим удалить самому", () => {
    const vk = questKeyScreen({ targets: [{ price: 1429, amount: 1000 }], wbCode: "ABC1234", deleteBy: "user" });
    expect(vk.text).not.toContain("удалим из переписки");
    expect(vk.text).toContain("удали сразу");
  });

  test("про хранение ключа сказано честно: храним зашифрованным", () => {
    expect(screen.text).toContain("зашифрованным");
  });

  test("влезает в клавиатуру VK", () => expectFitsVk(screen));
});

describe("ник не найден", () => {
  const screen = questNoAccountScreen({ nick: "Nope", wbCode: "ABC1234" });

  test("ведёт к повторному вводу и к запасному входу по Pass ID", () => {
    const ids = screenButtons(screen).map((b) => b.id);
    expect(ids).toContain(QUEST.nick);
    expect(ids).toContain(QUEST.passid);
    expectFitsVk(screen);
  });
});

describe("plainText", () => {
  test("снимает разметку для VK, оставляя текст целым", () => {
    expect(plainText("<b>Пасс</b> на <code>715</code> R$")).toBe("Пасс на 715 R$");
  });

  test("ни один экран не оставляет VK видимых тегов", () => {
    const screens = [
      questResultScreen({ amount: 1000, nick: "N", plan: planFromOwned(1000, []), keyEnabled: true, wbCode: "ABC1234" }),
      questForkScreen({ targets: [{ price: 1429, amount: 1000 }], keyEnabled: true, wbCode: "ABC1234" }),
      questKeyScreen({ targets: [{ price: 1429, amount: 1000 }], wbCode: "ABC1234" }),
      questNoAccountScreen({ nick: "N", wbCode: "ABC1234" }),
    ];
    for (const screen of screens) expect(plainText(screen.text)).not.toMatch(/<\/?[a-z]/i);
  });
});
