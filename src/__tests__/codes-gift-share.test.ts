import { buildThanksEmail, giverEmail, sharedGiftTokenFor, validateShare } from "@/lib/codes/gift-share";
import { giftOpenTokenFor, isGiftTokenShape } from "@/lib/codes/gift";

jest.mock("@/lib/prisma", () => ({ prisma: {} }));
jest.mock("@/lib/mailer", () => ({ sendMail: jest.fn() }));
jest.mock("@/lib/codes/chat-notify", () => ({ sendCodeToChat: jest.fn() }));
jest.mock("../../bots/shared/bot-bind", () => ({ issueBindToken: jest.fn() }));

describe("подарить купленный код", () => {
  const saved = { ...process.env };
  beforeAll(() => { process.env.AUTH_SECRET = "test-auth-secret"; });
  afterAll(() => { process.env = saved; });

  test("ссылкой — почта не нужна", () => {
    const result = validateShare({ theme: "BIRTHDAY", to: "Тёме", from: "Тётя Катя", message: "С днём рождения!", method: "link" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.input).toMatchObject({ method: "link", email: null, to: "Тёме" });
  });

  test("письмом — почта обязательна и приводится к нижнему регистру", () => {
    expect(validateShare({ theme: "JUST", method: "email", email: "плохо" }).ok).toBe(false);
    const ok = validateShare({ theme: "JUST", method: "email", email: "Tyoma@Example.ru" });
    expect(ok.ok && ok.input.email).toBe("tyoma@example.ru");
  });

  test("без темы, со ссылкой, слишком длинно — отказ", () => {
    expect(validateShare({ theme: "NOPE", method: "link" }).ok).toBe(false);
    expect(validateShare({ theme: "JUST", method: "link", message: "заходи t.me/scam" }).ok).toBe(false);
    expect(validateShare({ theme: "JUST", method: "link", message: "а".repeat(141) }).ok).toBe(false);
  });

  test("токен ссылки: формат как у v1, зависит от соли, не совпадает с v1", () => {
    const a = sharedGiftTokenFor("order1", "salt-a");
    const b = sharedGiftTokenFor("order1", "salt-b");
    expect(isGiftTokenShape(a)).toBe(true);
    expect(a).not.toBe(b);
    expect(a).not.toBe(giftOpenTokenFor("order1"));
  });

  test("почта дарителя: чек важнее, аккаунт — только подтверждённый", () => {
    expect(giverEmail({ payments: [{ receiptEmail: "pay@x.ru" }], creator: { email: "acc@x.ru", emailVerifiedAt: new Date() } })).toBe("pay@x.ru");
    expect(giverEmail({ payments: [], creator: { email: "acc@x.ru", emailVerifiedAt: new Date() } })).toBe("acc@x.ru");
    expect(giverEmail({ payments: [], creator: { email: "acc@x.ru", emailVerifiedAt: null } })).toBeNull();
  });

  test("письмо «спасибо» экранирует имя и не называет сроков", () => {
    const mail = buildThanksEmail({ denomination: 200, theme: "BIRTHDAY", to: "<b>Тёма</b>" });
    expect(mail.html).not.toContain("<b>Тёма</b>");
    expect(mail.html).toContain("&lt;b&gt;");
    expect(mail.text).toContain("200 Robux");
  });
});
