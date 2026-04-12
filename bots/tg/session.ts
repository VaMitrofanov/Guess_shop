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
