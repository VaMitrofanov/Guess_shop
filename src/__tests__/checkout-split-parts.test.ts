import fs from "node:fs";
import path from "node:path";

/**
 * Заказ с сайта закрывается набором пассов — как в коридоре ВБ.
 *
 * Пока оформление несло ровно один `gamepassId`, заказ на 2000 R$ требовал
 * пасс за 2858 — а его не может выкупить ни один донор: у них 1500 «чистых»
 * (2143 грязных). То есть номинал 2000, который сайт спокойно продавал, был
 * невыкупаемым по построению. Коридор ВБ давно решает это парой 1500 + 500.
 *
 * Тест держит проводку целиком: инструкция считает набор, оформление его
 * принимает и доносит до сервера, сервер проверяет КАЖДУЮ часть, а заказ
 * получает те же строки `WbOrderGamepass`, что и коридор. Развалиться она
 * может в любом из четырёх мест, и каждое из них молчаливое.
 */

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

describe("набор пассов на сайте", () => {
  test("инструкция считает разбивку и для сайта тоже", () => {
    const source = read("src/app/guide/GamepassCheck.tsx");
    // Раньше здесь стояло `{ maxParts: 1, splitPlan: false }` — сайт умел
    // только один пасс, и разбивка у него была своя, отличная от коридора.
    expect(source).not.toContain("maxParts: 1");
    expect(source).not.toContain("splitPlan: false");
    // Набор уезжает на оформление целиком: `ID:НОМИНАЛ` через запятую.
    expect(source).toMatch(/params\.set\("parts"/);
  });

  test("оформление принимает набор и шлёт его на сервер", () => {
    const source = read("src/app/checkout/page.tsx");
    expect(source).toContain("parsePartsParam");
    // Готовность к оплате — либо один пасс нужной цены, либо набор на всю сумму.
    expect(source).toContain("planCoversAmount");
    expect(source).toMatch(/parts: planCoversAmount && planParts/);
    // Смена суммы обнуляет набор: он был посчитан под другой заказ.
    expect(source).toMatch(/setPlanParts\(null\)/);
  });

  test("сервер проверяет каждую часть отдельно и пишет разбивку в заказ", () => {
    const route = read("src/app/api/orders/create/route.ts");
    expect(route).toContain("validateCheckoutParts");
    expect(route).toContain("expectedPartPrice");
    // Голова заказа обязана совпадать с первой частью — по ней заказ ищут.
    expect(route).toContain("Первая часть должна совпадать");

    const core = read("src/lib/canonical-web-order.ts");
    expect(core).toContain("wbOrderGamepass.createMany");
  });
});
