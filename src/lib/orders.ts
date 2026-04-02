/**
 * Core business logic for Orders.
 */

export const DEFAULT_RATE = 0.85; // 1 Robux = 0.85 RUB

export function calculatePrice(amountRobux: number, rate: number = DEFAULT_RATE): number {
  if (amountRobux < 0) return 0;
  return Math.round(amountRobux * rate);
}

export function isValidRobloxUsername(username: string): boolean {
  // Roblox usernames are 3-20 characters, alphanumeric + underscores
  const regex = /^[a-zA-Z0-9_]{3,20}$/;
  return regex.test(username);
}
