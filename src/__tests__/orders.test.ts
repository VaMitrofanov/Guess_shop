import { calculatePrice, isValidRobloxUsername, DEFAULT_RATE } from "../lib/orders";

describe("Order Logic", () => {
  test("Calculates correct price for standard amount", () => {
    const amount = 1000;
    const expected = Math.round(amount * DEFAULT_RATE);
    expect(calculatePrice(amount)).toBe(expected);
  });

  test("Handles custom rates correctly", () => {
    const amount = 500;
    const rate = 0.5;
    expect(calculatePrice(amount, rate)).toBe(250);
  });

  test("Returns 0 for negative amounts", () => {
    expect(calculatePrice(-100)).toBe(0);
  });

  test("Validates Roblox username correctly", () => {
    expect(isValidRobloxUsername("Builderman")).toBe(true);
    expect(isValidRobloxUsername("builderman_123")).toBe(true);
    expect(isValidRobloxUsername("bu")).toBe(false); // Too short
    expect(isValidRobloxUsername("ThisUsernameIsWayTooLongForRobloxSystem")).toBe(false); // Too long
    expect(isValidRobloxUsername("User!@#")).toBe(false); // Invalid chars
  });
});
