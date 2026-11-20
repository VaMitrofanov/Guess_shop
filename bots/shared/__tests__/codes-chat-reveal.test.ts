/**
 * Код в чате — запечатанный (21.11.2026): владелец хочет видеть, КОГДА
 * покупатель открыл код («код может быть плохой, либо он хочет нас обмануть»).
 * В чате значение кода не приходит в сообщении — только по кнопке.
 */
import fs from "node:fs";
import path from "node:path";
import { CODES_CB, CODES_REVEAL_RE, codeChatIssuedText, codeChatSealedText, codeChatTgKeyboard } from "../codes-shop";
import { revealFailText } from "../codes-bot-api";

describe("запечатанный код в чате", () => {
  test("в конверте нет значения кода, есть кнопка «Показать» и инструкция", () => {
    const t = codeChatSealedText({ denomination: 500, publicId: "CODE-DA9VG478" });
    expect(t.html).toContain("Код запечатан");
    expect(t.html).toContain("Показать код");
    expect(t.html).not.toContain("<code>");
    const kb = codeChatTgKeyboard({ publicId: "CODE-DA9VG478" });
    const first = kb.inline_keyboard[0][0] as { callback_data?: string };
    expect(first.callback_data).toBe(CODES_CB.reveal("CODE-DA9VG478"));
    expect(CODES_REVEAL_RE.exec(first.callback_data!)?.[1]).toBe("CODE-DA9VG478");
    // callback_data у TG — максимум 64 байта.
    expect(Buffer.byteLength(first.callback_data!)).toBeLessThanOrEqual(64);
  });

  test("набор из двух кодов — «коды» во множественном", () => {
    const t = codeChatSealedText({ denomination: 2000, publicId: "CODE-AAAAAAAA", count: 2 });
    expect(t.plain).toContain("2 кода");
    expect(t.plain).toContain("Коды запечатаны");
    expect((codeChatTgKeyboard({ publicId: "CODE-AAAAAAAA", count: 2 }).inline_keyboard[0][0] as { text: string }).text).toBe("👁 Показать коды");
  });

  test("после открытия — код без второго спойлера и кнопка копирования", () => {
    const t = codeChatIssuedText({ denomination: 500, code: "ABCD-1234", publicId: "CODE-DA9VG478", opened: true });
    expect(t.html).toContain("🔓");
    expect(t.html).toContain("<code>ABCD-1234</code>");
    expect(t.html).not.toContain("tg-spoiler");
    const kb = codeChatTgKeyboard({ publicId: "CODE-DA9VG478", codes: ["ABCD-1234"] });
    expect(kb.inline_keyboard[0][0]).toMatchObject({ copy_text: { text: "ABCD-1234" } });
  });

  test("отказы объяснены по-человечески и без «ты»", () => {
    for (const s of ["not_found", "gifted", "refunded", "not_issued", "error"]) {
      expect(revealFailText(s).length).toBeGreaterThan(10);
      expect(revealFailText(s)).not.toMatch(/\bты\b|\bтебе\b|\bтвой\b/i);
    }
  });

  test("сайт отдаёт код только создателю заказа и отмечает первое открытие", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/app/api/internal/codes/reveal/route.ts"), "utf8");
    expect(src).toContain('creator: platform === "TG" ? { tgId: subject } : { vkId: subject }');
    expect(src).toContain("revealedAt: null");
    expect(src).toContain("notifyCodeOpened(");
    const chat = fs.readFileSync(path.join(process.cwd(), "src/lib/codes/chat-notify.ts"), "utf8");
    expect(chat).toContain("codeChatSealedText(");
    expect(chat).not.toContain("codeChatIssuedText(");
  });
});
