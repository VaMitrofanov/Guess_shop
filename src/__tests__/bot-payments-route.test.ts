import { NextRequest } from "next/server";

const mockCreateCanonical = jest.fn();
const mockInit = jest.fn();
const mockRevert = jest.fn();
const mockCreateRetry = jest.fn();
const mockAttemptUpdateMany = jest.fn();
const mockOrderUpdateMany = jest.fn();
const mockAttemptUpdate = jest.fn();
const mockOrderEventCreate = jest.fn();
const mockIntentUpdateMany = jest.fn();

jest.mock("@/lib/canonical-bot-order", () => {
  const actual = jest.requireActual("@/lib/canonical-bot-order");
  return { ...actual, createCanonicalBotOrder: mockCreateCanonical };
});
jest.mock("@/lib/tinkoff", () => ({ initCanonicalTinkoffPayment: mockInit }));
jest.mock("@/lib/web-order-benefits", () => ({ revertWebOrderBenefits: mockRevert }));
jest.mock("@/lib/payment-init-retry", () => ({ createPaymentRetry: mockCreateRetry }));
jest.mock("@/lib/prisma", () => ({
  prisma: {
    directIntent: { updateMany: mockIntentUpdateMany },
    paymentAttempt: { update: mockAttemptUpdate, updateMany: mockAttemptUpdateMany },
    wbOrder: { updateMany: mockOrderUpdateMany },
    orderEvent: { create: mockOrderEventCreate },
    $transaction: jest.fn(async (input: unknown) => {
      if (typeof input === "function") {
        return input({
          paymentAttempt: { updateMany: mockAttemptUpdateMany },
          wbOrder: { updateMany: mockOrderUpdateMany },
        });
      }
      return Promise.all(input as Promise<unknown>[]);
    }),
  },
}));

import { POST } from "@/app/api/internal/bot-payments/route";
import { signBotPaymentBody } from "@/lib/bot-payment-auth";
import { BotPaymentError } from "@/lib/canonical-bot-order";
import { prisma } from "@/lib/prisma";

const body = JSON.stringify({
  intentId: "cm123456789012345678901234",
  platform: "TG",
  subject: "777",
  receiptEmail: "buyer@example.com",
  method: "SITE",
});

function request(signed = true) {
  const timestamp = String(Date.now());
  return new NextRequest("http://localhost/api/internal/bot-payments", {
    method: "POST",
    headers: signed ? {
      "content-type": "application/json",
      "x-bot-payment-timestamp": timestamp,
      "x-bot-payment-signature": signBotPaymentBody(timestamp, body),
    } : { "content-type": "application/json" },
    body,
  });
}

function canonicalResult() {
  return {
    order: {
      id: "order-1",
      publicOrderId: "BOT-ABC",
      wbCode: "DIR-ABC",
      amount: 500,
      paymentAmountKopecks: 45_000,
      receiptEmail: "buyer@example.com",
    },
    attempt: {
      id: "attempt-1",
      provider: "TBANK",
      publicOrderId: "BOT-ABC",
      amountKopecks: 45_000,
      status: "CREATED",
      paymentUrl: null,
    },
    attemptCount: 1,
    statusToken: "status-token",
    alreadyExists: false,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.BOT_PAYMENT_API_SECRET = "test-secret-that-is-longer-than-thirty-two-characters";
  process.env.NEXT_PUBLIC_APP_URL = "https://robloxbank.test";
  mockCreateCanonical.mockResolvedValue(canonicalResult());
  mockIntentUpdateMany.mockResolvedValue({ count: 1 });
  mockAttemptUpdateMany.mockResolvedValue({ count: 1 });
  mockOrderUpdateMany.mockResolvedValue({ count: 1 });
  mockAttemptUpdate.mockResolvedValue({});
  mockOrderEventCreate.mockResolvedValue({});
  mockInit.mockResolvedValue({ paymentId: "provider-payment", paymentUrl: "https://bank.test/pay" });
  mockRevert.mockResolvedValue({});
});

test("rejects an unsigned request before touching the intent", async () => {
  const response = await POST(request(false));
  expect(response.status).toBe(401);
  expect(mockCreateCanonical).not.toHaveBeenCalled();
});

test("persists EXPIRED after the serializable create transaction rolls back", async () => {
  mockCreateCanonical.mockRejectedValue(new BotPaymentError("EXPIRED", "expired"));
  const response = await POST(request());
  expect(response.status).toBe(410);
  expect(prisma.directIntent.updateMany).toHaveBeenCalledWith({
    where: { id: "cm123456789012345678901234", status: "PENDING" },
    data: { status: "EXPIRED" },
  });
});

test("claims Init once and returns the ready site checkout", async () => {
  const response = await POST(request());
  expect(response.status).toBe(201);
  expect(mockInit).toHaveBeenCalledTimes(1);
  expect(await response.json()).toMatchObject({
    ok: true,
    paymentUrl: "https://bank.test/pay",
    statusUrl: expect.stringContaining("/payment/status?"),
  });
});

test("does not compensate benefits when provider Init succeeded but DB persistence failed", async () => {
  const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
  mockAttemptUpdate.mockRejectedValue(new Error("database unavailable"));
  const response = await POST(request());
  expect(response.status).toBe(502);
  expect(mockInit).toHaveBeenCalledTimes(1);
  expect(mockRevert).not.toHaveBeenCalled();
  consoleSpy.mockRestore();
});
