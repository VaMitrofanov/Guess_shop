import {
  buildRobuxEtaReply,
  buildRobuxEtaShort,
  buildRobuxEtaWbChat,
  fmtLeft,
  holdBar,
  hasOverdueOrder,
  isArrivalQuestion,
  isRepeatEtaQuestion,
  isRobuxQuestion,
  robuxPendingSeenText,
  robuxSelfCheckText,
  loadRobuxEtaOrders,
  robuxEta,
  robuxUnlockDate,
  type RobuxEtaDb,
} from "../robux-eta";

const H = 3_600_000;
const D = 24 * H;
// 18 октября 2026, 12:00 МСК
const BOUGHT = new Date("2026-10-18T09:00:00Z");

describe("срок заморозки", () => {
  it("ориентир = выкуп + 7 дней", () => {
    expect(robuxUnlockDate(BOUGHT).toISOString()).toBe("2026-10-25T09:00:00.000Z");
  });

  it("фаза меняется ровно на 7-м дне", () => {
    expect(robuxEta(BOUGHT, new Date(BOUGHT.getTime() + 7 * D - 1)).phase).toBe("holding");
    expect(robuxEta(BOUGHT, new Date(BOUGHT.getTime() + 7 * D)).phase).toBe("overdue");
  });

  it("шкала — одно деление на прошедший день", () => {
    expect(holdBar(robuxEta(BOUGHT, BOUGHT))).toBe("▱▱▱▱▱▱▱");
    expect(holdBar(robuxEta(BOUGHT, new Date(BOUGHT.getTime() + 5 * D + H)))).toBe("▰▰▰▰▰▱▱");
    expect(holdBar(robuxEta(BOUGHT, new Date(BOUGHT.getTime() + 20 * D)))).toBe("▰▰▰▰▰▰▰");
  });

  it("остаток — примерный, со склонением", () => {
    expect(fmtLeft(5 * D)).toBe("≈ 5 дней");
    expect(fmtLeft(2 * D + 3 * H)).toBe("≈ 2 дня");
    expect(fmtLeft(30 * H)).toBe("≈ 30 ч");
    expect(fmtLeft(20 * 60_000)).toBe("меньше часа");
    expect(fmtLeft(0)).toBe("срок вышел");
  });
});

describe("распознавание «где мои робуксы?»", () => {
  it.each([
    "где мои робуксы",
    "Где робуксы???",
    "когда придут робуксы",
    "робуксов нет",
    "не пришли робаксы",
    "а где мои рб",
    "robux не пришли",
    "почему не зачислили",
    "баланс пустой, где деньги?",
    "сколько ещё ждать робуксы",
    "робуксы пришли?",
    "Pending всё ещё висит, долго ещё?",
  ])("да: %s", (t) => expect(isRobuxQuestion(t)).toBe(true));

  it.each([
    "робуксы пришли, спасибо!",
    "Robux_King",
    "привет",
    "где мой геймпасс",
    "https://www.roblox.com/game-pass/123456/robux",
    "спасибо большое",
    "хочу купить 1000 робуксов",
  ])("нет: %s", (t) => expect(isRobuxQuestion(t)).toBe(false));
});

