import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");

describe("TWA and admin notification regressions", () => {
  test("replayed Telegram deep links do not fan out another new-client card", () => {
    const source = read("bots/tg/handlers.ts");

    expect(source).toContain("let provisionalCreated = false;");
    expect(source).toContain("provisionalCreated = true;");
    // К идемпотентности добавился второй гард: у DBS-заказа активация кода
    // уходит строкой в таймлайн живой карточки, а не вторым сообщением о том
    // же заказе (единая нить заказа, 02.09.2026).
    expect(source).toContain('if (provisionalCreated && !foldedIntoDbsCard && provisionalOrder?.status === "AWAITING_GAMEPASS")');
    // С 05.09.2026 вход несёт ещё и личность покупателя: имя, ссылку и «новый
    // ли он» — они стали строкой в самой карточке вместо отдельного сообщения.
    expect(source).toContain('noteDbsBuyerSignedIn(db, code, "TG", {');
  });

  test("toast is portalled above the order bottom sheet", () => {
    const source = read("src/app/twa/_components/Toast.tsx");

    expect(source).toContain('import { createPortal } from "react-dom";');
    expect(source).toContain("return createPortal(");
    expect(source).toContain("document.body");
    expect(source).toContain("zIndex: 100");
  });
});
