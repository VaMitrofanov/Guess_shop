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
/** Тот же файл без комментариев: разбор инцидента в шапке — не ссылка в коде. */
const code = (file: string) =>
  read(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

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

  /**
   * Правка 07.09.2026. В кабинете «продолжить заказ» больше НЕ собирается
   * руками: у коридорного заказа (карта WB, доставка DBS) деньги уже получены,
   * и ссылка `flow=order` вела его в кассу — покупатель `JS6NQB9` завёл там
   * второй заказ на те же 500 R$ и бросил его в оплате. Адрес продолжения
   * теперь один и считается `continueHref` из `@/lib/active-order`.
   */
  test("в кабинете «продолжить» идёт через continueHref, а не через flow=order", () => {
    const source = code("src/app/dashboard/page.tsx");
    const handmade = (source.match(/`\/guide\?source=site[^`]*`/g) ?? []);
    expect(handmade).toHaveLength(0);
    expect(source).toContain('from "@/lib/active-order"');
    expect(source).toContain("continueHref(");
    // Общая «Инструкция» в кабинете остаётся читательской — без flow=order.
    expect(source).toContain('href="/guide?source=site&amount=1000"');
  });

  test("continueHref коридорного заказа ведёт в его собственный гейт", () => {
    const source = code("src/lib/active-order.ts");
    expect(source).toContain("/guide?source=wb&skip=1&code=");
    expect(source).not.toContain("flow=order");
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
