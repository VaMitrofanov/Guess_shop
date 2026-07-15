import {
  gamepassPriceMatches,
  rankSellableGamepasses,
} from "../lib/gamepass-search-view";

describe("search-first gamepass results", () => {
  test("keeps every sellable pass and ranks the ready price first", () => {
    const passes = rankSellableGamepasses([
      { id: "wrong", price: 900, isForSale: true },
      { id: "hidden", price: 1429, isForSale: false },
      { id: "ready", price: 1429, isForSale: true },
      { id: "free", price: 0, isForSale: true },
      { id: "near", price: 1400, isForSale: true },
    ], 1429);

    expect(passes.map((pass) => pass.id)).toEqual(["ready", "near", "wrong"]);
  });

  test("uses the same plus-minus-two tolerance as the buyout guard", () => {
    expect(gamepassPriceMatches(1427, 1429)).toBe(true);
    expect(gamepassPriceMatches(1431, 1429)).toBe(true);
    expect(gamepassPriceMatches(1432, 1429)).toBe(false);
  });

  test("SITE can require the exact canonical checkout price", () => {
    expect(gamepassPriceMatches(1429, 1429, 0)).toBe(true);
    expect(gamepassPriceMatches(1430, 1429, 0)).toBe(false);
  });
});
