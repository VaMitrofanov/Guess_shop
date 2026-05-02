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
