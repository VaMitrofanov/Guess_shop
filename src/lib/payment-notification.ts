import { PaymentAttemptStatus } from "@prisma/client";

const STATUS_MAP: Record<string, PaymentAttemptStatus | undefined> = {
  AUTHORIZED: PaymentAttemptStatus.AUTHORIZED,
  CONFIRMED: PaymentAttemptStatus.CONFIRMED,
  REJECTED: PaymentAttemptStatus.REJECTED,
  CANCELED: PaymentAttemptStatus.CANCELED,
  REVERSED: PaymentAttemptStatus.CANCELED,
  PARTIAL_REFUNDED: PaymentAttemptStatus.PARTIALLY_REFUNDED,
  REFUNDED: PaymentAttemptStatus.REFUNDED,
};

const ALLOWED: Record<PaymentAttemptStatus, PaymentAttemptStatus[]> = {
  CREATED: ["AUTHORIZED", "CONFIRMED", "REJECTED", "CANCELED", "FAILED"],
  INITIATED: ["AUTHORIZED", "CONFIRMED", "REJECTED", "CANCELED", "FAILED"],
  AUTHORIZED: ["CONFIRMED", "REJECTED", "CANCELED"],
  CONFIRMED: ["PARTIALLY_REFUNDED", "REFUNDED"],
  REJECTED: [],
  CANCELED: [],
  FAILED: [],
  PARTIALLY_REFUNDED: ["REFUNDED"],
  REFUNDED: [],
};

export function notificationStatus(status: unknown) {
  return typeof status === "string" ? STATUS_MAP[status] : undefined;
}

export function paymentTransitionAllowed(from: PaymentAttemptStatus, to: PaymentAttemptStatus) {
  return from === to || ALLOWED[from].includes(to);
}

/**
 * A terminal payment state must also remove an unfulfilled order from every
 * buyout queue. In particular, a successful full refund used to leave the
 * order PENDING even though its PaymentAttempt was already REFUNDED.
 */
export function paymentClosesUnfulfilledOrder(
  paymentStatus: PaymentAttemptStatus,
  orderStatus: string,
) {
  return orderStatus !== "COMPLETED"
    && (paymentStatus === "REJECTED" || paymentStatus === "CANCELED" || paymentStatus === "REFUNDED");
}
