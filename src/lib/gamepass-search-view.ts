export type SearchableGamepass = {
  price: number;
  isForSale?: boolean;
};

export const GAMEPASS_PRICE_TOLERANCE = 2;

export function gamepassPriceMatches(
  price: number,
  expectedPrice: number,
  tolerance = GAMEPASS_PRICE_TOLERANCE,
): boolean {
  return Math.abs(Number(price) - expectedPrice) <= tolerance;
}

/**
 * Search-first storefront policy: hide unavailable passes, keep every sellable
 * result, and put the closest price (normally the ready pass) first.
 */
export function rankSellableGamepasses<T extends SearchableGamepass>(passes: T[], expectedPrice: number): T[] {
  return passes
    .filter((pass) => pass.isForSale !== false && Number(pass.price) > 0)
    .sort((a, b) => Math.abs(Number(a.price) - expectedPrice) - Math.abs(Number(b.price) - expectedPrice));
}
