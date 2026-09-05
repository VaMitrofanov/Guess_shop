import { readFileSync } from "node:fs";
import { join } from "node:path";

/* Набор текста не должен двигать геометрию шторки.
 *
 * 31.08.2026, вторая половина того же разбора, что и в
 * `bottom-sheet-focus.test.ts`: фокус в поле держался, а ввод всё равно «лагал
 * и вылетал». Замер в браузере показал 10 записей `--twa-visual-height` на 10
 * символов — переменная переписывалась на каждый `visualViewport.scroll`,
 * который iOS шлёт на микро-панораму во время набора. Ею заданы высота всего
 * стеклянного корпуса и `max-height` шторки с `transition` — то есть каждый
 * символ перезапускал анимацию геометрии поверх слоёв с блюром, встречно тому,
 * как iOS сам подкручивает страницу к полю.
 *
 * Порог получила тогда только вторая переменная (`--twa-keyboard-inset`).
 * Здесь закрыты обе половины: панорама больше не меряет высоту, высота пишется
 * только при реальном изменении, а форма не анимирует геометрию, которую
 * двигает клавиатура.
 *
 * Тест смотрит на исходник: и то и другое возвращается одним движением, а
 * поймать это можно только руками на телефоне.
 */

const guard = readFileSync(
  join(process.cwd(), "src/app/twa/_components/TwaViewportGuard.tsx"),
  "utf8",
);
const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

describe("TwaViewportGuard не дёргает переменные на каждый ввод", () => {
  it("панорама не меряет высоту окна — только смещение", () => {
    expect(guard).toContain('visualViewport?.addEventListener("scroll", syncOffsetOnly)');
    expect(guard).not.toContain('visualViewport?.addEventListener("scroll", syncViewport)');
  });

  it("высота пишется только при реальном изменении", () => {
    expect(guard).toContain("Math.abs(rounded - lastHeight) > 2");
  });

  it("порог отступа под клавиатуру на месте", () => {
    expect(guard).toContain("Math.abs(inset - lastInset) > 8");
  });

  it("обе переменные всё ещё выставляются и убираются", () => {
    expect(guard).toContain('root.style.setProperty("--twa-visual-height"');
    expect(guard).toContain('root.style.setProperty("--twa-keyboard-inset"');
    expect(guard).toContain('root.style.removeProperty("--twa-visual-height")');
    expect(guard).toContain('root.style.removeProperty("--twa-keyboard-inset")');
  });
});

describe("Лист заказа не анимирует то, что двигает клавиатура", () => {
  it("у формы сняты переходы высоты и отступа", () => {
    expect(css).toContain(".twa-form-sheet { transition: none; }");
    expect(css).toContain(".twa-sheet-layer:has(.twa-form-sheet) { transition: none; }");
  });

  it("карточке заказа плавность оставлена — её разворачивают жестом", () => {
    expect(css).toContain("transition: max-height .25s cubic-bezier(.22,1,.36,1);");
  });
});
