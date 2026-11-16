import { buildDbsChatStatus, dbsChatMarkup } from "../dbs-chat-status";

const now = new Date("2026-11-16T14:10:00Z");
const at = (iso: string) => new Date(iso);
const base = {
  now, cancelled: false, gateState: "SENT", chatState: "CODE_RECEIVED", code: "ZQMQ6CJ",
  internal: null, contact: null, lastSeller: null,
  events: [
    { type: "DELIVERY_CODE_REQUESTED", createdAt: at("2026-11-15T04:51:00Z") },
    { type: "AUTO_GATE_ISSUED_AND_SENT", createdAt: at("2026-11-15T07:37:00Z") },
    { type: "GATE_REMINDER_SENT", createdAt: at("2026-11-15T10:42:00Z") },
  ],
};
const texts = (m: ReturnType<typeof dbsChatMarkup>) => m.inline_keyboard.flat().map((b) => b.text);

describe("увед «покупатель пишет»: что уже ушло и кнопки по этапу (16.11.2026)", () => {
  it("гейт ушёл, код не открыт — статус шагов и «Инструкция»", () => {
    const status = buildDbsChatStatus(base);
    expect(status.stage).toBe("gate_sent");
    expect(status.lines.join("\n")).toMatch(/попросили код получения 15\.11 07:51 → гейт с кодом 15\.11 10:37 → напоминание 15\.11 13:42/);
    expect(texts(dbsChatMarkup("1", status))).toEqual(["📖 Инструкция", "✍️ Ответ в WB", "📱 Открыть в TWA"]);
  });

  it("покупатель уже в боте — ведём в его диалог, а не в шаблоны WB", () => {
    const status = buildDbsChatStatus({
      ...base,
      internal: { status: "AWAITING_GAMEPASS", robloxUsername: null, gamepassUrl: null },
      contact: { tgUsername: "ianaavi", vkId: null },
      lastSeller: { text: "какой вопрос ?", at: at("2026-11-16T06:58:00Z") },
    });
    expect(status.stage).toBe("activated");
    expect(status.lines[0]).toMatch(/Код открыт в боте · ника нет, пасса нет/);
    expect(status.lines.join("\n")).toMatch(/Последнее от нас 09:58: <i>какой вопрос \?<\/i>/);
    const markup = dbsChatMarkup("1", status);
    expect(texts(markup)).toEqual(["💬 Написать в TG @ianaavi", "✍️ Ответ в WB", "📱 Открыть в TWA"]);
    expect(markup.inline_keyboard[0][0].url).toBe("https://t.me/ianaavi");
  });

  it("ждём код получения — «Пришлите код» и «Курьера нет»", () => {
    const status = buildDbsChatStatus({ ...base, gateState: "NOT_ISSUED", chatState: "WAITING_CODE", events: [] });
    expect(status.stage).toBe("before_code");
    expect(texts(dbsChatMarkup("1", status)).slice(0, 2)).toEqual(["🔑 Пришлите код", "🚚 Курьера нет"]);
  });

  it("отменён — только свой ответ и TWA", () => {
    const status = buildDbsChatStatus({ ...base, cancelled: true });
    expect(texts(dbsChatMarkup("1", status))).toEqual(["✍️ Ответ в WB", "📱 Открыть в TWA"]);
  });
});
