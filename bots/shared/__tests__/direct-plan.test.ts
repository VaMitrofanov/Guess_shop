jest.mock("../roblox", () => ({ getGamepassDetails: jest.fn() }));

import { getGamepassDetails } from "../roblox";
import {
  acceptDirectSelection,
  directKeyTargets,
  directNeedsScreen,
  directPlan,
  intentPartsJson,
  mergeOwned,
  readyParts,
} from "../direct-plan";
import type { OwnedPass } from "../gamepass-plan";

/**
 * Прямой заказ в ботах — на движке коридора ВБ (24.09.2026). До этого пак
 * 2000 требовал ОДИН пасс за 2858 R$, который не выкупит ни один донор.
 */

const pass = (id: string, price: number): OwnedPass => ({ gamepassId: id, name: `P${price}`, price, isForSale: true });
const mockDetails = getGamepassDetails as jest.MockedFunction<typeof getGamepassDetails>;

describe("разбор аккаунта в прямом заказе", () => {
  test("пак 2000 собирается парой 1500 + 500, а не пассом за 2858", () => {
    const parts = readyParts(directPlan(2000, [pass("1", 2143), pass("2", 715)]));
    expect(parts?.map((p) => p.amount)).toEqual([1500, 500]);
  });

  test("ключ создаёт эталонный набор под сумму, как квест ВБ", () => {
    expect(directKeyTargets(2000).map((t) => t.price)).toEqual([2143, 715]);
    expect(directKeyTargets(500).map((t) => t.price)).toEqual([715]);
  });

  test("уже выставленные пассы засчитываются (1000 = 500 + 500 одним пассом)", () => {
    const parts = readyParts(directPlan(1000, [pass("1", 715)]));
    expect(parts?.map((p) => p.amount)).toEqual([500, 500]);
  });

  test("свежие сведения о пассе побеждают старые", () => {
    const merged = mergeOwned([pass("1", 100)], [pass("1", 715), pass("2", 2143)]);
    expect(merged).toEqual([pass("1", 715), pass("2", 2143)]);
  });
});

describe("экран «чего не хватает»", () => {
  const screenFor = (owned: OwnedPass[], storedKey = false) => directNeedsScreen({
    totalAmount: 2000,
    nick: "Nick",
    plan: directPlan(2000, owned),
    owned,
    keyEnabled: true,
    storedKey,
    guideUrl: "https://robloxbank.ru/guide?source=direct",
  });

  test("влезает в лимиты клавиатуры VK (6 рядов, 10 кнопок, 5 в ряду)", () => {
    for (const screen of [screenFor([]), screenFor([pass("1", 100), pass("2", 300), pass("3", 5000)], true)]) {
      expect(screen.rows.length).toBeLessThanOrEqual(6);
      expect(screen.rows.flat().length).toBeLessThanOrEqual(10);
      for (const row of screen.rows) expect(row.length).toBeLessThanOrEqual(5);
    }
  });

  test("привязанный ключ — первая дверь, без повторного ввода", () => {
    expect(screenFor([], true).rows[0][0].action).toBe("keyStored");
    expect(screenFor([], false).rows[0][0].action).toBe("key");
  });

  test("пасс не той цены предлагается честным пересчётом, а не «оформить не то»", () => {
    const screen = screenFor([pass("9", 1429)]);
    const pick = screen.rows.flat().find((b) => b.action === "pick");
    expect(pick?.label).toBe("1429 R$ → заказ на 1000 R$");
  });

  test("Pass ID назван как путь, когда поиск пасс не видит", () => {
    expect(screenFor([]).text).toContain("Pass ID");
  });
});

describe("приём набора перед заявкой", () => {
  beforeEach(() => mockDetails.mockReset());

  test("каждая часть сверяется с её номиналом", async () => {
    mockDetails.mockImplementation(async (id) => ({
      id, name: id, price: id === "1" ? 2143 : 700, creatorId: 7, creatorName: "Nick", isActive: true,
    }));
    const parts = readyParts(directPlan(2000, [pass("1", 2143), pass("2", 715)]))!;
    const res = await acceptDirectSelection({ totalAmount: 2000, gamepassId: "1", parts, nick: "Nick" });
    expect(res).toMatchObject({ ok: false, code: "WRONG_PRICE", gamepassId: "2" });
  });

  test("Roblox молчит — заявку принимаем (её перепроверит оплата и прайс-гард выкупа)", async () => {
    mockDetails.mockResolvedValue({ id: "1", name: "?", price: 0, creatorId: 0, isActive: true, validationSkipped: true });
    const res = await acceptDirectSelection({ totalAmount: 1000, gamepassId: "1", nick: "Nick" });
    expect(res).toMatchObject({ ok: true, recipient: "Nick" });
  });

  test("в заявку набор ложится JSON-ом, одиночный пасс — без него", () => {
    const parts = readyParts(directPlan(2000, [pass("1", 2143), pass("2", 715)]))!;
    expect(intentPartsJson(parts)).toEqual([{ gamepassId: "1", amount: 1500 }, { gamepassId: "2", amount: 500 }]);
    expect(intentPartsJson(parts.slice(0, 1))).toBeUndefined();
  });
});
