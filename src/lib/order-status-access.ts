import crypto from "crypto";
import { hashStatusToken } from "@/lib/canonical-web-order";

/** Constant-time comparison shared by every order-status bearer surface. */
export function orderStatusTokenMatches(candidate: string, expectedHash: string | null) {
  if (!candidate || !expectedHash || !/^[a-f0-9]{64}$/i.test(expectedHash)) return false;
  const actual = Buffer.from(hashStatusToken(candidate), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
