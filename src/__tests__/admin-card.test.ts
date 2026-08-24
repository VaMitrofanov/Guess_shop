import { buildWebOrderCardText } from "@/lib/admin-card";
import { telegramAdminRecipients } from "@/lib/telegram";

describe("web one-tap admin card", () => {
  const realEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...realEnv };
  });

  it("makes a week-old order impossible to miss", () => {
    const text = buildWebOrderCardText({
      id: "order-1",
      amount: 1200,
      gamepassUrl: "https://www.roblox.com/game-pass/1910524659",
      platform: "TG",
      wbCode: "WYH9S21",
      userDisplay: "Alena",
      creatorName: "Victoria_vu35",
      createdAt: new Date("2026-07-11T10:00:00.000Z"),
    }, new Date("2026-07-18T14:00:00.000Z"));

    expect(text).toContain("ONE-TAP С САЙТА");
    expect(text).toContain("⏳ Возраст заказа: <b>🔴 7 дней 4 ч · недельный</b>");
    expect(text).toContain("Pass ID: <code>1910524659</code>");
  });

  it("отличает ручную ссылку от one-tap, чтобы менеджер знал про скрытый плейс", () => {
    const text = buildWebOrderCardText({
      id: "order-2",
      amount: 1000,
      gamepassUrl: "https://www.roblox.com/game-pass/1784555857",
      platform: "VK",
      wbCode: "QARJR71",
      userDisplay: "Данил",
      creatorName: "lokomotiv_2018",
      createdAt: new Date("2026-08-24T10:00:00.000Z"),
      manualLink: true,
    }, new Date("2026-08-24T10:20:00.000Z"));

    expect(text).toContain("ССЫЛКА ВРУЧНУЮ С САЙТА");
    expect(text).not.toContain("ONE-TAP С САЙТА");
  });

  it("deduplicates and trims configured admin chat IDs", () => {
    process.env = { ...realEnv, ADMIN_IDS: " 111,222,111,, 222 ", TG_CHAT_ID: "333" };
    expect(telegramAdminRecipients()).toEqual(["111", "222"]);
  });
});
