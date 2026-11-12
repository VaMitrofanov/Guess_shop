/**
 * Разметка чатов поддержки @RobloxBank_PA (12.11.2026).
 */
import { deskDecision, isDeskLabel, nextContactName, type DeskOrder } from "../pa-desk";

const o = (over: Partial<DeskOrder> = {}): DeskOrder => ({
  wbCode: "ZT8BW8D", amount: 500, status: "COMPLETED", createdAt: new Date("2026-11-10T10:00:00Z"),
  heldAt: null, openFlags: false, ...over,
});

describe("deskDecision", () => {
  it("без заказов — «Новые», без метки", () => {
    expect(deskDecision([])).toEqual({ folder: "NEW", tag: null });
  });

  it("всё выкуплено — «Готово»", () => {
    expect(deskDecision([o()])).toEqual({ folder: "DONE", tag: "ZT8BW8D · 500 · выкуплен" });
  });

  it("активный заказ важнее свежего выкупленного", () => {
    const d = deskDecision([
      o({ wbCode: "NEWDONE", createdAt: new Date("2026-11-12T10:00:00Z") }),
      o({ wbCode: "WAITGP1", status: "AWAITING_GAMEPASS", amount: 1000 }),
    ]);
    expect(d).toEqual({ folder: "QUEUE", tag: "WAITGP1 · 1000 · ждём пасс · +1" });
  });

  it("заморозка или ошибка — «Проблемы», метка про проблемный заказ", () => {
    const d = deskDecision([o({ status: "PENDING" }), o({ wbCode: "HELD123", status: "AWAITING_GAMEPASS", heldAt: new Date() })]);
    expect(d.folder).toBe("PROBLEM");
    expect(d.tag).toContain("HELD123 · 500 · заморожен");
    expect(deskDecision([o({ status: "ERROR" })]).folder).toBe("PROBLEM");
  });

  it("пометка на выкупленном заказе не делает его проблемой", () => {
    expect(deskDecision([o({ openFlags: true })]).folder).toBe("DONE");
    expect(deskDecision([o({ status: "PENDING", openFlags: true })]).folder).toBe("PROBLEM");
  });
});

describe("имя контакта", () => {
  it("наша метка узнаётся, имя оператора — нет", () => {
    expect(isDeskLabel("Анна · ZT8BW8D · 500 · выкуплен")).toBe(true);
    expect(isDeskLabel("Анна мама Пети")).toBe(false);
    // Прямой заказ: код вида DIR-060947AC.
    expect(isDeskLabel("♬ · DIR-060947AC · 300 · выкуплен · +6")).toBe(true);
  });

  it("незнакомец с заказом получает метку", () => {
    expect(nextContactName({ isContact: false, currentName: "Анна", fallbackName: "Анна", tag: "ZT8BW8D · 500 · выкуплен" }))
      .toBe("Анна · ZT8BW8D · 500 · выкуплен");
  });

  it("метка обновляется при смене стадии, имя сохраняется", () => {
    expect(nextContactName({ isContact: true, currentName: "Анна · ZT8BW8D · 500 · ждём пасс", fallbackName: "x", tag: "ZT8BW8D · 500 · выкуплен" }))
      .toBe("Анна · ZT8BW8D · 500 · выкуплен");
  });

  it("контакт, переименованный оператором, не трогаем", () => {
    expect(nextContactName({ isContact: true, currentName: "Анна (мама Пети)", fallbackName: "Анна", tag: "ZT8BW8D · 500 · выкуплен" })).toBeNull();
  });

  it("без изменений и без заказов — ничего не делаем", () => {
    expect(nextContactName({ isContact: true, currentName: "Анна · ZT8BW8D · 500 · выкуплен", fallbackName: "x", tag: "ZT8BW8D · 500 · выкуплен" })).toBeNull();
    expect(nextContactName({ isContact: false, currentName: "Анна", fallbackName: "Анна", tag: null })).toBeNull();
  });

  it("длинное имя не выходит за 64 символа", () => {
    const n = nextContactName({ isContact: false, currentName: "А".repeat(80), fallbackName: "x", tag: "ZT8BW8D · 2000 · выкупается · +12" })!;
    expect(n.length).toBeLessThanOrEqual(64);
  });
});
