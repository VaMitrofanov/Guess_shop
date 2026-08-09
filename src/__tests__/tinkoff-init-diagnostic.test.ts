import { initCanonicalTinkoffPayment } from "@/lib/tinkoff";

const originalFetch = global.fetch;
const ENV_KEYS = [
  "TINKOFF_TERMINAL_KEY",
  "TINKOFF_SECRET_KEY",
  "TINKOFF_TAXATION",
  "TINKOFF_ITEM_TAX",
  "TINKOFF_PAYMENT_METHOD",
  "TINKOFF_PAYMENT_OBJECT",
  "NEXT_PUBLIC_APP_URL",
  "TBANK_DIAGNOSTIC_JSON_LOGS",
] as const;
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function configureEnv(diagnostics: boolean) {
  process.env.TINKOFF_TERMINAL_KEY = "terminal";
  process.env.TINKOFF_SECRET_KEY = "super-secret-that-must-not-be-logged";
  process.env.TINKOFF_TAXATION = "usn_income";
  process.env.TINKOFF_ITEM_TAX = "none";
  process.env.TINKOFF_PAYMENT_METHOD = "full_prepayment";
  process.env.TINKOFF_PAYMENT_OBJECT = "service";
  process.env.NEXT_PUBLIC_APP_URL = "https://robloxbank.test";
  process.env.TBANK_DIAGNOSTIC_JSON_LOGS = diagnostics ? "true" : "false";
}

function restoreEnv() {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe("T-Bank Init diagnostic JSON", () => {
  afterEach(() => {
    global.fetch = originalFetch;
    restoreEnv();
    jest.restoreAllMocks();
  });

  it("writes a useful JSON exchange without secrets, email or bearer URLs", async () => {
    configureEnv(true);
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({
      Success: false,
      ErrorCode: "204",
      Message: "Неверные параметры.",
      Details: "Неверный токен.",
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const log = jest.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(initCanonicalTinkoffPayment({
      publicOrderId: "WEB-DIAGNOSTIC",
      amountKopecks: 1_000,
      receiptEmail: "owner@example.com",
      description: "Заказ WEB-DIAGNOSTIC",
      statusToken: "order-status-secret",
    })).rejects.toThrow("Неверные параметры");

    expect(log).toHaveBeenCalledTimes(1);
    const serialized = String(log.mock.calls[0][0]);
    const record = JSON.parse(serialized);
    expect(record).toMatchObject({
      event: "tbank.init.exchange",
      schemaVersion: 1,
      request: {
        method: "POST",
        url: "https://securepay.tinkoff.ru/v2/Init",
        headers: { "Content-Type": "application/json" },
        body: {
          TerminalKey: "terminal",
          Amount: 1_000,
          OrderId: "WEB-DIAGNOSTIC",
          DATA: { Email: "[REDACTED]" },
          Receipt: { Email: "[REDACTED]" },
          Token: "[REDACTED]",
        },
      },
      response: {
        httpStatus: 200,
        contentType: "application/json",
        body: { Success: false, ErrorCode: "204", Details: "Неверный токен." },
      },
    });
    expect(record.request.body).not.toHaveProperty("Password");
    expect(record.request.body).not.toHaveProperty("SecretKey");
    expect(serialized).not.toContain("super-secret-that-must-not-be-logged");
    expect(serialized).not.toContain("owner@example.com");
    expect(serialized).not.toContain("order-status-secret");
  });

  it("stays silent when the temporary diagnostic flag is disabled", async () => {
    configureEnv(false);
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({
      Success: false,
      ErrorCode: "204",
      Message: "Неверные параметры.",
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const log = jest.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(initCanonicalTinkoffPayment({
      publicOrderId: "WEB-NO-LOG",
      amountKopecks: 1_000,
      receiptEmail: "owner@example.com",
      description: "Заказ WEB-NO-LOG",
      statusToken: "order-status-secret",
    })).rejects.toThrow();

    expect(log).not.toHaveBeenCalled();
  });
});
