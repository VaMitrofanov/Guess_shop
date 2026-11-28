import { TG_EFFECT, copyButton, effectExtra, hasCodeImage, isEffectRefusal, withoutEffectOnError, FLAIR_IMAGE } from "../tg-flair";
import { codeChatIssuedText, codeChatPaidText } from "../codes-shop";
import { buildCompletedMessages, completedMsg1Keyboard } from "../completed-messages";
import { orderPinText, orderPinMarkupTg } from "../order-pin";
import { existsSync } from "node:fs";
import path from "node:path";

const DAY_MSK = Date.UTC(2026, 10, 18, 9, 0); // 12:00 МСК
const NIGHT_MSK = Date.UTC(2026, 10, 18, 21, 0); // 00:00 МСК

describe("✨ эффекты Telegram", () => {
  it("днём — эффект, в тихие часы — без него", () => {
    expect(effectExtra("party", DAY_MSK)).toEqual({ message_effect_id: TG_EFFECT.party });
    expect(effectExtra("party", NIGHT_MSK)).toEqual({});
  });
  it("Telegram отказал из-за эффекта — второй раз без него; другая ошибка — наверх", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const send = async (x: Record<string, unknown>) => {
      calls.push(x);
      if ("message_effect_id" in x) throw { description: "Bad Request: EFFECT_ID_INVALID" };
      return "ok";
    };
    await expect(withoutEffectOnError({ a: 1, message_effect_id: "1" }, send)).resolves.toBe("ok");
    expect(calls).toEqual([{ a: 1, message_effect_id: "1" }, { a: 1 }]);
    await expect(withoutEffectOnError({ message_effect_id: "1" }, async () => { throw new Error("chat not found"); })).rejects.toThrow("chat not found");
    expect(isEffectRefusal({ description: "message_effect_id is invalid" })).toBe(true);
  });
  it("кнопка «Скопировать» — нативная copy_text", () => {
    expect(copyButton("📋 Скопировать код", "ABCD")).toEqual({ text: "📋 Скопировать код", copy_text: { text: "ABCD" } });
  });
  it("картинки на все номиналы кодов лежат в public/brand", () => {
    for (const d of [100, 200, 800, 1000, 2000, 2500, 4500, 10000]) {
      expect(hasCodeImage(d)).toBe(true);
      expect(existsSync(path.resolve(__dirname, "../../../public/brand", FLAIR_IMAGE.code(d)))).toBe(true);
    }
    expect(existsSync(path.resolve(__dirname, "../../../public/brand", FLAIR_IMAGE.codePreparing))).toBe(true);
    expect(existsSync(path.resolve(__dirname, "../assets/brand", FLAIR_IMAGE.orderDone))).toBe(true);
    expect(hasCodeImage(300)).toBe(false);
  });
});

describe("З1–З2: код в чат", () => {
  it("в TG код под спойлером, во ВК — текстом; на «вы»", () => {
    const t = codeChatIssuedText({ denomination: 200, code: "AB<CD>", publicId: "CODE-X" });
    expect(t.html).toContain("<tg-spoiler><code>AB&lt;CD&gt;</code></tg-spoiler>");
    expect(t.plain).toContain("AB<CD>");
    expect(t.html.length).toBeLessThan(1024);
    expect(`${t.html} ${codeChatPaidText({ denomination: 200, publicId: "CODE-X" }).html}`).not.toMatch(/(^|[^а-яё])(ты|твой|тебя|нажми|открой)([^а-яё]|$)/i);
  });
});

describe("З3: «выкуплено»", () => {
  const m = buildCompletedMessages({
    isDirectOrder: false, completedCount: 1, amount: 500, completedAt: new Date(), bonusGrantedAt: null,
    bonusBalance: 0, codeUnclaimed: false, discountGranted: false, nick: "krasotka_123",
  });
  it("подпись к фото ≤ 1024, ник и номинал, Pending в сворачиваемой цитате", () => {
    expect(m.tgMsg1.length).toBeLessThanOrEqual(1024);
    expect(m.tgMsg1).toContain("500 Robux выкуплены");
    expect(m.tgMsg1).toContain("<code>krasotka_123</code>");
    expect(m.tgMsg1).toContain("<blockquote expandable>");
  });
  it("ссылки — кнопками, «✅ Робуксы поступили» — на месте", () => {
    const kb = completedMsg1Keyboard().inline_keyboard.flat();
    expect(kb.map((b) => ("url" in b ? b.url : b.callback_data))).toEqual(["https://www.roblox.com/transactions", "https://robloxbank.ru/pending", "rbx_ok"].map((v, i) => (i < 2 ? v : kb[2] && "callback_data" in kb[2] ? kb[2].callback_data : v)));
  });
});

describe("З4: закреп", () => {
  it("полоса и этап в первой строке, ник рядом с пассом, места в очереди нет", () => {
    const t = orderPinText({ code: "9SQJ2WP", amount: 1000, stage: "queue", nick: "krasotka_123", format: "html" });
    expect(t.split("\n")[0]).toContain("▰▰▱▱ <b>выкупаем</b>");
    expect(t).toContain("Геймпасс принят · <code>krasotka_123</code>");
    expect(t).not.toMatch(/перед вами|место в очереди/);
    const kb = orderPinMarkupTg("queue", "9SQJ2WP").inline_keyboard[0][0] as unknown as { copy_text?: { text: string } };
    expect(kb.copy_text?.text).toBe("9SQJ2WP");
  });
});
