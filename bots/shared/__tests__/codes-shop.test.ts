import {
  CODES_PICK_RE,
  bestValueDenomination,
  codeChatIssuedText,
  codeChatPaidText,
  codePickScreen,
  codesHitDenomination,
  codesStoreScreen,
  inviteScreen,
  parseReferralStart,
  tierBar,
} from "../codes-shop";
import { botOrderKey } from "../codes-bot-api";
import { isShowcaseReview, reviewAuthorName, toReviewRow } from "../wb-reviews-feed";

describe("коды в ботах", () => {
  const viewer = { discountPercent: 1, invitedCount: 0, salesOpen: true, instant: true };

  test("витрина ВК укладывается в лимиты VK: ≤10 кнопок, у каждой номинал и цена", () => {
    const screen = codesStoreScreen(viewer, "https://robloxbank.ru", "VK");
    const buttons = screen.rows.flat();
    expect(buttons.length).toBeLessThanOrEqual(10);
    expect(screen.rows.length).toBeLessThanOrEqual(6);
    expect(buttons.find((b) => b.command === "codes_p:800")?.label).toBe("800 R$ · 989 ₽ 🔥");
    expect(buttons.some((b) => b.label.includes("10 000 R$") && b.label.includes("💎"))).toBe(true);
    // Не влезшие в кнопки номиналы — строкой со ссылкой на сайт.
    expect(screen.plain).toContain("10 R$ — 59 ₽");
    expect(screen.plain).toContain("2 000 R$");
    expect(screen.plain).not.toMatch(/<[a-z/]/);
    expect(screen.html).toContain("1%");
  });

  test("в TG — все 12 номиналов кнопками, 199 вместо 200; цены идут за курсом", () => {
    const screen = codesStoreScreen(viewer, "https://robloxbank.ru");
    const picks = screen.rows.flat().filter((b) => b.command?.startsWith("codes_p:"));
    expect(picks).toHaveLength(12);
    expect(picks.some((b) => b.command === "codes_p:199")).toBe(true);
    expect(picks.some((b) => b.command === "codes_p:200")).toBe(false);
    expect(CODES_PICK_RE.exec("codes_p:10")?.[1]).toBe("10");
    const pricier = codesStoreScreen({ ...viewer, discountPercent: 0, usdRub: 86 }, "https://robloxbank.ru");
    expect(pricier.rows.flat().find((b) => b.command === "codes_p:1000")?.label).toContain("1 209 ₽");
  });

  test("callback_data короче 64 байт и разбирается обратно", () => {
    const screen = codesStoreScreen(viewer, "https://robloxbank.ru");
    for (const button of screen.rows.flat()) {
      if (button.command) expect(Buffer.byteLength(button.command)).toBeLessThan(64);
    }
    expect(CODES_PICK_RE.exec("codes_p:2500")?.[1]).toBe("2500");
  });

  test("ручной режим не обещает «сразу в чат»", () => {
    const screen = codesStoreScreen({ ...viewer, instant: false }, "https://robloxbank.ru");
    expect(screen.html).toContain("пришлём код");
    const pick = codePickScreen({ denomination: 800, discountPercent: 1, instant: false, payUrl: "https://x/pay/t", shareUrl: "https://x/pay/t", publicId: "CODE-AAAA2222" });
    expect(pick.html).not.toContain("сразу после оплаты");
  });

  test("карточка заказа: цена со скидкой и одна главная кнопка оплаты", () => {
    const pick = codePickScreen({ denomination: 1000, discountPercent: 5, instant: true, payUrl: "https://robloxbank.ru/pay/t", shareUrl: "https://robloxbank.ru/pay/t", publicId: "CODE-AAAA2222" });
    expect(pick.html).toContain("1 139 ₽");
    expect(pick.rows[0]).toHaveLength(1);
    expect(pick.rows[0][0].url).toBe("https://robloxbank.ru/pay/t");
  });

  test("приглашения: шкала, следующий уровень, ссылка", () => {
    const screen = inviteScreen({ invitedCount: 4, discountPercent: 2, siteLink: "https://robloxbank.ru/r/abc234", botLink: "https://t.me/RobloxBankBot?start=r_abc234" });
    expect(screen.html).toContain("До <b>3%</b> — ещё 6 друзей");
    expect(screen.html).toContain("https://robloxbank.ru/r/abc234");
    expect(tierBar(2)).toBe("▰▰▱▱▱");
  });

  test("/start r_<код>: только своя форма", () => {
    expect(parseReferralStart("r_abc234")).toBe("abc234");
    expect(parseReferralStart("R_ABC234")).toBe("abc234");
    expect(parseReferralStart("wb_ABC1234")).toBeNull();
    expect(parseReferralStart("r_../../x")).toBeNull();
  });

  test("хит — настройка, по умолчанию 800; выгоднее всего — 10 000", () => {
    expect(codesHitDenomination({})).toBe(800);
    expect(codesHitDenomination({ CODES_HIT_DENOMINATION: "1000" })).toBe(1000);
    expect(codesHitDenomination({ CODES_HIT_DENOMINATION: "777" })).toBe(800);
    expect(bestValueDenomination(0)).toBe(10000);
  });

  test("сообщение с кодом экранирует HTML", () => {
    const text = codeChatIssuedText({ denomination: 800, code: "AB<CD>", publicId: "CODE-AAAA2222" });
    expect(text.html).toContain("<code>AB&lt;CD&gt;</code>");
    expect(text.plain).toContain("AB<CD>");
  });

  test("ключ идемпотентности — валидный UUID и стабилен в пределах окна", () => {
    const now = Date.UTC(2026, 10, 15, 6, 1, 0);
    const key = botOrderKey("TG", "1", 800, now);
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(botOrderKey("TG", "1", 800, now + 30_000)).toBe(key);
    expect(botOrderKey("TG", "1", 1000, now)).not.toBe(key);
  });
});

