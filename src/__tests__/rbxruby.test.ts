import crypto from "node:crypto";
import { rbxrubyOrderId, rbxrubyReserveUsd, verifyRbxrubySign } from "@/lib/rbxruby";

describe("RBXRUBY", () => {
  const key = "test-key";
  const signed = (body: Record<string, unknown>) => ({
    ...body,
    sign: crypto.createHash("md5").update(Buffer.from(JSON.stringify(body)).toString("base64") + key).digest("hex"),
  });

  it("подпись вебхука: верная проходит, подмена поля — нет", () => {
    const body = signed({ type: "gamepass_order", orderId: "rb-ABC", status: "Completed", price: 2.574, vendorId: "" });
    expect(verifyRbxrubySign(body, key)).toBe(true);
    expect(verifyRbxrubySign({ ...body, status: "Error" }, key)).toBe(false);
    expect(verifyRbxrubySign({ ...body, sign: undefined }, key)).toBe(false);
    expect(verifyRbxrubySign(body, "other")).toBe(false);
  });

  it("резерв: 715 R$ по 3.8 = $2.717 (факт 2LNBMZS $2.574 — по курсу продавца)", () => {
    expect(rbxrubyReserveUsd(715, 3.8)).toBe(2.717);
  });

  it("id заказа у площадки стабилен", () => {
    expect(rbxrubyOrderId("2LNBMZS", 1)).toBe("rb-2LNBMZS");
    expect(rbxrubyOrderId("2LNBMZS", 2)).toBe("rb-2LNBMZS-2");
  });
});
