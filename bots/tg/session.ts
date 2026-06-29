/**
 * In-memory session state for the Telegram bot.
 *
 * Survives within a single process lifetime. On restart the user simply
 * re-sends /start CODE to re-enter the flow. For HA/multi-replica deployments
 * replace this with a Redis-backed store.
 */

export interface LinkState {
  wbCode:      string;
  denomination: number;
}

/**
 * Users currently waiting to send their gamepass URL.
 * Key: Telegram numeric user ID.
 */
export const pendingLink = new Map<number, LinkState>();

/**
 * Users who have been asked to send a review screenshot.
 * Key: Telegram numeric user ID → WbOrder.id they should review.
 */
export const pendingReview = new Map<number, string>();

// ── Direct order session states ───────────────────────────────────────────────

export type DirectFlowStep = "amount" | "bonus" | "nick" | "nick_input" | "gamepass" | "summary";

export interface DirectFlowState {
  step: DirectFlowStep;
  amount?: number;
  bonus?: number;
  totalAmount?: number;
  passPrice?: number;
  rublePrice?: number;
  rubleDiscount?: number;
  robloxUsername?: string;
  gamepassId?: string;
  gamepassUrl?: string;
  gamepassName?: string;
}
export const pendingDirectFlow = new Map<number, DirectFlowState>();

export const pendingNickEdit = new Map<number, true>();

/**
 * Admin is typing payment details for a direct order.
 * Key: admin tgId (number) → WbOrder.id
 */
export const pendingPaymentDetails = new Map<number, string>();

/**
 * User is expected to send a payment screenshot.
 * Key: user tgId (number) → WbOrder.id
 */
export const pendingPaymentScreenshot = new Map<number, string>();
/**
 * Admins currently writing a rejection reason for an order.
 * Key: Admin Telegram ID → WbOrder.id
 */
export const pendingRejectionReason = new Map<number, string>();

// ── Admin dashboard session states ───────────────────────────────────────────

/** Admin's last widget message_id per hub — for editMessageText reuse. */
export const adminWidgetMsg = new Map<number, number>();

/** Admin is in "add codes" input mode. Value = denomination for the codes. */
export const pendingCodesInput = new Map<number, { denomination: number }>();

/** Admin is in "change purchase rate" input mode. */
export const pendingRateInput = new Map<number, true>();

/** Admin is in "search order" input mode. */
export const pendingAdminSearch = new Map<number, true>();

/** Admin is in "batch fulfillment" input mode — waiting for confirmation. */
export const pendingBatchFulfill = new Map<number, true>();

/** Admin is in "edit product price" input mode. Value = nmID. */
export const pendingPriceInput = new Map<number, { nmID: number }>();

// ── Progressive Disclosure: per-session failure counters ─────────────────────
// Tracks how many times a user has hit each validation error in their current
// active session. Reset when pendingLink is cleared (success or new session).

export interface LinkFailState {
  priceMismatch: number; // wrong game-pass price
  formatError:   number; // text didn't parse as a gamepass URL/ID
  notActive:     number; // gamepass not published/active
}

export const linkFailCounts = new Map<number, LinkFailState>();

/** Admin is typing an answer to a WB review or question. */
export const pendingReviewAnswer = new Map<number, { id: string; isQuestion: boolean; article: string }>();

/** Admin is setting the cost price for a WB product. */
export const pendingCostInput = new Map<number, { nmID: number; vendorCode: string }>();

/** Admin is updating logistics cost for a WB product. */
export const pendingLogisticsInput = new Map<number, { nmID: number; vendorCode: string }>();

/** Admin is setting advertising cost per unit for a WB product. */
export const pendingAdInput = new Map<number, { nmID: number; vendorCode: string }>();

/** Admin is setting a denomination (Robux count) for a WB product. */
export const pendingDenomInput = new Map<number, { nmID: number; vendorCode: string }>();

/** Admin is updating a global WB unit econ setting. */
export const pendingUeSettingInput = new Map<number, { field: "kursRb" | "kursUsd" | "fixedCost" }>();

/** Admin is using the what-if unit-econ calculator (typing "номинал цена [маржа%]"). */
export const pendingWhatIfInput = new Set<number>();

/** Admin is entering the auto-buy target rate. */
export const pendingAutoBuyRateInput = new Map<number, true>();

/** Admin is typing a gamepass name to search on bossrobux. */
export const pendingBossrobuxSearch = new Map<number, true>();

/** Cached search results per admin (cleared after successful purchase). */
export const bossrobuxSearchCache = new Map<number, import("../shared/bossrobux").BossrobuxGamepass[]>();

// ── Client-side: gamepass search by Roblox nick (item 7) ─────────────────────

/**
 * User clicked "🔎 Найти по моему нику Roblox" on the provisional welcome and
 * is now expected to type their Roblox username. Carries the order context
 * so we know which `wbCode` / `denomination` to validate the price against.
 */
export const pendingRobloxNick = new Map<number, LinkState>();
