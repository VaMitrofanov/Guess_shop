jest.mock("../gamepass-autocreate", () => ({
  createPassesByKey: jest.fn(),
  recordAutocreateTrace: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../wb-delivery-crypto", () => ({
  decryptWbSecret: () => "KEY",
  encryptWbSecret: () => "enc",
  wbDeliveryCryptoReady: () => true,
  wbSecretHmac: () => "h",
}));

import { createPassesByKey } from "../gamepass-autocreate";
import { keyWorthParking, orderTakesParkedKey, runParkedKeySweep, PARKED_GAVE_UP } from "../parked-key";

const create = createPassesByKey as jest.Mock;

function fakeDb(order: Record<string, unknown> | null, lastUsedAt = new Date("2026-11-27T00:00:00Z")) {
  const updates: unknown[] = [];
  return {
    updates,
    robloxApiKey: {
      findMany: jest.fn().mockResolvedValue([{ id: "k1", robloxUsername: "bfhjkrxdsodh", encryptedValue: "enc", userId: "u1", lastUsedAt, lastResult: "parked:no_universe", user: { tgId: null, vkId: "54694308" } }]),
      update: jest.fn((a) => { updates.push(a); return Promise.resolve(a); }),
    },
    wbOrder: {
      findMany: jest.fn().mockResolvedValue(order ? [order] : []),
      findUnique: jest.fn().mockResolvedValue({ adminNote: null }),
      update: jest.fn((a) => { updates.push(a); return Promise.resolve(a); }),
    },
    wbOrderGamepass: { deleteMany: jest.fn(), createMany: jest.fn() },
    $transaction: jest.fn((ops) => Promise.all(ops)),
  };
}
const order = { id: "o1", wbCode: "8L3JCD5", amount: 1200, status: "AWAITING_GAMEPASS", gamepassUrl: null, heldAt: new Date(), heldReason: "плохой отзыв WB (★1)", heldBy: "гейт выкупа", orderSource: "WB_DBS", robloxUsername: null, platform: "VK", createdAt: new Date() };
const deps = () => ({ sendBuyer: jest.fn().mockResolvedValue(undefined), alertAdmins: jest.fn().mockResolvedValue(undefined), orderCard: jest.fn().mockResolvedValue(undefined), now: () => new Date("2026-11-28T00:00:00Z") });

describe("отложенный ключ (8L3JCD5)", () => {
  beforeEach(() => create.mockReset());

  it("откладываем только годный ключ", () => {
    expect(keyWorthParking("no_universe")).toBe(true);
    expect(keyWorthParking("roblox_error")).toBe(true);
    expect(keyWorthParking("bad_key")).toBe(false);
    expect(keyWorthParking("not_authorized")).toBe(false);
    expect(keyWorthParking("nick_not_found")).toBe(false);
    expect(keyWorthParking(undefined)).toBe(false);
  });

  it("автозащита и неоплаченный прямой ключ не берут", () => {
    expect(orderTakesParkedKey({ status: "AWAITING_GAMEPASS", heldBy: "автозащита" })).toBe(false);
    expect(orderTakesParkedKey({ status: "AWAITING_GAMEPASS", isDirectOrder: true, paidAt: null })).toBe(false);
    expect(orderTakesParkedKey({ status: "AWAITING_GAMEPASS", heldBy: "гейт выкупа" })).toBe(true);
    expect(orderTakesParkedKey({ status: "PENDING" })).toBe(false);
  });

  it("игра появилась — пасс привязан, заморозка не снята, покупателю текст про проверку", async () => {
    create.mockResolvedValue({ created: [{ gamePassId: 111, priceInRobux: 1715 }] });
    const db = fakeDb(order);
    const d = deps();
    const r = await runParkedKeySweep(db, d);
    expect(r.applied).toBe(1);
    const upd = db.wbOrder.update.mock.calls[0][0];
    expect(upd.data.gamepassUrl).toContain("111");
    expect(upd.data).not.toHaveProperty("heldAt");
    expect(d.sendBuyer.mock.calls[0][1]).toContain("проверяем вручную");
    expect(d.orderCard).toHaveBeenCalled();
  });

  it("игры всё ещё нет — ничего не трогаем и не шумим", async () => {
    create.mockResolvedValue({ created: [], error: "no_universe" });
    const db = fakeDb(order);
    const d = deps();
    await runParkedKeySweep(db, d);
    expect(db.updates).toHaveLength(0);
    expect(d.alertAdmins).not.toHaveBeenCalled();
    expect(create.mock.calls[0][0].quiet).toBe(true);
  });

  it("ключ перевыпустили — один алерт владельцу «устарел»", async () => {
    create.mockResolvedValue({ created: [], error: "bad_key" });
    const db = fakeDb(order);
    const d = deps();
    const r = await runParkedKeySweep(db, d);
    expect(r.stale).toBe(1);
    expect(d.alertAdmins.mock.calls[0][0]).toContain("устарел");
    expect(db.robloxApiKey.update.mock.calls[0][0].data.lastResult).toBe("stale:bad_key");
  });

  it("ждёт дольше 30 дней — сдаёмся с алертом, без вызова Roblox", async () => {
    const db = fakeDb(order, new Date("2026-10-01T00:00:00Z"));
    const d = deps();
    const r = await runParkedKeySweep(db, d);
    expect(r.expired).toBe(1);
    expect(create).not.toHaveBeenCalled();
    expect(db.robloxApiKey.update.mock.calls[0][0].data.lastResult).toBe(PARKED_GAVE_UP);
  });
});
