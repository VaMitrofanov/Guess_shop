import crypto from "node:crypto";
import {
  deterministicBotPublicOrderId,
  deterministicBotStatusToken,
  signBotPaymentBody,
  verifyBotPaymentBody,
} from "@/lib/bot-payment-auth";

describe("bot payment request authentication", () => {
  beforeEach(() => {
    process.env.BOT_PAYMENT_API_SECRET = "test-secret-that-is-longer-than-thirty-two-characters";
  });

  test("signs the exact timestamp and body and verifies in constant-time path", () => {
    const timestamp = "1770000000000";
    const body = JSON.stringify({ intentId: "intent-1", method: "SITE" });
    const expected = crypto.createHmac("sha256", process.env.BOT_PAYMENT_API_SECRET!)
      .update(`${timestamp}.${body}`, "utf8").digest("hex");
    expect(signBotPaymentBody(timestamp, body)).toBe(expected);
    expect(verifyBotPaymentBody({ timestamp, signature: expected, body, now: Number(timestamp) })).toBe(true);
    expect(verifyBotPaymentBody({ timestamp, signature: expected, body: `${body} `, now: Number(timestamp) })).toBe(false);
  });

  test("rejects stale requests", () => {
    const timestamp = "1770000000000";
    const body = "{}";
    expect(verifyBotPaymentBody({
      timestamp,
      signature: signBotPaymentBody(timestamp, body),
      body,
      now: Number(timestamp) + 5 * 60_000 + 1,
    })).toBe(false);
  });

  test("derives stable opaque order and status identifiers without exposing intent id", () => {
    const intentId = "cm1234567890example";
    const orderId = deterministicBotPublicOrderId(intentId);
    const token = deterministicBotStatusToken(intentId);
    expect(orderId).toMatch(/^BOT-[A-F0-9]{20}$/);
    expect(token.length).toBeGreaterThanOrEqual(40);
    expect(orderId).not.toContain(intentId);
    expect(deterministicBotPublicOrderId(intentId)).toBe(orderId);
    expect(deterministicBotStatusToken(intentId)).toBe(token);
  });
});
