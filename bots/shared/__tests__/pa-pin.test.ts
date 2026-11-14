import { pinText, pinWorthCreating, type PinOrder } from "../pa-pin";

const NOW = new Date("2026-11-15T12:00:00Z").getTime();
const o = (p: Partial<PinOrder>): PinOrder => ({
  wbCode: "ZT8BW8D", amount: 500, status: "AWAITING_GAMEPASS", createdAt: new Date(NOW - 3600_000),
  completedAt: null, heldAt: null, robloxUsername: "Misha2010", ...p,
});

describe("закреп заказа в чате поддержки", () => {
  it("показывает код, номинал, ник и этап", () => {
    const text = pinText([o({})], NOW)!;
    expect(text).toContain("ZT8BW8D · 500 Robux");
    expect(text).toContain("Misha2010");
    expect(text).toContain("ждём ваш геймпасс");
  });

  it("не выдаёт клиенту заморозку и не называет срок", () => {
    const text = pinText([o({ heldAt: new Date(NOW), status: "PENDING" })], NOW)!;
    expect(text).not.toMatch(/замор|флаг|пометк/i);
    expect(pinText([o({ status: "COMPLETED", completedAt: new Date(NOW - 3600_000) })], NOW)).not.toMatch(/\d+\s*(дн|час|ч\b|сут)/);
  });

  it("живые заказы впереди, старый выкупленный не показывается", () => {
    const text = pinText([
      o({ wbCode: "OLD0001", status: "COMPLETED", completedAt: new Date(NOW - 30 * 86_400_000), createdAt: new Date(NOW - 31 * 86_400_000) }),
      o({ wbCode: "NEW0001" }),
    ], NOW)!;
    expect(text).toContain("NEW0001");
    expect(text).not.toContain("OLD0001");
  });

  it("новый закреп — только по живому или свежему заказу", () => {
    expect(pinWorthCreating([o({})], NOW)).toBe(true);
    expect(pinWorthCreating([o({ status: "COMPLETED", completedAt: new Date(NOW - 10 * 86_400_000) })], NOW)).toBe(false);
    expect(pinWorthCreating([o({ status: "REJECTED" })], NOW)).toBe(false);
  });
});
