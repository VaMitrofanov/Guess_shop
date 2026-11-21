import { giftOpenTokenFor, giftTextHasLink, hashGiftToken, isGiftTokenShape, validateGift } from "@/lib/codes/gift";
import { buildGiftEmail } from "@/lib/codes/delivery";

jest.mock("@/lib/prisma", () => ({ prisma: {} }));
jest.mock("@/lib/mailer", () => ({ sendMail: jest.fn() }));
jest.mock("@/lib/codes/chat-notify", () => ({ sendCodeToChat: jest.fn() }));

describe("подарок открыткой", () => {
  const saved = { ...process.env };
  beforeAll(() => { process.env.AUTH_SECRET = "test-auth-secret"; });
  afterAll(() => { process.env = saved; });

  const now = Date.UTC(2026, 10, 15, 6, 0, 0);
  const base = { theme: "BIRTHDAY", email: "Misha@Example.ru", to: "Мише", from: "Папа", message: "С днём рождения! Трать с умом" };

  test("нормальный подарок проходит, почта приводится к нижнему регистру", () => {
    const result = validateGift(base, now);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.gift.email).toBe("misha@example.ru");
      expect(result.gift.sendAt).toBeNull();
    }
  });

  test.each([
    "Открой подарок https://evil.example",
    "заходи на www.free-robux.ru",
    "пиши в t.me/scam",
    "мой тг @robux_free",
    "сайт robux-gift.com",
  ])("ссылки в пожелании запрещены: %s", (message) => {
    expect(giftTextHasLink(message)).toBe(true);
    expect(validateGift({ ...base, message }, now).ok).toBe(false);
  });

  test("ссылка в «Кому» и «От кого» тоже запрещена", () => {
    expect(validateGift({ ...base, from: "vk.com/id1" }, now).ok).toBe(false);
    expect(validateGift({ ...base, to: "@misha_2010" }, now).ok).toBe(false);
  });

  test("пожелание длиннее 140 символов отклоняется", () => {
    expect(validateGift({ ...base, message: "а".repeat(141) }, now).ok).toBe(false);
    expect(validateGift({ ...base, message: "а".repeat(140) }, now).ok).toBe(true);
  });

  test("неизвестная открытка и кривая почта — отказ", () => {
    expect(validateGift({ ...base, theme: "HALLOWEEN" }, now).ok).toBe(false);
    expect(validateGift({ ...base, email: "misha@" }, now).ok).toBe(false);
  });

  test("отложенная отправка: будущее — запоминаем, прошлое — сразу, дальше двух месяцев — отказ", () => {
    const later = validateGift({ ...base, sendAt: new Date(now + 3 * 86_400_000).toISOString() }, now);
    expect(later.ok && later.gift.sendAt?.getTime()).toBe(now + 3 * 86_400_000);
    const past = validateGift({ ...base, sendAt: new Date(now - 3_600_000).toISOString() }, now);
    expect(past.ok && past.gift.sendAt).toBeNull();
    expect(validateGift({ ...base, sendAt: new Date(now + 70 * 86_400_000).toISOString() }, now).ok).toBe(false);
  });

  test("управляющие символы вычищаются", () => {
    const result = validateGift({ ...base, message: "Привет‮\u0000 друг" }, now);
    expect(result.ok && result.gift.message).toBe("Привет друг");
  });

  test("токен «Открыть подарок»: стабилен, неперебираемой формы, другой, чем у оплаты", () => {
    const token = giftOpenTokenFor("co123");
    expect(giftOpenTokenFor("co123")).toBe(token);
    expect(isGiftTokenShape(token)).toBe(true);
    expect(giftOpenTokenFor("co124")).not.toBe(token);
    expect(hashGiftToken(token)).not.toContain(token);
  });

  test("письмо-открытка: без кода, с кнопкой и экранированным пожеланием", () => {
    const mail = buildGiftEmail({ denomination: 1000, theme: "NEW_YEAR", to: "Миша", from: "<Папа>", message: "Ура & <b>", openUrl: "https://robloxbank.ru/gift/abc" });
    expect(mail.subject.replace(/\u00a0/g, " ")).toContain("1 000 Robux");
    expect(mail.html).toContain("Открыть подарок");
    expect(mail.html).toContain("https://robloxbank.ru/gift/abc");
    expect(mail.html).toContain("&lt;Папа&gt;");
    expect(mail.html).not.toContain("<b>»");
    expect(mail.text).toContain("С Новым годом, Миша!");
  });
});
