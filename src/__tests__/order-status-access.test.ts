import { hashStatusToken } from "@/lib/canonical-web-order";
import { orderStatusTokenMatches } from "@/lib/order-status-access";

describe("order status bearer access", () => {
  test("matches only the original bearer token", () => {
    const token = "status-token-with-sufficient-entropy";
    expect(orderStatusTokenMatches(token, hashStatusToken(token))).toBe(true);
    expect(orderStatusTokenMatches("different", hashStatusToken(token))).toBe(false);
  });

  test("fails closed for missing or malformed hashes", () => {
    expect(orderStatusTokenMatches("token", null)).toBe(false);
    expect(orderStatusTokenMatches("token", "not-a-sha256-hash")).toBe(false);
    expect(orderStatusTokenMatches("", hashStatusToken("token"))).toBe(false);
  });
});
