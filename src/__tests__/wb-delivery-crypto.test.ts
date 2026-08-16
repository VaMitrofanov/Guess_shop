import {
  decryptWbSecret,
  encryptWbSecret,
  extractDeliveryCode,
  redactWbChatText,
  wbDeliveryCryptoReady,
  wbSecretHmac,
} from "../../bots/shared/wb-delivery-crypto";

describe("WB delivery secret boundary", () => {
  const previous = process.env.WB_DELIVERY_ENCRYPTION_KEY;

  beforeAll(() => {
    process.env.WB_DELIVERY_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  });

  afterAll(() => {
    if (previous === undefined) delete process.env.WB_DELIVERY_ENCRYPTION_KEY;
    else process.env.WB_DELIVERY_ENCRYPTION_KEY = previous;
  });

  it("encrypts delivery codes with purpose-bound authenticated encryption", () => {
    expect(wbDeliveryCryptoReady()).toBe(true);
    const envelope = encryptWbSecret("123456", "delivery-code");
    expect(envelope).not.toContain("123456");
    expect(decryptWbSecret(envelope, "delivery-code")).toBe("123456");
    expect(() => decryptWbSecret(envelope, "reply-sign")).toThrow();
  });

  it("rejects a tampered envelope", () => {
    const envelope = encryptWbSecret("654321", "delivery-code");
    const tampered = `${envelope.slice(0, -1)}${envelope.endsWith("A") ? "B" : "A"}`;
    expect(() => decryptWbSecret(tampered, "delivery-code")).toThrow();
  });

  it("creates deterministic HMAC without exposing the code", () => {
    const first = wbSecretHmac("123456", "delivery-code");
    expect(first).toBe(wbSecretHmac("123456", "delivery-code"));
    expect(first).not.toContain("123456");
    expect(first).not.toBe(wbSecretHmac("123457", "delivery-code"));
  });

  it("extracts spaced or dashed six digits", () => {
    expect(extractDeliveryCode("Код 12-34-56, спасибо")).toBe("123456");
    expect(extractDeliveryCode("Код 1 2 3 4 5 6")).toBe("123456");
    expect(extractDeliveryCode("995757")).toBe("995757");
    expect(extractDeliveryCode("нет цифр")).toBeNull();
  });

  it("accepts a five-digit code only when the buyer sent nothing else", () => {
    expect(extractDeliveryCode("12345")).toBe("12345");
    expect(extractDeliveryCode(" 12345. ")).toBe("12345");
    expect(extractDeliveryCode("мой заказ 12345 когда приедет?")).toBeNull();
    expect(extractDeliveryCode("Код 12345 и заказ 987654")).toBe("987654");
  });

  /** Owner decision 15.08.2026: the delivery code stays readable in the chat
   * transcript so operators can reconcile with the WB cabinet. Only our own
   * seven-character activation code must never survive there. */
  /** Regression: WB echoed our gate message back with CRLF, so the exact-text
   * match that reconciles the local preview with the provider event missed and
   * the operator saw the same outgoing message twice. */
  it("canonicalises newlines so an echoed message matches our own copy", () => {
    expect(redactWbChatText("строка\r\nвторая\rтретья")).toBe("строка\nвторая\nтретья");
    expect(redactWbChatText("Код: ABC1234\r\nдальше")).toBe(redactWbChatText("Код: ABC1234\nдальше"));
  });

  it("redacts the activation code but keeps the buyer's delivery code readable", () => {
    const safe = redactWbChatText("Получение 123456. Код активации: ABC1234");
    expect(safe).toBe("Получение 123456. Код активации: •••••••");
    expect(safe).not.toContain("ABC1234");
  });
});
