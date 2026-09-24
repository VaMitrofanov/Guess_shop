// The client and server storefront import this stable facade; the actual
// policy lives with the bots so all three channels execute one source file.
export {
  BONUS_MIN_PACK,
  CUSTOM_MAX,
  CUSTOM_MIN,
  DIRECT_PACKS,
  DIRECT_PRICES,
  RETAIL_PRICING_POLICY_VERSION,
  ACQUIRING_MIN_RUB,
  ACQUIRING_RATE,
  USN_INCOME_RATE,
  customerPriceForTargetNet,
  customRate,
  directPrice,
  getRetailPriceBreakdown,
  retainedAfterPaymentCosts,
  targetNetRate,
} from "../../bots/shared/retail-pricing";
export type { RetailPriceBreakdown } from "../../bots/shared/retail-pricing";
