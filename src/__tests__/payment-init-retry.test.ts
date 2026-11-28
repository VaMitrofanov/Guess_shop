import {
  CREATED_ATTEMPT_STALE_MS,
  isLivePaymentAttempt,
  MAX_PAYMENT_INIT_ATTEMPTS,
  providerOrderIdForAttempt,
} from "@/lib/payment-init-retry";

describe("payment init retry contract", () => {
  test("keeps the first provider ID stable and makes retries unique", () => {
    expect(providerOrderIdForAttempt("WEB-ABC", 1)).toBe("WEB-ABC");
    expect(providerOrderIdForAttempt("WEB-ABC", 2)).toBe("WEB-ABC-R2");
    expect(providerOrderIdForAttempt("WEB-ABC", 3)).toBe("WEB-ABC-R3");
  });

  test("enforces the three-attempt ceiling", () => {
    expect(MAX_PAYMENT_INIT_ATTEMPTS).toBe(3);
    expect(() => providerOrderIdForAttempt("WEB-ABC", 4)).toThrow("invalid payment attempt number");
  });

  test("never creates a retry beside a live payment", () => {
    expect(isLivePaymentAttempt("CREATED")).toBe(true);
    expect(isLivePaymentAttempt("INITIATED")).toBe(true);
    expect(isLivePaymentAttempt("AUTHORIZED")).toBe(true);
    expect(isLivePaymentAttempt("CONFIRMED")).toBe(true);
    expect(isLivePaymentAttempt("FAILED")).toBe(false);
    expect(isLivePaymentAttempt("REJECTED")).toBe(false);
    expect(isLivePaymentAttempt("CANCELED")).toBe(false);
  });

  test("releases a crashed CREATED attempt after a bounded grace period", () => {
    const now = new Date("2026-07-28T12:00:00Z");
    expect(isLivePaymentAttempt("CREATED", new Date(now.getTime() - CREATED_ATTEMPT_STALE_MS), now)).toBe(true);
    expect(isLivePaymentAttempt("CREATED", new Date(now.getTime() - CREATED_ATTEMPT_STALE_MS - 1), now)).toBe(false);
  });
});
