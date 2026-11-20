// The client and server storefront import this stable facade; the actual
// policy lives with the bots so all three channels execute one source file.
export {
  CODES_LEGACY_POLICY_VERSION,
  CODES_PRICING_POLICY_VERSION,
  CODES_REFERENCE_USD_RUB,
  CODE_COMPONENTS,
  CODE_DENOMINATIONS,
  CODE_DISCOUNT_TIERS,
  CODE_MAX_DISCOUNT_PERCENT,
  CODE_PRICES,
  CODE_REGION_NOTES,
  CODE_SIGNUP_DISCOUNT_PERCENT,
  CODE_SUPPLIER_DENOMINATIONS,
  codeComponents,
  codeDiscountPercent,
  codeDiscountProgress,
  codePrice,
  codePriceTable,
  formatRubKopecks,
  getCodePriceBreakdown,
  isCodeDenomination,
  isSupplierCodeDenomination,
  packsAvailable,
  quoteCode,
  roundCodePriceKopecks,
  sanitizeCodesUsdRub,
} from "../../bots/shared/codes-pricing";
export type { CodeDiscountProgress, CodePriceBreakdown, CodeQuote } from "../../bots/shared/codes-pricing";
