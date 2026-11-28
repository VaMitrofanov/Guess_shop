/**
 * U6 (риск №24 в docs/security.md): `callback_data` — не доверенный ввод.
 * Нажатие кнопки в Telegram/VK можно подделать неофициальным клиентом, поэтому
 * любая ветка, читающая сущность по ID из кнопки, обязана сверить владельца.
 */

const findUniqueOrder = jest.fn();
const findUniqueIntent = jest.fn();
const findUniqueUser = jest.fn();

jest.mock("../db", () => ({
  db: {
    wbOrder: { findUnique: (...a: unknown[]) => findUniqueOrder(...a) },
    directIntent: { findUnique: (...a: unknown[]) => findUniqueIntent(...a) },
    user: { findUnique: (...a: unknown[]) => findUniqueUser(...a) },
  },
}));

import { assertOwnsOrder, assertOwnsIntent, tgActor, vkActor } from "../ownership";

beforeEach(() => {
  findUniqueOrder.mockReset();
  findUniqueIntent.mockReset();
  findUniqueUser.mockReset();
});

describe("assertOwnsOrder", () => {
  it("пропускает владельца", async () => {
    findUniqueOrder.mockResolvedValue({ id: "o1", userId: "u1", status: "AWAITING_GAMEPASS" });
    findUniqueUser.mockResolvedValue({ id: "u1" });

    const res = await assertOwnsOrder(tgActor(555), "o1", { id: true, status: true });
    expect(res).toEqual({ ok: true, entity: { id: "o1", userId: "u1", status: "AWAITING_GAMEPASS" } });
  });

  it("отклоняет чужой заказ (подделанный callback_data)", async () => {
    findUniqueOrder.mockResolvedValue({ id: "o1", userId: "victim", status: "AWAITING_GAMEPASS" });
    findUniqueUser.mockResolvedValue({ id: "attacker" });

    const res = await assertOwnsOrder(tgActor(666), "o1", { id: true });
    expect(res).toEqual({ ok: false, reason: "forbidden" });
  });

  it("отклоняет, когда вызывающий вообще не наш пользователь", async () => {
    findUniqueOrder.mockResolvedValue({ id: "o1", userId: "victim" });
    findUniqueUser.mockResolvedValue(null);

    const res = await assertOwnsOrder(vkActor(777), "o1", { id: true });
    expect(res).toEqual({ ok: false, reason: "forbidden" });
  });

  it("несуществующий заказ — not_found, а не forbidden", async () => {
    findUniqueOrder.mockResolvedValue(null);
    const res = await assertOwnsOrder(tgActor(555), "nope", { id: true });
    expect(res).toEqual({ ok: false, reason: "not_found" });
  });

  it("резолвит VK-пользователя по vkId, а TG — по tgId", async () => {
    findUniqueOrder.mockResolvedValue({ id: "o1", userId: "u1" });
    findUniqueUser.mockResolvedValue({ id: "u1" });

    await assertOwnsOrder(vkActor(42), "o1", { id: true });
    expect(findUniqueUser).toHaveBeenCalledWith(expect.objectContaining({ where: { vkId: "42" } }));

    findUniqueUser.mockClear();
    await assertOwnsOrder(tgActor(42), "o1", { id: true });
    expect(findUniqueUser).toHaveBeenCalledWith(expect.objectContaining({ where: { tgId: "42" } }));
  });
});

describe("assertOwnsIntent", () => {
  it("отклоняет чужую заявку (кнопка uci:)", async () => {
    findUniqueIntent.mockResolvedValue({ id: "i1", userId: "victim", status: "PENDING" });
    findUniqueUser.mockResolvedValue({ id: "attacker" });

    const res = await assertOwnsIntent(tgActor(666), "i1", { status: true });
    expect(res).toEqual({ ok: false, reason: "forbidden" });
  });

  it("пропускает владельца заявки", async () => {
    findUniqueIntent.mockResolvedValue({ id: "i1", userId: "u1", status: "PENDING" });
    findUniqueUser.mockResolvedValue({ id: "u1" });

    const res = await assertOwnsIntent(tgActor(555), "i1", { status: true });
    expect(res.ok).toBe(true);
  });
});
