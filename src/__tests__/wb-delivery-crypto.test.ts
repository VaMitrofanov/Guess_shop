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

  it("extracts spaced or dashed six digits and redacts both secret classes", () => {
    expect(extractDeliveryCode("Код 12-34-56, спасибо")).toBe("123456");
    expect(extractDeliveryCode("Код 1 2 3 4 5 6")).toBe("123456");
    const safe = redactWbChatText("Получение 123456. Код активации: ABC1234");
    expect(safe).toBe("Получение ••••••. Код активации: •••••••");
    expect(safe).not.toContain("123456");
    expect(safe).not.toContain("ABC1234");
  });
});
