import {
  notificationStatus,
  paymentClosesUnfulfilledOrder,
  paymentTransitionAllowed,
} from "@/lib/payment-notification";

describe("T-Bank notification state matrix", () => {
  test.each([
    ["AUTHORIZED", "AUTHORIZED"], ["CONFIRMED", "CONFIRMED"], ["REJECTED", "REJECTED"],
    ["CANCELED", "CANCELED"], ["REVERSED", "CANCELED"],
    ["PARTIAL_REFUNDED", "PARTIALLY_REFUNDED"], ["REFUNDED", "REFUNDED"],
  ])("maps %s to %s", (provider, internal) => expect(notificationStatus(provider)).toBe(internal));

  test.each(["NEW", "PARTIAL_REVERSED", "CHARGEBACK", "", null])("rejects unsupported status %p", (status) => {
    expect(notificationStatus(status)).toBeUndefined();
  });

  test.each([
    ["CREATED", "AUTHORIZED", true], ["CREATED", "CONFIRMED", true],
    ["INITIATED", "REJECTED", true], ["AUTHORIZED", "CONFIRMED", true],
    ["CONFIRMED", "PARTIALLY_REFUNDED", true], ["CONFIRMED", "REFUNDED", true],
    ["PARTIALLY_REFUNDED", "PARTIALLY_REFUNDED", true], ["PARTIALLY_REFUNDED", "REFUNDED", true],
    ["REFUNDED", "CONFIRMED", false], ["REJECTED", "CONFIRMED", false],
    ["CONFIRMED", "AUTHORIZED", false], ["CANCELED", "CONFIRMED", false],
  ] as const)("transition %s -> %s is %s", (from, to, allowed) => {
    expect(paymentTransitionAllowed(from, to)).toBe(allowed);
  });

  test.each([
    ["REFUNDED", "PENDING", true],
    ["REFUNDED", "IN_PROGRESS", true],
    ["REFUNDED", "COMPLETED", false],
    ["PARTIALLY_REFUNDED", "PENDING", false],
    ["CONFIRMED", "PENDING", false],
    ["REJECTED", "PAYMENT_PENDING", true],
    ["CANCELED", "AWAITING_PAYMENT", true],
  ] as const)("payment %s closes order %s: %s", (payment, order, closes) => {
    expect(paymentClosesUnfulfilledOrder(payment, order)).toBe(closes);
  });
});
