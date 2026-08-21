export type SearchableGamepass = {
  price: number;
  isForSale?: boolean;
};

export const GAMEPASS_PRICE_TOLERANCE = 2;

export const SITE_MIN_ROBUX = 100;
export const SITE_MAX_ROBUX = 100_000;

/**
 * Converts an existing Roblox pass price back into the exact net amount the
 * customer can buy through the storefront after Roblox's 30% fee.
 */
export function robuxForGamepassPrice(price: number): number | null {
  const gross = Math.trunc(Number(price));
  if (!Number.isFinite(gross) || gross <= 0) return null;
  const net = Math.floor((gross * 7) / 10);
  if (net < SITE_MIN_ROBUX || net > SITE_MAX_ROBUX) return null;
  return Math.abs(Math.ceil(net / 0.7) - gross) <= GAMEPASS_PRICE_TOLERANCE ? net : null;
}

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
