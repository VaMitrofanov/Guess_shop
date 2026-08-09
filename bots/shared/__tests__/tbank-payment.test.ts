import { PaymentAttemptStatus } from "@prisma/client";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  cancelTbankPaymentSession,
  getTbankPaymentState,
  internalPaymentStatus,
  staleProviderPaymentNeedsCancel,
} from "../tbank-payment";

const originalEnv = process.env;

beforeEach(() => {
  process.env = {
    ...originalEnv,
    TINKOFF_TERMINAL_KEY: "terminal",
    TINKOFF_SECRET_KEY: "secret",
  };
  jest.restoreAllMocks();
});

afterAll(() => { process.env = originalEnv; });

describe("T-Bank reconciliation adapter", () => {
  it("ships the same Russian CA in the TG reconciliation image as Web Init", () => {
    const dockerfile = readFileSync(resolve(__dirname, "../../tg/Dockerfile"), "utf8");
    expect(dockerfile).toContain("COPY certs/russian-trusted-ca.pem");
    expect(dockerfile).toContain("NODE_EXTRA_CA_CERTS=/usr/local/share/ca-certificates/russian-trusted-ca.crt");
  });

  it("validates GetState identity and amount", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({
      Success: true,
      PaymentId: "pay-1",
      OrderId: "RB-1",
      Amount: 16_000,
      Status: "CONFIRMED",
    }), { status: 200 }));

    await expect(getTbankPaymentState({
      paymentId: "pay-1",
      providerOrderId: "RB-1",
      amountKopecks: 16_000,
    })).resolves.toMatchObject({ status: "CONFIRMED", amountKopecks: 16_000 });
  });

  it("fails closed on an amount mismatch", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({
      Success: true,
      PaymentId: "pay-1",
      OrderId: "RB-1",
      Amount: 15_999,
      Status: "NEW",
    }), { status: 200 }));

    await expect(getTbankPaymentState({
      paymentId: "pay-1",
      providerOrderId: "RB-1",
      amountKopecks: 16_000,
    })).rejects.toThrow("amount mismatch");
  });

  it("uses Cancel without a refund amount for an unpaid session", async () => {
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({
      Success: true,
      PaymentId: "pay-1",
      Status: "CANCELED",
    }), { status: 200 }));

    await expect(cancelTbankPaymentSession("pay-1")).resolves.toMatchObject({ status: "CANCELED" });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body).toMatchObject({ TerminalKey: "terminal", PaymentId: "pay-1" });
    expect(body).not.toHaveProperty("Amount");
    expect(body.Token).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("provider status policy", () => {
  test.each(["NEW", "FORM_SHOWED", "AUTHORIZING", "3DS_CHECKING", "AUTHORIZED"])(
    "%s is canceled after the stale boundary",
    (status) => expect(staleProviderPaymentNeedsCancel(status)).toBe(true),
  );
  test.each([
    ["CONFIRMED", PaymentAttemptStatus.CONFIRMED],
    ["REVERSED", PaymentAttemptStatus.CANCELED],
    ["DEADLINE_EXPIRED", PaymentAttemptStatus.REJECTED],
    ["REFUNDED", PaymentAttemptStatus.REFUNDED],
    ["CONFIRMING", null],
  ])("maps %s", (status, expected) => expect(internalPaymentStatus(String(status))).toBe(expected));
});
