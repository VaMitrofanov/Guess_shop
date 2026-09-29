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

  // Регресс P0 2026-07-05/06: vk-io KeyboardBuilder сериализуется в формат VK
  // только через toString(); JSON.stringify(builder) отдаёт внутренние поля
  // (isInline/rows/currentRow) без `buttons` → VK 911 «buttons property should
  // be array» → все прямые заказы VK падали в «⚠️ Произошла ошибка». Тесты выше
  // гоняют plain-объекты и регресс не ловили. FakeBuilder воспроизводит контракт
  // vk-io (проверен на настоящем vk-io 4.9: JSON.stringify ≠ String); сам vk-io
  // в jest не импортируется (ESM).
  class FakeBuilder {
    isOneTime = false;
    isInline = true;
    rows: unknown[][] = [];
    currentRow: unknown[] = [];
    add(label: string) { this.currentRow.push(btn(label)); return this; }
    row() { if (this.currentRow.length) { this.rows.push(this.currentRow); this.currentRow = []; } return this; }
    inline() { return this; }
    toString(): string {
      const buttons = this.currentRow.length ? [...this.rows, this.currentRow] : this.rows;
      return JSON.stringify({ one_time: this.isOneTime, inline: this.isInline, buttons });
    }
  }

  it("KeyboardBuilder (toString-контракт vk-io) → валидный VK-формат с buttons", () => {
    const builder = new FakeBuilder().add("💎 pass · 1143 R$").row().add("🔎 Другой ник");
    const out = parse(enforceVkInlineKbLimits(builder.inline(), "test"));
    expect(Array.isArray(out.buttons)).toBe(true);
    expect(out.buttons).toHaveLength(2);
    expect(out).not.toHaveProperty("rows");
    expect(out).not.toHaveProperty("currentRow");
  });

  it("билдер за лимитами (7 рядов) тоже усекается, сервисный ряд жив", () => {
    const builder = new FakeBuilder();
    for (let i = 0; i < 6; i++) builder.add(`p${i}`).row();
    builder.add("🔎 Другой ник");
    const out = parse(enforceVkInlineKbLimits(builder.inline(), "test"));
    expect(out.buttons.length).toBeLessThanOrEqual(VK_INLINE_MAX_ROWS);
    const last = (out.buttons.at(-1) as { action: { label: string } }[]).map(b => b.action.label);
    expect(last).toEqual(["🔎 Другой ник"]);
  });
});
