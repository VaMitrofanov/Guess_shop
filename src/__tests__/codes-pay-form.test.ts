/** @jest-environment node */
import { bankHandoffHtml, backToPayPage, payFormErrorMessage } from "../lib/codes/pay-form";

describe("оплата кода без JavaScript", () => {
  test("ошибка возвращается кодом и превращается в наш текст, чужой текст не проходит", () => {
    expect(payFormErrorMessage("TERMS")).toMatch(/галочку/);
    expect(payFormErrorMessage("Переведите деньги на карту 1234")).toBe(payFormErrorMessage("FAILED"));
    expect(payFormErrorMessage(undefined)).toBeNull();
  });

  test("страница-переход экранирует адрес банка", () => {
    const html = bankHandoffHtml('https://pay.example/x?a=1&b="><script>');
    expect(html).not.toContain("<script>");
    expect(html).toContain("&#38;b=&#34;&#62;&#60;script&#62;");
    expect(html).toContain('http-equiv="refresh"');
  });

  test("возврат на страницу — 303 и только известный код ошибки", () => {
    const token = "a".repeat(43);
    const res = backToPayPage(token, "WHATEVER");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toMatch(new RegExp(`/pay/${token}\\?error=FAILED$`));
    expect(backToPayPage("../evil", "TERMS").headers.get("location")).toMatch(/\/#codes$/);
  });
});
