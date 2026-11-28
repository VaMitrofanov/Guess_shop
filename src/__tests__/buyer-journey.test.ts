import { buyerJourney, journeySinceText, trimJourneyPayload, GUIDE_OPENED_EVENT } from "@/lib/buyer-journey";

const T0 = Date.parse("2026-10-28T10:00:00Z");
const at = (h: number) => new Date(T0 + h * 3_600_000).toISOString();

const base = {
  status: "AWAITING_GAMEPASS",
  wbCode: "7HQK2PZ",
  createdAt: at(0),
  robloxUsername: null,
  probableNick: null,
  channel: "tg" as const,
};

describe("путь покупателя", () => {
  it("ждём то, что последним отправили, и говорим, открыл ли инструкцию", () => {
    const j = buyerJourney(base, [
      { type: "BUYER_STEP_SENT", payload: { kind: "key", channel: "tg", by: "Вадим" }, createdAt: at(1) },
      { type: GUIDE_OPENED_EVENT, payload: { stage: "key", device: "mobile" }, createdAt: at(1.1) },
    ], null, T0 + 3 * 3_600_000);
    expect(j.now.text).toBe("⏳ Ждём ключ");
    expect(j.now.detail).toBe("инструкцию открыл");
    expect(journeySinceText(j, T0 + 3 * 3_600_000)).toBe("2 ч");
    expect(j.touches[0].text).toContain("Открыл инструкцию по ключу");
    // Кто отправил — только в истории, не в тексте касания.
    expect(j.touches[1].text).toBe("📨 Отправили: Ключ");
    expect(j.touches[1].by).toBe("Вадим");
  });

  it("не открыл инструкцию за 6 ч — предлагаем написать лично", () => {
    const j = buyerJourney(base, [
      { type: "BUYER_STEP_SENT", payload: { kind: "key", channel: "tg" }, createdAt: at(1) },
    ], null, T0 + 8 * 3_600_000);
    expect(j.next?.kind).toBe("contact");
    expect(j.now.detail).toBe("инструкцию не открыл");
  });

  it("бот не понял — даём ту часть, где застрял", () => {
    const j = buyerJourney({ ...base, probableNick: "mikha" }, [
      { type: "BOT_DEAD_END", payload: { reason: "link_format" }, createdAt: at(1) },
    ], null, T0 + 2 * 3_600_000);
    expect(j.now.text).toBe("😵 Бот не понял");
    expect(j.next).toMatchObject({ kind: "step", step: "passid" });
  });

  it("ник известен, ничего не ломалось — проверить пассы ника", () => {
    const j = buyerJourney({ ...base, robloxUsername: "lox23" }, [], null, T0 + 3_600_000);
    expect(j.next?.kind).toBe("nick-passes");
    expect(j.steps.map((s) => s.state)).toEqual(["done", "done", "current", "todo", "todo"]);
  });

  it("цена пасса не та — «Продажа и цена»; в ERROR отправить нельзя, только написать", () => {
    const withPass = { ...base, status: "PENDING", robloxUsername: "lox23", gamepassId: "1" };
    const j = buyerJourney(withPass, [], { priceMismatch: true, livePrice: 1100, expected: 1143 }, T0);
    expect(j.now.text).toBe(`⚠️ Пасс за ${(1100).toLocaleString("ru-RU")} — нужно ${(1143).toLocaleString("ru-RU")}`);
    expect(j.next).toMatchObject({ kind: "step", step: "sale" });
    const err = buyerJourney({ ...withPass, status: "ERROR" }, [], { isForSale: false }, T0);
    expect(err.next?.kind).toBe("contact");
  });

  it("готов к выкупу и выкуплен — подсказки нет", () => {
    const ready = buyerJourney({ ...base, status: "PENDING", robloxUsername: "lox23", gamepassId: "1" }, [], null, T0);
    expect(ready.now.text).toBe("🛒 Готов к выкупу");
    expect(ready.next).toBeNull();
    const done = buyerJourney({ ...base, status: "COMPLETED", robloxUsername: "lox23", gamepassId: "1", completedAt: at(5) }, [], null, T0);
    expect(done.steps.every((s) => s.state === "done")).toBe(true);
    expect(done.next).toBeNull();
  });

  it("прямой заказ начинается с оплаты", () => {
    const j = buyerJourney({ ...base, isDirectOrder: true, status: "AWAITING_PAYMENT" }, [], null, T0);
    expect(j.steps[0]).toMatchObject({ label: "Оплата", state: "current" });
    expect(j.now.text).toBe("⏳ Ждём оплату");
  });

  it("в ленту не уезжает лишнее из payload", () => {
    expect(trimJourneyPayload({ kind: "key", secret: "x", nick: "a".repeat(500) })).toEqual({ kind: "key", nick: "a".repeat(160) });
  });
});
