import { PaymentAttemptStatus, PriceQuoteStatus } from "@prisma/client";
import {
  expectedGamepassPrice,
  expectedPartPrice,
  hashStatusToken,
  validateCheckoutGamepass,
  validateCheckoutParts,
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

  it("принимает набор пассов, если он закрывает сумму заказа ровно", () => {
    // Заказ на 2000 нельзя закрыть одним пассом: он стоил бы 2858 R$, а у
    // доноров 1500 «чистых» (2143 грязных). Коридор ВБ давно собирает такой
    // заказ парой 1500 + 500 — теперь так же умеет и сайт.
    const big = { requestedRobux: 2000, bonusRobux: 0 };
    expect(validateCheckoutParts(big, [
      { gamepassId: "1", amount: 1500 },
      { gamepassId: "2", amount: 500 },
    ])).toBe(2000);
    expect(expectedPartPrice(1500)).toBe(2143);
    expect(expectedPartPrice(500)).toBe(715);
  });

  it("бонус входит в сумму заказа: части считаются от того, что получит человек", () => {
    expect(validateCheckoutParts({ requestedRobux: 1500, bonusRobux: 500 }, [
      { gamepassId: "1", amount: 1500 },
      { gamepassId: "2", amount: 500 },
    ])).toBe(2000);
  });

  it("не пропускает набор, который расходится с заказом или состоит из огрызков", () => {
    const big = { requestedRobux: 2000, bonusRobux: 0 };
    // Сумма не сошлась — покупатель получил бы не то, за что заплатил.
    expect(() => validateCheckoutParts(big, [
      { gamepassId: "1", amount: 1500 },
      { gamepassId: "2", amount: 400 },
    ])).toThrow(expect.objectContaining({ code: "PARTS_INVALID" }));
    // Часть не кратна 500 — донор после такой покупки остаётся с огрызком.
    expect(() => validateCheckoutParts(big, [
      { gamepassId: "1", amount: 1300 },
      { gamepassId: "2", amount: 700 },
    ])).toThrow(expect.objectContaining({ code: "PARTS_INVALID" }));
    // Часть больше донора — её не купит никто.
    expect(() => validateCheckoutParts({ requestedRobux: 3000, bonusRobux: 0 }, [
      { gamepassId: "1", amount: 2000 },
      { gamepassId: "2", amount: 1000 },
    ])).toThrow(expect.objectContaining({ code: "PARTS_INVALID" }));
    // Одна часть — это не набор, а обычный заказ.
    expect(() => validateCheckoutParts(big, [{ gamepassId: "1", amount: 2000 }]))
      .toThrow(expect.objectContaining({ code: "PARTS_INVALID" }));
  });

  it("rejects a policy mismatch and an amount below the provider minimum", () => {
    expect(() => validateCheckoutQuote({ ...quote, policy: { version: "other" } }, "user-1", now))
      .toThrow(expect.objectContaining({ code: "POLICY_MISMATCH" }));
    expect(() => validateCheckoutQuote({ ...quote, finalAmountKopecks: 999 }, "user-1", now))
      .toThrow(expect.objectContaining({ code: "PAYMENT_TOO_SMALL" }));
  });

  it("binds the order to the owner, sale state and guarded gross-price tolerance", () => {
    expect(expectedGamepassPrice(quote)).toBe(715);
    expect(validateCheckoutGamepass(quote, { price: 715, creatorId: 42, isActive: true }, 42)).toBe(715);
    expect(() => validateCheckoutGamepass(quote, { price: 715, creatorId: 42, isActive: false }, 42))
      .toThrow(expect.objectContaining({ code: "GAMEPASS_NOT_FOR_SALE" }));
    expect(() => validateCheckoutGamepass(quote, { price: 715, creatorId: 99, isActive: true }, 42))
      .toThrow(expect.objectContaining({ code: "GAMEPASS_OWNER_MISMATCH" }));
    expect(validateCheckoutGamepass(quote, { price: 716, creatorId: 42, isActive: true }, 42)).toBe(715);
    expect(() => validateCheckoutGamepass(quote, { price: 718, creatorId: 42, isActive: true }, 42))
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
