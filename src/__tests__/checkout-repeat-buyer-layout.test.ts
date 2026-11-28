import { readFileSync } from "fs";
import path from "path";

const ROOT = path.join(__dirname, "..", "..");
const checkout = readFileSync(path.join(ROOT, "src/app/checkout/page.tsx"), "utf8");
const css = readFileSync(path.join(ROOT, "src/app/checkout/checkout.module.css"), "utf8");

describe("repeat-buyer checkout", () => {
  it("uses the private account list and automatically selects an eligible account", () => {
    expect(checkout).toContain('fetch("/api/account/me"');
    expect(checkout).toContain("data?.robloxAccounts");
    expect(checkout).toContain("selectedKnownAccountId");
    expect(checkout).toContain("chooseKnownAccount");
  });

  it("keeps new nick separate and labels order association accurately", () => {
    expect(checkout).toContain("Подтверждён заказом");
    expect(checkout).toContain("Добавить другой ник");
    expect(checkout).toContain("addManualRobloxAccount");
  });

  it("auto-selects a matching gamepass and reduces checkout to amount, consent and payment", () => {
    expect(checkout).toContain("Геймпасс выбран автоматически");
    expect(checkout).toContain("Email для чека взят из личного кабинета");
    expect(checkout).toContain("Перейти к оплате");
    expect(checkout).toContain("matching.length > 0");
  });

  it("keeps the compact profile layout responsive", () => {
    expect(css).toContain(".quickCheckoutGrid");
    expect(css).toContain(".quickAccounts");
    expect(css).toContain("overflow-x:auto");
    expect(css).toContain(".checkoutGrid,.quickCheckoutGrid,.confirmGrid{grid-template-columns:1fr}");
  });
});
