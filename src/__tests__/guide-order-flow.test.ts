import fs from "node:fs";
import path from "node:path";

/**
 * У страницы `/guide` две роли, и их нельзя путать.
 *
 * Пришёл С ЗАКАЗОМ (WB-гейт, бот, покупка на сайте) — сначала проверка
 * аккаунта: у половины нужный пасс уже выставлен, и создавать нечего. Открыл
 * «Инструкцию» из меню/футера/главной — пошаговая страница: заказа нет,
 * проверять нечего, а поле «впиши ник» на витрине читается как требование
 * логина.
 *
 * Разделяет их ровно один признак — `flow=order` в ссылке. Тест держит его:
 * ссылку легко скопировать не из того места, и тогда либо читатель упрётся в
 * проверку, либо покупатель не увидит своих готовых пассов.
 */

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

const BUYING = [
  "src/app/checkout/page.tsx",
  "src/components/calculator.tsx",
];
const READING = [
  "src/components/navbar.tsx",
  "src/components/footer.tsx",
  "src/app/page.tsx",
];

describe("ссылки на /guide", () => {
  test.each(BUYING)("%s ведёт покупателя в проверку аккаунта (flow=order)", (file) => {
    const source = read(file);
    const links = source.match(/\/guide\?source=site[^"`]*/g) ?? [];
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(link).toContain("flow=order");
  });

  test.each(READING)("%s ведёт читателя в пошаговую инструкцию (без flow)", (file) => {
    const source = read(file);
    const links = source.match(/\/guide\?source=site[^"`]*/g) ?? [];
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(link).not.toContain("flow=order");
  });

  test("в личном кабинете ссылка на заказ несёт flow=order, а общая «Инструкция» — нет", () => {
    const source = read("src/app/dashboard/page.tsx");
    const orderLinks = (source.match(/\/guide\?source=site[^"`]*/g) ?? []).filter((l) => l.includes("amountRobux"));
    expect(orderLinks.length).toBeGreaterThan(0);
    for (const link of orderLinks) expect(link).toContain("flow=order");
    expect(source).toContain('href="/guide?source=site&amount=1000"');
  });
});

describe("маршрутизация /guide", () => {
  test("page отдаёт признак заказа в клиент", () => {
    const source = read("src/app/guide/page.tsx");
    expect(source).toContain('const orderFlow = flow === "order";');
    expect(source).toContain("orderFlow={orderFlow}");
  });

  test("WB-гейт и заказ идут в проверку, остальное — в пошаговую страницу", () => {
    const source = read("src/app/guide/GuideClient.tsx");
    expect(source).toContain("import GamepassCheck from \"./GamepassCheck\";");
    // WB всегда проверка: у гейта заказ есть по построению.
    expect(source).toMatch(/if \(isWB\) \{[\s\S]{0,400}<GamepassCheck/);
    expect(source).toMatch(/if \(guideMode === "BOT" \|\| orderFlow\) \{[\s\S]{0,400}<GamepassCheck/);
    // Читателю остаётся прежняя страница — она по-прежнему рендерится.
    expect(source).toContain("<WBInstructionV2");
  });

  test("шаги инструкции — один экземпляр на обе поверхности", () => {
    for (const file of ["src/app/guide/WBInstructionV2.tsx", "src/app/guide/GamepassCheck.tsx"]) {
      expect(read(file)).toContain('from "./guide-steps"');
    }
    // Скриншот вкладки Sales живёт ровно в одном файле: разъехавшаяся
    // инструкция — это разные ответы на один вопрос на двух экранах.
    const guideDir = path.join(process.cwd(), "src/app/guide");
    const withScreenshot = fs
      .readdirSync(guideDir)
      .filter((f) => f.endsWith(".tsx"))
      .filter((f) => fs.readFileSync(path.join(guideDir, f), "utf8").includes("/guide/wb-step6-sales.png"));
    expect(withScreenshot).toEqual(["guide-steps.tsx"]);
  });
});
