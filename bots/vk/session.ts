/**
 * State machine for VK users.
 *
 * States:
 *  AWAITING_LINK      — user activated a WB code and must send a gamepass URL
 *  AWAITING_REVIEW    — user's order was COMPLETED; waiting for review screenshot
 *
 * Storage: in-memory Map (VK numeric user ID → state).
 * On process restart the bot re-derives state from the DB (see handlers.ts).
 */

export type VKState =
  | { type: "AWAITING_LINK";   wbCode: string; denomination: number }
  | { type: "AWAITING_REVIEW"; orderId: string };

const store = new Map<number, VKState>();

export function getState(vkUserId: number): VKState | undefined {
  return store.get(vkUserId);
}

export function setState(vkUserId: number, state: VKState): void {
  store.set(vkUserId, state);
}

export function clearState(vkUserId: number): void {
  store.delete(vkUserId);
}
