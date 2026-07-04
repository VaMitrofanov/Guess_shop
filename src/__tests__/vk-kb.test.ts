/**
 * Лимиты VK inline-клавиатур (bots/shared/vk-kb.ts).
 *
 * Класс бага, который ловим: пикер геймпассов прямого заказа строил 7 рядов
 * (5 пассов + «Другой ник» + «Назад/Отменить») при лимите VK в 6 рядов —
 * VK отвергал сообщение, заказ падал в «⚠️ Произошла ошибка» (P0 2026-07-04).
 */
import {
  enforceVkInlineKbLimits,
  VK_INLINE_MAX_BUTTONS,
  VK_INLINE_MAX_ROWS,
  VK_INLINE_MAX_PER_ROW,
} from "../../bots/shared/vk-kb";

function btn(label: string) {
  return { action: { type: "text", label, payload: "{}" }, color: "primary" };
}
/** rows = число кнопок в каждом ряду, например [1,1,2] → 3 ряда. */
function kb(rows: number[]) {
  const buttons = rows.map((n, i) => Array.from({ length: n }, (_, j) => btn(`b${i}-${j}`)));
  return { inline: true, buttons };
}
function parse(json: string): { inline: boolean; buttons: unknown[][] } {
  return JSON.parse(json);
}

describe("enforceVkInlineKbLimits", () => {
  it("клавиатуру в лимитах не трогает (6 рядов, 8 кнопок — фикс прямого заказа)", () => {
    const input = kb([1, 1, 1, 1, 1, 3]); // 5 пассов + сервисный ряд из 3
    const out = parse(enforceVkInlineKbLimits(input));
    expect(out.buttons).toHaveLength(6);
    expect(out.buttons.flat()).toHaveLength(8);
    expect(out).toEqual(input);
  });

  it("7 рядов (сломанный пикер) → усекает до 6, сервисный ряд сохраняется последним", () => {
    // Репро ypa_0982: 5 пассов×ряд + ряд «Другой ник» + ряд «Назад/Отменить»
    const input = kb([1, 1, 1, 1, 1, 1, 2]);
    const out = parse(enforceVkInlineKbLimits(input, "test"));
    expect(out.buttons.length).toBeLessThanOrEqual(VK_INLINE_MAX_ROWS);
    expect(out.buttons.flat().length).toBeLessThanOrEqual(VK_INLINE_MAX_BUTTONS);
    // последний ряд входа (сервисные кнопки) — последний ряд выхода
    const lastIn = (input.buttons.at(-1) as { action: { label: string } }[]).map(b => b.action.label);
    const lastOut = (out.buttons.at(-1) as { action: { label: string } }[]).map(b => b.action.label);
    expect(lastOut).toEqual(lastIn);
  });

  it(">10 кнопок → усекает по кнопкам, сервисный ряд жив", () => {
    const input = kb([4, 4, 4, 2]); // 14 кнопок в 4 рядах
    const out = parse(enforceVkInlineKbLimits(input));
    expect(out.buttons.flat().length).toBeLessThanOrEqual(VK_INLINE_MAX_BUTTONS);
    const lastOut = (out.buttons.at(-1) as { action: { label: string } }[]).map(b => b.action.label);
    expect(lastOut).toEqual(["b3-0", "b3-1"]);
  });

  it("ряд длиннее 5 кнопок → усекается до 5", () => {
    const input = kb([7]);
    const out = parse(enforceVkInlineKbLimits(input));
    expect((out.buttons[0] as unknown[]).length).toBe(VK_INLINE_MAX_PER_ROW);
  });

  it("не-клавиатурный ввод возвращает как есть", () => {
    expect(enforceVkInlineKbLimits("не json")).toBe("не json");
    expect(enforceVkInlineKbLimits({ foo: 1 })).toBe(JSON.stringify({ foo: 1 }));
  });
});
