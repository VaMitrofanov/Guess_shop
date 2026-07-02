/**
 * Unified Roblox nickname → gamepass search for user-facing bots.
 *
 * The previous Phase-A implementation (TG + VK) filtered by `expectedPrice ±2`
 * inside the search and merged "user doesn't exist" with "user has no pass" into
 * the same empty-result error message. That meant a user with a real gamepass
 * priced wrong saw the same dead-end as a user whose place is private — and
 * neither could fix their problem.
 *
 * This module:
 *   1. Resolves the username → userId via `resolveRobloxUserId`, so we can
 *      detect "no such user on Roblox" separately.
 *   2. Lists every for-sale gamepass across all the user's public games via
 *      `listForSaleGamepasses`, with no price-based filtering.
 *   3. Tags each result with `isPriceMatch` (|robux − expectedPrice| ≤ 2),
 *      so the caller renders the matching/non-matching split.
 *
 * Result is a discriminated union: `user_not_found` / `no_gamepasses` / `ok`.
 * The same shape is used by TG and VK clients — only the rendering differs.
 */

import {
  resolveRobloxUserId,
  listForSaleGamepasses,
  type GamepassSearchResult,
} from "./roblox";

export interface AnnotatedGamepass extends GamepassSearchResult {
  /** `Math.abs(robux − expectedPrice) ≤ PRICE_MATCH_TOLERANCE`. */
  isPriceMatch: boolean;
}

export type GamepassSearchOutcome =
  | { status: "user_not_found"; nick: string;           expectedPrice: number }
  | { status: "no_gamepasses";  nick: string;           expectedPrice: number; userId: number }
  | { status: "ok";             nick: string;           expectedPrice: number; userId: number; all: AnnotatedGamepass[]; matches: AnnotatedGamepass[]; nonMatches: AnnotatedGamepass[] };

/** Same ±tolerance we used in Phase A — Roblox rounds prices, this preserves UX. */
export const PRICE_MATCH_TOLERANCE = 2;

export async function searchGamepassesByNick(
  nick: string,
  expectedPrice: number,
): Promise<GamepassSearchOutcome> {
  const userId = await resolveRobloxUserId(nick);
  if (!userId) {
    return { status: "user_not_found", nick, expectedPrice };
  }

  const raw = await listForSaleGamepasses(userId, nick);
  if (raw.length === 0) {
    return { status: "no_gamepasses", nick, expectedPrice, userId };
  }

  const annotated: AnnotatedGamepass[] = raw
    .filter(g => g.robux > 0)
    .map(g => ({ ...g, isPriceMatch: Math.abs(g.robux - expectedPrice) <= PRICE_MATCH_TOLERANCE }))
    // Best (closest to expected price) first — useful for both price-match and
    // wrong-price branches so the caller can `.slice(0, 5)` and trust the order.
    .sort((a, b) => Math.abs(a.robux - expectedPrice) - Math.abs(b.robux - expectedPrice));

  const matches    = annotated.filter(g =>  g.isPriceMatch);
  const nonMatches = annotated.filter(g => !g.isPriceMatch);

  return { status: "ok", nick, expectedPrice, userId, all: annotated, matches, nonMatches };
}
