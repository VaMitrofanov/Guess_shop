import { readFileSync } from "node:fs";
import { join } from "node:path";

import { guideUrlFor } from "../../bots/shared/gamepass-quest";

/**
 * Вход в ветку ключа по ссылке (`?stage=key`).
 *
 * Что здесь чинится и почему это стоит держать тестом:
 *
 * Кнопка «те же шаги с картинками» из ветки ключа в обоих ботах вела на
 * `…/guide?source=wb&skip=1&code=…#key`. Якоря `#key` на странице нет и никогда
 * не было: человек, ушедший за ключом, попадал в начало проверки ника — ровно в
 * тот экран, из которого только что вышел. Ветку открывает query-параметр.
 *
 * Второе, менее заметное: ветка ключа не должна требовать «есть что создавать».
 * Заказ, который не выкупается ИМЕННО потому, что на аккаунте один крупный пасс
 * (`plan.kind === "ready"`, `targetsToCreate` пуст), — это и есть главный
 * клиент метода, а прежнее условие развилки его к ключу не подпускало.
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const PAGE = read("src/app/guide/page.tsx");
const CLIENT = read("src/app/guide/GuideClient.tsx");
const CHECK = read("src/app/guide/GamepassCheck.tsx");

describe("ссылка из бота", () => {
  test("несёт stage=key и не опирается на якорь", () => {
    const url = guideUrlFor("ABC1234", "Nick", "key");
    expect(url).toContain("stage=key");
    expect(url).toContain("code=ABC1234");
    expect(url).toContain("username=Nick");
    expect(url).not.toContain("#");
  });

  test("без stage ссылка прежняя — на проверку аккаунта", () => {
    expect(guideUrlFor("ABC1234", "Nick")).not.toContain("stage=");
  });

  test("мёртвых якорей #key не осталось ни в ботах, ни в инструкции", () => {
    const sources = [
      "bots/shared/gamepass-quest.ts",
      "bots/tg/handlers.ts",
      "bots/vk/handlers.ts",
      "src/app/guide/GamepassCheck.tsx",
      "src/app/guide/KeyCreate.tsx",
    ];
    // Ищем именно ПРИКЛЕЕННЫЙ к ссылке якорь (`${…}#key`, `… + "#key"`), а не
    // упоминание в комментарии и не сравнение с `location.hash`.
    const offenders = sources.filter((rel) => /\}#key|\+\s*["'`]#key/.test(read(rel)));
    expect(offenders).toEqual([]);
  });
});

describe("страница принимает stage", () => {
  test("белый список из одного значения: снаружи открывается только ключ", () => {
    expect(PAGE).toContain('stage === "key"');
    expect(PAGE).toContain("initialStage");
  });

  test("оба входа в проверку аккаунта получают намерение", () => {
    // WB-гейт и «заказ из бота / покупка на сайте» — две разные ветки рендера,
    // и пробросить проп только в одну значит починить ссылку наполовину.
    expect(CLIENT.match(/initialStage=\{initialStage\}/g) ?? []).toHaveLength(2);
    expect(CHECK).toContain("initialStage");
  });
});

describe("намерение тратится после проверки ника", () => {
  test("ветка открывается по результату проверки, а не на монтировании", () => {
    // До проверки нет ни аккаунта, ни плана — рисовать блок ключа не на чем,
    // поэтому намерение тратится там же, где приходит результат.
    const check = CHECK.slice(CHECK.indexOf('setPhase("result");'));
    expect(check).toContain("if (keyWanted.current) {");
    expect(check).toContain("keyWanted.current = false;");
  });

  test("выключенный флаг метода не обещает того, чего нет", () => {
    expect(CHECK).toContain('if (keyAutoEnabled) setStage("key");');
  });

  test("старые ссылки с якорем всё же доводят до ветки", () => {
    // Кнопки живут в переписке дольше кода.
    expect(CHECK).toContain('window.location.hash.toLowerCase() === "#key"');
  });
});

describe("ветка ключа с планом, где создавать нечего", () => {
  const keyBlock = CHECK.split("\n").find((line) => line.includes('(stage === "key" || keyDone)')) ?? "";

  test("блок ключа не требует «есть что создавать»", () => {
    expect(keyBlock).not.toBe("");
    expect(keyBlock).not.toContain("toCreate");
  });

  test("карточка результата молчит, пока ключ не отработал", () => {
    // «Создавать ничего не нужно» прямо над формой ключа — спор страницы с
    // самой собой; после создания карточка возвращается ради «Подтвердить».
    expect(CHECK).toContain('const keyPending = stage === "key" && !keyDone;');
    const card = CHECK.split("\n").find((line) => line.includes("stage === \"result\" || orderPlaced")) ?? "";
    expect(card).toContain("!keyPending");
  });

  test("дверь «создам сам» из ветки ключа не ведёт в пустой экран", () => {
    // При пустом `toCreate` шаги показываются справочным вариантом, а не ничем.
    expect(CHECK).toContain('const showSteps = stage === "manual" || peek;');
  });
});
