import { faqContextLines, faqStage, personalFaqAnswer, priceLabelSuffix, STAGE_KEYS } from "../smart-faq";
import { robuxWaitText } from "../robux-wait";

const NOW = new Date("2026-11-15T12:00:00Z").getTime();
const base = { wbCode: "ZT8BW8D", amount: 500, status: "AWAITING_GAMEPASS", completedAt: null, robloxUsername: "Misha2010", isDirectOrder: false, heldAt: null };

describe("умный FAQ", () => {
  it("этап по статусу", () => {
    expect(faqStage(base, NOW)).toBe("gp");
    expect(faqStage({ ...base, status: "PENDING" }, NOW)).toBe("queue");
    expect(faqStage({ ...base, status: "COMPLETED", completedAt: new Date(NOW - 86_400_000) }, NOW)).toBe("done");
    expect(faqStage({ ...base, status: "COMPLETED", completedAt: new Date(NOW - 40 * 86_400_000) }, NOW)).toBe("none");
    expect(faqStage(null, NOW)).toBe("none");
  });

  it("на этапе пасса сверху вопросы про пасс, цена — своей цифрой", () => {
    expect(STAGE_KEYS.gp[0]).toBe("how_gp");
    expect(priceLabelSuffix(base, "gp")).toBe(" — 715 R$");
    expect(personalFaqAnswer("price", base, "gp", "plain", "tg")).toContain("715 R$");
  });

  it("большой заказ не получает одну цену", () => {
    expect(priceLabelSuffix({ ...base, amount: 3000 }, "gp")).toBe("");
    expect(personalFaqAnswer("price", { ...base, amount: 3000 }, "gp", "plain", "tg")).toContain("несколько геймпассов");
  });

  it("шапка показывает заказ и этап, код копируется", () => {
    const lines = faqContextLines(base, "gp", "html").join("\n");
    expect(lines).toContain("<code>ZT8BW8D</code>");
    expect(lines).toContain("ждём твой геймпасс");
  });

  it("«не тот ник» ведёт на кнопку, которая на этом этапе есть", () => {
    expect(personalFaqAnswer("wrong_gp", base, "gp", "plain", "tg")).toContain("Ввести ник Roblox");
    expect(personalFaqAnswer("wrong_gp", { ...base, status: "PENDING" }, "queue", "plain", "tg")).toContain("Изменить заказ");
  });
});

describe("текст ожидания Robux", () => {
  it("ориентир есть, дат и отсчёта нет, виновата механика игры", () => {
    const t = robuxWaitText("ty");
    expect(t).toContain("до 30 дней");
    expect(t).toContain("внутренняя механика");
    expect(t).toContain("перевод на проверке");
    expect(t).toContain("твоём аккаунте");
    expect(t).not.toMatch(/осталось|до \d+ (ноября|декабря)|через \d+/);
    expect(robuxWaitText("vy")).toContain("вашем аккаунте");
  });
});
