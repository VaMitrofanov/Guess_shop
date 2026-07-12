import { PaymentAttemptStatus, PriceQuoteStatus } from "@prisma/client";
import {
  expectedGamepassPrice,
  hashStatusToken,
  validateCheckoutGamepass,
  validateCheckoutQuote,
  WebOrderError,
} from "@/lib/canonical-web-order";
import { notificationStatus, paymentTransitionAllowed } from "@/lib/payment-notification";

describe("canonical web order invariants", () => {
  const now = new Date("2026-07-13T10:00:00.000Z");
  const quote = {
    id: "quote-1",
    userId: "user-1",
    status: PriceQuoteStatus.ACTIVE,
    expiresAt: new Date("2026-07-13T10:15:00.000Z"),
    policyVersion: "retail-direct-v1",
    requestedRobux: 500,
    bonusRobux: 0,
    discountKopecks: 0,
    finalAmountKopecks: 45_000,
    policy: { version: "retail-direct-v1" },
  };

  it("accepts only an active, unexpired quote owned by the session user", () => {
    expect(validateCheckoutQuote(quote, "user-1", now)).toBe(quote);
    expect(() => validateCheckoutQuote({ ...quote, userId: "user-2" }, "user-1", now))
      .toThrow(expect.objectContaining({ code: "QUOTE_NOT_OWNED" }));
    expect(() => validateCheckoutQuote({ ...quote, status: PriceQuoteStatus.CONSUMED }, "user-1", now))
      .toThrow(expect.objectContaining({ code: "QUOTE_UNAVAILABLE" }));
    expect(() => validateCheckoutQuote({ ...quote, expiresAt: now }, "user-1", now))
      .toThrow(expect.objectContaining({ code: "QUOTE_EXPIRED" }));
  });

  it("rejects a policy mismatch and an amount below the provider minimum", () => {
    expect(() => validateCheckoutQuote({ ...quote, policy: { version: "other" } }, "user-1", now))
      .toThrow(expect.objectContaining({ code: "POLICY_MISMATCH" }));
    expect(() => validateCheckoutQuote({ ...quote, finalAmountKopecks: 999 }, "user-1", now))
      .toThrow(expect.objectContaining({ code: "PAYMENT_TOO_SMALL" }));
  });

  it("binds the order to the exact owner, sale state and gross gamepass price", () => {
    expect(expectedGamepassPrice(quote)).toBe(715);
    expect(validateCheckoutGamepass(quote, { price: 715, creatorId: 42, isActive: true }, 42)).toBe(715);
    expect(() => validateCheckoutGamepass(quote, { price: 715, creatorId: 42, isActive: false }, 42))
      .toThrow(expect.objectContaining({ code: "GAMEPASS_NOT_FOR_SALE" }));
    expect(() => validateCheckoutGamepass(quote, { price: 715, creatorId: 99, isActive: true }, 42))
      .toThrow(expect.objectContaining({ code: "GAMEPASS_OWNER_MISMATCH" }));
    expect(() => validateCheckoutGamepass(quote, { price: 716, creatorId: 42, isActive: true }, 42))
      .toThrow(expect.objectContaining({ code: "GAMEPASS_PRICE_MISMATCH" }));
  });

  it("includes authenticated bonus Robux in the required gross price", () => {
    expect(expectedGamepassPrice({ requestedRobux: 500, bonusRobux: 100 })).toBe(858);
  });

  it("stores only a one-way status-token hash", () => {
    expect(hashStatusToken("secret-status-token")).toMatch(/^[a-f0-9]{64}$/);
    expect(hashStatusToken("secret-status-token")).not.toContain("secret-status-token");
  });

  it("keeps payment transitions monotonic while allowing idempotent retries", () => {
    expect(notificationStatus("CONFIRMED")).toBe(PaymentAttemptStatus.CONFIRMED);
    expect(notificationStatus("UNKNOWN")).toBeUndefined();
    expect(paymentTransitionAllowed(PaymentAttemptStatus.INITIATED, PaymentAttemptStatus.AUTHORIZED)).toBe(true);
    expect(paymentTransitionAllowed(PaymentAttemptStatus.AUTHORIZED, PaymentAttemptStatus.CONFIRMED)).toBe(true);
    expect(paymentTransitionAllowed(PaymentAttemptStatus.CONFIRMED, PaymentAttemptStatus.CONFIRMED)).toBe(true);
    expect(paymentTransitionAllowed(PaymentAttemptStatus.CONFIRMED, PaymentAttemptStatus.AUTHORIZED)).toBe(false);
    expect(paymentTransitionAllowed(PaymentAttemptStatus.REFUNDED, PaymentAttemptStatus.CONFIRMED)).toBe(false);
  });
});

// Make sure Jest prints domain failures as the intended class, not a generic
// assertion error if the implementation accidentally stops throwing it.
expect(WebOrderError).toBeDefined();
