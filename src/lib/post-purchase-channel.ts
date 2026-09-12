export const POST_PURCHASE_CHANNEL_DESTINATIONS = [
  "TG_NOTIFICATIONS",
  "TG_CHANNEL",
  "VK_COMMUNITY",
  "VK_MESSAGES",
] as const;

export type PostPurchaseChannelDestination = typeof POST_PURCHASE_CHANNEL_DESTINATIONS[number];

const PAID_PAYMENT_STATUSES = new Set(["AUTHORIZED", "CONFIRMED", "PARTIALLY_REFUNDED"]);
const CLOSED_PAYMENT_STATUSES = new Set(["REJECTED", "CANCELED", "FAILED", "REFUNDED"]);

export function isPostPurchaseChannelDestination(
  value: unknown,
): value is PostPurchaseChannelDestination {
  return typeof value === "string" && POST_PURCHASE_CHANNEL_DESTINATIONS.includes(
    value as PostPurchaseChannelDestination,
  );
}

export function canOfferPostPurchaseChannels(
  orderStatus: string,
  paymentStatus: string | null | undefined,
) {
  if (CLOSED_PAYMENT_STATUSES.has(paymentStatus ?? "")) return false;
  // Never infer payment from a fulfillment status alone. A legacy/manual
  // order can be PENDING or COMPLETED without a canonical PaymentAttempt;
  // showing acquisition CTAs there would falsely claim a paid purchase.
  void orderStatus;
  return PAID_PAYMENT_STATUSES.has(paymentStatus ?? "");
}

export function postPurchaseChannelEventType(destination: PostPurchaseChannelDestination) {
  return `POST_PURCHASE_${destination}_OPENED`;
}
