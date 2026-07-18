import {
  canOfferPostPurchaseChannels,
  isPostPurchaseChannelDestination,
  postPurchaseChannelEventType,
} from "@/lib/post-purchase-channel";

describe("post-purchase channel acquisition", () => {
  test("appears only after a confirmed payment and never after a full refund", () => {
    expect(canOfferPostPurchaseChannels("PAYMENT_PENDING", "INITIATED")).toBe(false);
    expect(canOfferPostPurchaseChannels("PENDING", "CONFIRMED")).toBe(true);
    expect(canOfferPostPurchaseChannels("IN_PROGRESS", "CONFIRMED")).toBe(true);
    expect(canOfferPostPurchaseChannels("COMPLETED", "CONFIRMED")).toBe(true);
    expect(canOfferPostPurchaseChannels("PENDING", "REFUNDED")).toBe(false);
    expect(canOfferPostPurchaseChannels("PENDING", "FAILED")).toBe(false);
  });

  test("accepts only the four explicit destinations", () => {
    expect(isPostPurchaseChannelDestination("TG_NOTIFICATIONS")).toBe(true);
    expect(isPostPurchaseChannelDestination("TG_CHANNEL")).toBe(true);
    expect(isPostPurchaseChannelDestination("VK_COMMUNITY")).toBe(true);
    expect(isPostPurchaseChannelDestination("VK_MESSAGES")).toBe(true);
    expect(isPostPurchaseChannelDestination("TG_EVIL_REDIRECT")).toBe(false);
    expect(isPostPurchaseChannelDestination(null)).toBe(false);
  });

  test("uses a stable event type that is readable in the admin journal", () => {
    expect(postPurchaseChannelEventType("VK_COMMUNITY"))
      .toBe("POST_PURCHASE_VK_COMMUNITY_OPENED");
  });
});
