export const POST_PURCHASE_CHANNEL_DESTINATIONS = [
  "TG_NOTIFICATIONS",
  "TG_CHANNEL",
  "VK_COMMUNITY",
  "VK_MESSAGES",
] as const;

export type PostPurchaseChannelDestination = typeof POST_PURCHASE_CHANNEL_DESTINATIONS[number];

const PAID_ORDER_STATUSES = new Set(["PENDING", "IN_PROGRESS", "COMPLETED"]);
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
  return PAID_ORDER_STATUSES.has(orderStatus) || PAID_PAYMENT_STATUSES.has(paymentStatus ?? "");
}

export function postPurchaseChannelEventType(destination: PostPurchaseChannelDestination) {
  return `POST_PURCHASE_${destination}_OPENED`;
}