describe("ответ", () => {
  const now = new Date(BOUGHT.getTime() + 5 * D + H);

  it("один заказ в заморозке: таймер, дата, «решает Roblox», без кнопки проверки", () => {
    const r = buildRobuxEtaReply([{ amount: 1200, completedAt: BOUGHT }], "html", now)!;
    expect(r.overdue).toBe(false);
    expect(r.text).toContain("1200 R$");
    expect(r.text).toContain("до 25 октября");
    expect(r.text).toContain("▰▰▰▰▰▱▱");
    expect(r.text).toContain("≈ 2 дня");
    expect(r.text).toContain("устанавливает Roblox, а не мы");
  });

  it("срок прошёл: кнопка проверки и развилка Pending / нет строки", () => {
    const r = buildRobuxEtaReply([{ amount: 500, completedAt: BOUGHT }], "plain", new Date(BOUGHT.getTime() + 9 * D))!;
    expect(r.overdue).toBe(true);
    expect(r.text).toContain("прошёл");
    expect(r.text).toContain("нет вовсе");
    expect(r.text).not.toContain("<b>");
  });

  it("несколько заказов — строка на каждый", () => {
    const r = buildRobuxEtaReply([
      { amount: 500, completedAt: new Date(BOUGHT.getTime() - 3 * D) },
      { amount: 1200, completedAt: BOUGHT },
    ], "plain", now)!;
    expect(r.text.indexOf("1200 R$")).toBeLessThan(r.text.indexOf("500 R$"));
    expect(r.overdue).toBe(true);
  });

  it("выкуп старше 30 дней — таймера нет", () => {
    expect(buildRobuxEtaReply([{ amount: 500, completedAt: BOUGHT }], "html", new Date(BOUGHT.getTime() + 31 * D))).toBeNull();
  });

  it("короткий повтор и текст для чата WB без разметки", () => {
    expect(buildRobuxEtaShort([{ amount: 1200, completedAt: BOUGHT }], "plain", now)).toContain("до 25 октября");
    const wb = buildRobuxEtaWbChat([{ amount: 1200, completedAt: BOUGHT }], now)!;
    expect(wb.text).not.toMatch(/https?:|<b>/);
    expect(wb.text).toContain("устанавливает Roblox, а не мы");
  });

  it("повтор в течение 10 минут распознаётся", () => {
    const t = 1_000_000_000;
    expect(isRepeatEtaQuestion("test:1", t)).toBe(false);
    expect(isRepeatEtaQuestion("test:1", t + 60_000)).toBe(true);
    expect(isRepeatEtaQuestion("test:1", t + 60_000 + 11 * 60_000)).toBe(false);
  });
});

describe("выборка заказов", () => {
  function fakeDb(rows: Array<{ amount: number; completedAt: Date | null }>, newerActive: boolean): RobuxEtaDb {
    return {
      wbOrder: {
        findMany: async () => rows,
        findFirst: async () => (newerActive ? { createdAt: new Date() } : null),
      },
    };
  }

  it("есть выкуп — отдаёт заказы", async () => {
    await expect(loadRobuxEtaOrders(fakeDb([{ amount: 1200, completedAt: BOUGHT }], false), "u")).resolves.toHaveLength(1);
  });

  it("после выкупа есть заказ в работе — таймер не к месту", async () => {
    await expect(loadRobuxEtaOrders(fakeDb([{ amount: 1200, completedAt: BOUGHT }], true), "u")).resolves.toBeNull();
  });

  it("выкупов нет — null", async () => {
    await expect(loadRobuxEtaOrders(fakeDb([], false), "u")).resolves.toBeNull();
  });
});

describe("барьер перед поддержкой", () => {
  it.each([
    "когда придут?",
    "ничего не пришло",
    "где мой заказ",
    "почему до сих пор не получил",
  ])("вопрос о поступлении без слова «робуксы»: %s", (t) => expect(isArrivalQuestion(t)).toBe(true));

  it.each([
    "получил, спасибо",
    "пришло всё, спасибо большое",
    "хочу заказать ещё",
    "у меня не открывается инструкция, что делать?",
  ])("не вопрос о поступлении: %s", (t) => expect(isArrivalQuestion(t)).toBe(false));

  it("самопроверка спрашивает аккаунт и Pending, ответ «Pending есть» не зовёт поддержку", () => {
    expect(robuxSelfCheckText("plain")).toContain("тот аккаунт");
    expect(robuxSelfCheckText("plain")).toContain("Pending");
    expect(robuxPendingSeenText("plain")).not.toMatch(/менеджер|поддержк[уи] напиш/i);
  });

  it("просрочка определяется по самому старому из заказов", () => {
    const now = new Date(BOUGHT.getTime() + 8 * D);
    expect(hasOverdueOrder([{ amount: 1, completedAt: BOUGHT }], now)).toBe(true);
    expect(hasOverdueOrder([{ amount: 1, completedAt: new Date(now.getTime() - D) }], now)).toBe(false);
  });
});
