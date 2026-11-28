/* Шторка ТВА не «шатается» (11.11.2026, скрин владельца 79PT6B3): строка
   меток распирала шторку, шторка ездила вбок, а фокус на поле раскрывал её и
   поле улетало. Каждое правило ниже — одна из причин. */
import fs from "node:fs";
import path from "node:path";

const read = (f: string) => fs.readFileSync(path.join(__dirname, "..", "..", f), "utf8");
const css = read("src/app/globals.css");
const sheet = read("src/app/twa/_components/BottomSheet.tsx");

describe("шторка ТВА не шатается", () => {
  it("прокрутка шторки только вертикальная", () => {
    expect(css).toMatch(/\.twa-sheet-scroll \{[^}]*overflow-x: hidden;[^}]*overflow-y: auto;/);
    expect(sheet).toContain("if (el.scrollLeft !== 0) el.scrollLeft = 0;");
  });
  it("строка меток переносится, а не распирает", () => {
    expect(css).toMatch(/\.twa-oc-top \{[^}]*flex-wrap: wrap;/);
  });
  it("корень ТВА режется clip — его не прокрутить программно при фокусе", () => {
    expect(css).toMatch(/\.twa-liquid-root \{[^}]*overflow: clip;/);
  });
  it("открытие не двигает прокрутку, раскрывает только палец, поле в фокусе по центру", () => {
    expect(sheet).toContain("focus({ preventScroll: true })");
    expect(sheet).toContain("if (Date.now() - lastTouchAt.current > 900) return;");
    expect(sheet).toContain('scroller.addEventListener("focusin", onFocusIn);');
  });
});
