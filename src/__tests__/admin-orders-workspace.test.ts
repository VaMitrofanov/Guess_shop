import { readFileSync } from "fs";
import path from "path";

const root = path.join(__dirname, "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

const workspace = read("components/admin/orders/orders-workspace.tsx");
const dossier = read("components/admin/orders/order-dossier.tsx");
const palette = read("components/admin/orders/command-palette.tsx");
const page = read("app/admin/(protected)/orders/page.tsx");
const aliasRoute = read("app/api/admin/orders/route.ts");
const twaScreen = read("app/twa/_components/screens/OrdersScreen.tsx");
const css = read("components/admin/orders/orders.module.css");

/* Контракт рабочего места «Заказы» на сайте (этапы В1–В5). Тест держит не
   вёрстку, а обещания, на которых экран построен: одно правило представления
   на два экрана, одна дверь к деньгам, честная отмена и заморозка, которая
   бьёт всё остальное. */
describe("Заказы на сайте: рабочее место, а не витрина", () => {
  it("правило представления одно на сайт и TWA", () => {
    expect(workspace).toContain('from "@/lib/order-presentation"');
    expect(dossier).toContain('from "@/lib/order-presentation"');
    // TWA не держит вторую копию: её функции делегируют в общий модуль.
    expect(twaScreen).toContain("sharedPrimaryAction");
    expect(twaScreen).toContain("sharedOrderFlag");
    expect(twaScreen).toContain("sharedOrderBadge");
  });

  it("ходит в один канонический роут, а не в чужой префикс", () => {
    expect(aliasRoute).toContain('export { GET, POST } from "@/app/api/twa/orders/route"');
    expect(workspace).toContain('"/api/admin/orders"');
    // Проверяем именно вызовы: в шапке файла старый адрес назван как история.
    expect(workspace).not.toMatch(/fetch\(\s*[`"]\/api\/twa/);
    expect(dossier).not.toMatch(/fetch\(\s*[`"]\/api\/twa/);
    expect(palette).not.toMatch(/fetch\(\s*[`"]\/api\/twa/);
  });

  it("держит срезы работы, а не фильтр по источнику", () => {
    expect(workspace).toContain("SLICE_META.map");
    expect(page).toContain("SLICE_KEYS");
    // Старые ссылки `?source=WB` не должны отдавать пустой экран.
    expect(page).toContain('pick("source")');
  });

  it("адрес — это состояние: срез, режим и открытый заказ лежат в URL", () => {
    expect(workspace).toContain('params.set("slice", slice)');
    expect(workspace).toContain('params.set("order", openId)');
    expect(workspace).toContain("window.history.replaceState");
  });

  it("обещает отмену только там, где у действия есть обратное", () => {
    // «Выкуплено» необратимо: клиенту уже ушло сообщение.
    const completeCall = workspace.slice(workspace.indexOf("const complete = useCallback"), workspace.indexOf("const restore = useCallback"));
    expect(completeCall).toContain("leaves: true");
    expect(completeCall).not.toContain("inverse");
    // А заморозка и «в ошибку» — обратимы, и это записано явно.
    expect(workspace).toContain('inverse: { action: "unhold" }');
    expect(workspace).toContain('inverse: { action: "restore-to-buyout" }');
  });

  it("не выкупает пачкой молча: необратимое спрашивает подтверждение", () => {
    const bulk = workspace.slice(workspace.indexOf("const bulkComplete"), workspace.indexOf("const bulkHold"));
    expect(bulk).toContain("askFor");
    expect(bulk).toContain("Каждому клиенту уйдёт сообщение");
  });

  it("замороженный заказ не попадает в пачку даже диапазоном", () => {
    expect(workspace).toContain("if (candidate && !isHeld(candidate)) next.add(candidate.id)");
    expect(workspace).toContain("disabled={isHeld(order)}");
  });

  it("клавиатура закрывает цикл выкупа без мыши", () => {
    for (const key of ['case "j"', 'case "k"', 'case "Enter"', 'case " "', 'event.key === "Enter"']) {
      expect(workspace).toContain(key);
    }
    expect(workspace).toContain('key === "c"'); // копирование ID пасса
    expect(workspace).toContain('key === "f"'); // заморозка
    expect(workspace).toContain("metaKey || event.ctrlKey");
  });

  it("⌘K — единственный поиск: он же ищет и он же выполняет", () => {
    expect(palette).toContain("Код ВБ, ник Roblox, @username, ID пасса, номер заказа WB");
    expect(palette).toContain("cmd-export");
    expect(palette).toContain("cmd-complete");
  });

  it("полоса среза считается сервером и сужает ленту", () => {
    expect(workspace).toContain("function SliceStrip");
    expect(workspace).toContain("onNarrow({ lane: lane.id })");
    expect(workspace).toContain("onNarrow({ blocked:");
    expect(workspace).toContain("onNarrow({ age: bucket.id })");
  });

  it("двух панелей и клавиатуры хватает на 16″ MacBook, а телефон получает карточки", () => {
    expect(css).toContain("minmax(340px, 400px) minmax(0, 1fr)");
    expect(css).toMatch(/@media \(max-width: 767px\)/);
    expect(css).toContain("env(safe-area-inset-bottom)");
  });
});
