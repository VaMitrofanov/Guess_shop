import { readFileSync } from "node:fs";
import { join } from "node:path";

/* Форма поверх карточки — правило, которое ломается молча.
 *
 * 05.09.2026: из меню «···» → «Редактировать заказ» на телефоне открывалась
 * карточка-просмотр, а самой формы не было видно (скрин владельца по NGS22UR).
 * Причина не в логике: обе шторки — порталы в `body` с одинаковым `z-index`,
 * и выше оказывалась та, чей узел встал в DOM последним. Когда меню открывает
 * лист и форму одним коммитом, вложенный портал формы встаёт РАНЬШЕ
 * родительского — правка уходила под затемнение карточки, вместе со всеми
 * своими полями и кнопками.
 *
 * Симптом («не могу вставить ссылку») ничем не похож на причину (порядок
 * узлов в `body`), поэтому правило закреплено тестом: разница в слое, а не
 * везение с порядком монтирования.
 */

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
const screen = readFileSync(
  join(process.cwd(), "src/app/twa/_components/screens/OrdersScreen.tsx"),
  "utf8",
);

describe("Шторка с формой всегда над карточкой-просмотром", () => {
  it("у слоя формы свой z-index", () => {
    expect(css).toContain('.twa-sheet-layer:has(.twa-form-sheet) { z-index: 80; }');
  });

  it("базовый слой шторок остался на 70 — форма ровно на один этаж выше", () => {
    expect(css).toMatch(/\.twa-sheet-layer,\s*\n\.twa-order-sheet-layer \{[^}]*z-index: 70;/);
  });

  it("тост остаётся выше обеих шторок", () => {
    const toast = readFileSync(
      join(process.cwd(), "src/app/twa/_components/Toast.tsx"),
      "utf8",
    );
    expect(toast).toContain("zIndex: 100");
  });
});

describe("Форма, открытая из меню «···», попадает в поле зрения", () => {
  it("меню разворачивает лист и ведёт к якорю формы", () => {
    expect(screen).toContain("setSheetExpanded(true);");
    expect(screen).toContain('if (anchor) setScrollTo(anchor);');
    expect(screen).toContain('?.querySelector<HTMLElement>(`[data-form="${scrollTo}"]`)');
  });

  it("у каждой формы досье есть якорь", () => {
    for (const form of ["attach", "hold", "reject", "move", "split", "refund", "rebind"]) {
      expect(screen).toContain(`data-form="${form}"`);
    }
  });
});

describe("Ссылку на геймпасс можно вставить руками", () => {
  it("действие есть в меню заказа", () => {
    expect(screen).toContain('row("attach", "🔗", "Вставить ссылку на геймпасс"');
  });

  it("форма шлёт attach-gamepass и проверяет цену до привязки", () => {
    expect(screen).toContain('action: "attach-gamepass", orderId: order.id');
    expect(screen).toContain('action: "manual-validate", gamepassUrl: raw, amount: order.amount');
  });
});