describe("лента отзывов WB", () => {
  const good = { id: "f1", productValuation: 5, userName: "самира алиева", text: "Заказываю не первый раз, всё пришло, рекомендую!", createdDate: "2026-11-10T10:00:00Z", nmId: 123 };

  test("5★ с текстом — на витрину, имя — первое слово", () => {
    expect(isShowcaseReview(good)).toBe(true);
    expect(toReviewRow(good)?.authorName).toBe("Самира");
  });

  test.each([
    ["4★", { ...good, productValuation: 4 }],
    ["короткий", { ...good, text: "Супер" }],
    ["надеюсь придут", { ...good, text: "Оплатил, надеюсь придут робуксы скоро" }],
    ["про обман", { ...good, text: "Не обман, всё что пишут — обман, не верьте" }],
    ["с телефоном", { ...good, text: "Всё отлично, звоните +7 900 123 45 67" }],
    ["старая версия", { ...good, childFeedbackId: "f2" }],
  ])("не на витрину: %s", (_, feedback) => {
    expect(isShowcaseReview(feedback)).toBe(false);
  });

  test("нет имени или «Покупатель» — «Покупатель»", () => {
    expect(reviewAuthorName(undefined)).toBe("Покупатель");
    expect(reviewAuthorName("Покупатель")).toBe("Покупатель");
    expect(reviewAuthorName("123")).toBe("Покупатель");
  });

  test("все отзывы хранятся (для честного счётчика), даже не отобранные", () => {
    const row = toReviewRow({ ...good, productValuation: 1, text: "Не пришло" });
    expect(row?.eligible).toBe(false);
    expect(row?.rating).toBe(1);
  });
});

describe("номер CODE-… клиенту не показываем (17.11.2026)", () => {
  it("ни в выдаче, ни в «оплата прошла», ни на экране заказа", () => {
    const texts = [
      codeChatIssuedText({ denomination: 800, code: "X", publicId: "CODE-AAAA2222" }).html,
      codeChatIssuedText({ denomination: 800, code: "X", publicId: "CODE-AAAA2222" }).plain,
      codeChatPaidText({ denomination: 800, publicId: "CODE-AAAA2222" }).html,
      codePickScreen({ denomination: 800, discountPercent: 1, instant: false, payUrl: "https://x/pay/t", shareUrl: "https://x/pay/t", publicId: "CODE-AAAA2222" }).html,
    ];
    for (const text of texts) expect(text).not.toMatch(/CODE-|AAAA2222/);
  });
});
