import { readFileSync } from "node:fs";
import { join } from "node:path";

/* Поиск обязан находить заказ, который существует.
 *
 * 05.09.2026, разбор по DBS-заказу NGS22UR. Владелец не смог найти заказ ни по
 * коду гейта, ни по номеру заказа WB. Причин оказалось три, и ни одна не видна
 * из кода поиска:
 *
 *  1. К запросу подмешивались границы вкладки и сужение шапки — заказ из
 *     «Ждут ссылку» не находился, пока стоишь в «К выкупу».
 *  2. Пустая лента подменялась `EmptyState`, а группы «WB Доставка» и
 *     «Геймпассы Roblox» рисовались ВНУТРИ ветки со списком. Сервер отдавал
 *     DBS-заказ, экран показывал «ничего не найдено».
 *  3. Ответ поиска ждал Roblox: на код гейта уходил поиск ника через мост с
 *     таймаутом 20 с, и всё это время не отдавались даже готовые строки БД.
 *
 * Каждая из трёх — однострочная и возвращается незаметно, поэтому закреплены
 * тестом по исходнику.
 */

const ordersRoute = readFileSync(
  join(process.cwd(), "src/app/api/twa/orders/route.ts"),
  "utf8",
);
const searchRoute = readFileSync(
  join(process.cwd(), "src/app/api/twa/search/route.ts"),
  "utf8",
);
const screen = readFileSync(
  join(process.cwd(), "src/app/twa/_components/screens/OrdersScreen.tsx"),
  "utf8",
);

describe("Поиск в ленте заказов идёт по всей базе", () => {
  it("запрос не сужается вкладкой, источником и сужением шапки", () => {
    expect(ordersRoute).toContain("const where = q\n    ? { AND: [notTest, searchWhere] }");
  });

  it("вкладочные режимы выборки в поиске не участвуют", () => {
    expect(ordersRoute).toMatch(/let ordersPromise: Promise<any\[\]>;\s*\n\s*if \(q\) \{/);
  });

  it("ищем и по вероятному нику, а не только по заметке", () => {
    expect(ordersRoute).toContain('{ probableNick:   { contains: qClean,      mode: "insensitive" } }');
  });
});

describe("Найденное показывается даже при пустой ленте", () => {
  it("живая выдача вынесена из ветки со списком", () => {
    expect(screen).toContain("const liveResults = query ? (");
    // Ровно два места отрисовки: пустое состояние и лента.
    expect(screen.match(/\{liveResults\}/g)?.length).toBe(2);
  });

  it("под найденной строкой DBS не пишем «ничего не нашлось»", () => {
    expect(screen).toContain("const hasLiveResults = !!live && (live.dbs.length > 0 || live.gamepasses.length > 0);");
    expect(screen).toContain("Среди заказов совпадений нет — только то, что выше");
  });

  it("найденная карточка живёт по правилам своей вкладки", () => {
    expect(screen).toContain("currentTab={query ? orderToTab(order) : isAttentionView ? \"ATTENTION\" : filter}");
  });
});

describe("База не ждёт Roblox", () => {
  it("у поиска две половины и они запрашиваются порознь", () => {
    expect(searchRoute).toContain('const wantDb = scope === "all" || scope === "db";');
    expect(searchRoute).toContain('const robloxAllowed = scope === "all" || scope === "roblox";');
    expect(screen).toContain('const ask = async (scope: "db" | "roblox") =>');
  });

  it("с кодом гейта и номером заказа WB в Roblox не ходим", () => {
    expect(searchRoute).toContain("if (/^\\d{4,}$/.test(clean) || await isOurCode(clean)) return [];");
  });

  it("«наш код» определяется по базе, а не по маске — иначе ник из 7 символов перестанет искаться", () => {
    expect(searchRoute).toContain("await prisma.wbCode.count({ where: { code } })");
  });
});
