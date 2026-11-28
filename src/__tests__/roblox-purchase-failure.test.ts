import {
  classifyPurchaseFailure,
  isLegacyPurchaseFlowFailure,
  needsOwnershipCheck,
} from "../lib/roblox-buyout";

describe("legacy Roblox purchase endpoint refusal", () => {
  test.each([
    "InvalidArguments",
    "Invalid arguments.",
    "Invalid Parameter",
  ])("classifies %s as an internal transport failure", (reason) => {
    expect(isLegacyPurchaseFlowFailure(reason)).toBe(true);
    expect(classifyPurchaseFailure(reason)).toBe("internal");
    expect(needsOwnershipCheck(reason)).toBe(false);
  });

  test("keeps gamepass row failures separate", () => {
    expect(isLegacyPurchaseFlowFailure("PriceChanged")).toBe(false);
    expect(classifyPurchaseFailure("PriceChanged")).toBe("row");
  });
});
