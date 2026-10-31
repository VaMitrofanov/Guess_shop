import { extractGamepassId, parseGamepassRef, parseGamepassUrl } from "../lib/gamepass-id";
import * as mirror from "../../bots/shared/gamepass-id";

/**
 * Ручной ввод геймпасса — запасной вход в заказ, когда поиск по нику ничего не
 * нашёл (скрытый плейс, свежий пасс, лаг Roblox). Разбор один на сайт и оба
 * бота, поэтому проверяем и сами формы, и то, что зеркало не разъехалось.
 */
describe("gamepass reference parsing", () => {
  test.each([
    ["https://www.roblox.com/game-pass/1784555857/Cool-Pass", "1784555857"],
    ["https://www.roblox.com/game-pass/1784555857?utm=1#top", "1784555857"],
    ["https://www.roblox.com/ru/game-passes/1784555857", "1784555857"],
    ["roblox.com/game_pass/1784555857", "1784555857"],
    ["https://create.roblox.com/dashboard/creations/experiences/77/passes/1784555857/sales", "1784555857"],
    ["  https://www.roblox.com/game-pass/1784555857  ", "1784555857"],
  ])("reads %s", (input, expected) => {
    expect(parseGamepassUrl(input)).toBe(expected);
    expect(parseGamepassRef(input)).toBe(expected);
  });

  test("голое число — это ID только там, где поле подписано «ссылка или ID»", () => {
    // Чисто цифровой ник Roblox проходит NICK_RE, поэтому в поле поиска по нику
    // число обязано остаться ником — иначе поиск уедет в несуществующий пасс.
    expect(parseGamepassUrl("1784555857")).toBeNull();
    expect(parseGamepassRef("1784555857")).toBe("1784555857");
  });

  /**
   * Голое число проверяется на правдоподобие длиной. Без этого «715» уходило в
   * Roblox как Pass ID: в лучшем случае пустой ответ, в худшем — ЧУЖОЙ пасс,
   * чьим владельцем мы пометили бы заказ. Пассы, которые создают сейчас, — это
   * 10 цифр; всё, что короче семи, у покупателя означает цену или номинал.
   */
  test.each(["322", "715", "500", "77", "12345", "123456", "1234567890123"])(
    "«%s» — не Pass ID, а цена/номинал/обрывок",
    (input) => {
      expect(parseGamepassRef(input)).toBeNull();
      expect(mirror.parseGamepassRef(input)).toBeNull();
    },
  );

  test.each(["1969680833", "1784555857", "12345678"])("«%s» — правдоподобный Pass ID", (input) => {
    expect(parseGamepassRef(input)).toBe(input);
    expect(mirror.parseGamepassRef(input)).toBe(input);
  });

  test("ник и мусор не притворяются геймпассом", () => {
    expect(parseGamepassRef("lokomotiv_2018")).toBeNull();
    expect(parseGamepassRef("https://www.roblox.com/games/920587237/Adopt-Me")).toBeNull();
    expect(parseGamepassRef("")).toBeNull();
    expect(parseGamepassRef(null)).toBeNull();
  });

  /**
   * Блок «Пасс уже создан?» просит Pass ID, но принимает и вставленный адрес.
   * Адреса Creator Hub при этом асимметричны: страница самого пасса номер
   * содержит, страница СПИСКА пассов — нет. Разница видна только здесь, поэтому
   * держим её тестом: иначе «можно вставить и адрес» тихо станет пустым отказом.
   */
  test("адрес страницы пасса даёт номер, адрес списка — нет", () => {
    const passPage = "https://create.roblox.com/dashboard/creations/experiences/10302269431/passes/1969680833/configure";
    const listPage = "https://create.roblox.com/dashboard/creations/experiences/10302269431/monetization/passes?tab=Creations";
    expect(parseGamepassRef(passPage)).toBe("1969680833");
    expect(mirror.parseGamepassRef(passPage)).toBe("1969680833");
    expect(parseGamepassRef(listPage)).toBeNull();
    expect(mirror.parseGamepassRef(listPage)).toBeNull();
    // Номер ИГРЫ стоит рядом, после /experiences/, и не должен подменять пасс.
    expect(parseGamepassRef("https://create.roblox.com/dashboard/creations/experiences/10302269431")).toBeNull();
  });

  test("extractGamepassId остаётся узким разбором для колонки БД", () => {
    // Триггер `wborder_gamepass_id_sync` синхронит только форму game-pass/<id>.
    expect(extractGamepassId("https://www.roblox.com/game-pass/1784555857")).toBe("1784555857");
    expect(extractGamepassId("1784555857")).toBeNull();
  });

  test("зеркало для ботов разбирает ровно то же самое", () => {
    // Разъехавшийся разбор означал бы, что сайт оформляет заказ по ссылке,
    // а бот на ту же ссылку отвечает «не удалось распознать».
    const cases = [
      "https://www.roblox.com/game-pass/1784555857/Cool-Pass",
      "https://www.roblox.com/ru/game-passes/1784555857",
      "https://create.roblox.com/dashboard/creations/experiences/77/passes/1784555857/sales",
      "1784555857",
      "lokomotiv_2018",
      "https://www.roblox.com/games/920587237/Adopt-Me",
      "",
    ];
    for (const input of cases) {
      expect(mirror.parseGamepassRef(input)).toBe(parseGamepassRef(input));
      expect(mirror.parseGamepassUrl(input)).toBe(parseGamepassUrl(input));
    }
  });
});
