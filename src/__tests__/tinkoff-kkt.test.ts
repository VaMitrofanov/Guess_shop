import { buildCanonicalReceipt, buildTinkoffToken } from "@/lib/tinkoff";

describe("T-Bank KKT contract", () => {
  beforeEach(() => {
    process.env.TINKOFF_TAXATION = "usn_income";
    process.env.TINKOFF_ITEM_TAX = "none";
    process.env.TINKOFF_PAYMENT_METHOD = "full_prepayment";
    process.env.TINKOFF_PAYMENT_OBJECT = "service";
  });

  it("keeps receipt totals exactly equal in integer kopecks", () => {
    const receipt = buildCanonicalReceipt(" BUYER@EXAMPLE.COM ", 12_345);
    expect(receipt.Email).toBe("buyer@example.com");
    expect(receipt.Items).toEqual([expect.objectContaining({ Price: 12_345, Quantity: 1, Amount: 12_345 })]);
    expect(receipt.Items.reduce((sum, item) => sum + item.Amount * item.Quantity, 0)).toBe(12_345);
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])("rejects unsafe receipt amount %p", (amount) => {
    expect(() => buildCanonicalReceipt("buyer@example.com", amount)).toThrow();
  });

  it("excludes nested fiscal data and token from signature", () => {
    const base = { TerminalKey: "DEMO", Amount: 1000, OrderId: "A", Receipt: { Email: "a@b.c" } };
    expect(buildTinkoffToken(base, "secret")).toBe(buildTinkoffToken({ ...base, Token: "forged", Receipt: { Email: "other@b.c" } }, "secret"));
  });

  it("matches T-Bank's published SHA-256 control vector", () => {
    expect(buildTinkoffToken({
      TerminalKey: "MerchantTerminalKey",
      Amount: 19_200,
      OrderId: "00000",
      Description: "Подарочная карта на 1000 рублей",
    }, "11111111111111")).toBe("72dd466f8ace0a37a1f740ce5fb78101712bc0665d91a8108c7c8a0ccd426db2");
  });
});
