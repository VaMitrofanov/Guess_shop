// The client and server storefront import this stable facade; the actual
// policy lives with the bots so all three channels execute one source file.
export {
  CODES_PRICING_POLICY_VERSION,
  CODE_DENOMINATIONS,
  CODE_PRICES,
  codePrice,
  getCodePriceBreakdown,
  isCodeDenomination,
} from "../../bots/shared/codes-pricing";
export type { CodePriceBreakdown } from "../../bots/shared/codes-pricing";
