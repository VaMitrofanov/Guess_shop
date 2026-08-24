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

  test("ник и мусор не притворяются геймпассом", () => {
    expect(parseGamepassRef("lokomotiv_2018")).toBeNull();
    expect(parseGamepassRef("https://www.roblox.com/games/920587237/Adopt-Me")).toBeNull();
    expect(parseGamepassRef("")).toBeNull();
    expect(parseGamepassRef(null)).toBeNull();
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
