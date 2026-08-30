import { readFileSync } from "node:fs";
import { join } from "node:path";

/* Шторка не должна пересобираться на каждый рендер.
 *
 * 31.08.2026: в форме заказа «любое поле лагало и вылетало» — каждый введённый
 * символ выбивал фокус и ронял клавиатуру. Причина не в форме: эффект
 * `BottomSheet` зависел от `onClose`, а все потребители передают инлайновую
 * стрелку — новую функцию на каждый рендер. Эффект разбирался и собирался
 * заново, а в его уборке стоит `returnFocusRef.current?.focus()`, то есть
 * возврат фокуса ТУДА, ОТКУДА шторку открыли.
 *
 * В шторках-просмотрах это не замечали годами: они перерисовываются редко.
 * Форма перерисовывается на каждое нажатие клавиши — и баг стал постоянным.
 *
 * Тест смотрит на исходник: вернуть `onClose` в зависимости эффекта можно одним
 * движением, а поймать это можно только руками на телефоне.
 */

const source = readFileSync(
  join(process.cwd(), "src/app/twa/_components/BottomSheet.tsx"),
  "utf8",
);

describe("BottomSheet собирается один раз на открытие", () => {
  it("эффект зависит только от open", () => {
    expect(source).toContain("}, [open]);");
    expect(source).not.toContain("}, [onClose, open]);");
  });

  it("актуальный onClose берётся из ref, а не из замыкания эффекта", () => {
    expect(source).toContain("const onCloseRef = useRef(onClose);");
    expect(source).toContain("onCloseRef.current()");
  });

  it("возврат фокуса остался — он нужен при ЗАКРЫТИИ, а не на каждый рендер", () => {
    expect(source).toContain("returnFocusRef.current?.focus()");
  });

  it("фокус-ловушка и блокировка скролла на месте", () => {
    expect(source).toContain('document.body.style.overflow = "hidden"');
    expect(source).toContain("createPortal");
  });
});
