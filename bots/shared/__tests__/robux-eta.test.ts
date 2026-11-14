import {
  buildRobuxEtaReply,
  buildRobuxEtaShort,
  buildRobuxEtaWbChat,
  isArrivalQuestion,
  isRepeatEtaQuestion,
  isRobuxQuestion,
  robuxPendingSeenText,
  robuxSelfCheckText,
  loadRobuxEtaOrders,
  selfCheckTarget,
  selfCheckButtons,
  robuxScreenshotRequestText,
  intakeNeedsScreenshot,
  ROBUX_LOW_PENDING_CONTEXT,
  PENDING_INFO_URL,
  NO_ROBUX_BUTTON,
  robuxSurveyText,
  surveyButtons,
  SURVEY_CMD,
  ROBUX_CONFIRM,
  robuxConfirmText,
  PHOTO_KIND_CMD,
  PHOTO_KIND_BUTTONS,
  photoKindQuestionText,
  pendingPhotoReplyText,
  type RobuxEtaDb,
} from "../robux-eta";

const H = 3_600_000;
const D = 24 * H;
// 18 октября 2026, 12:00 МСК
const BOUGHT = new Date("2026-10-18T09:00:00Z");

/** Срок не называем нигде (26.10.2026): Roblox стал держать Pending дольше 7 дней. */
const NO_DEADLINE = /\d\s*(?:[–-]\s*\d+\s*)?(?:дн|дня|дней|сут)|ориентир|осталось|срок (?:прош|вышел)|▰|▱/i;

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
  const late = new Date(BOUGHT.getTime() + 20 * D);

  it("один заказ: «с нашей стороны всё», номинал, дата выкупа, кнопка самопроверки — без срока", () => {
    for (const at of [now, late]) {
      const r = buildRobuxEtaReply([{ amount: 1200, completedAt: BOUGHT }], "html", at)!;
      expect(r.text).toContain("1200 R$");
      expect(r.text).toContain("18 октября");
      expect(r.text).toContain("С нашей стороны всё сделано");
      expect(r.text).toContain("зависит от Roblox");
      expect(r.text).toContain("не меньше 1200");
      expect(r.text).toContain(NO_ROBUX_BUTTON);
      expect(r.text).not.toMatch(NO_DEADLINE);
    }
  });

  it("plain — без разметки", () => {
    const r = buildRobuxEtaReply([{ amount: 500, completedAt: BOUGHT }], "plain", now)!;
    expect(r.text).not.toContain("<b>");
  });

  it("несколько заказов — строка на каждый, свежий сверху", () => {
    const r = buildRobuxEtaReply([
      { amount: 500, completedAt: new Date(BOUGHT.getTime() - 3 * D) },
      { amount: 1200, completedAt: BOUGHT },
    ], "plain", now)!;
    expect(r.text.indexOf("1200 R$")).toBeLessThan(r.text.indexOf("500 R$"));
    expect(r.text).not.toMatch(NO_DEADLINE);
  });

  it("выкуп старше 30 дней — таймера нет", () => {
    expect(buildRobuxEtaReply([{ amount: 500, completedAt: BOUGHT }], "html", new Date(BOUGHT.getTime() + 31 * D))).toBeNull();
  });

  it("короткий повтор и текст для чата WB — без срока, WB без разметки", () => {
    const short = buildRobuxEtaShort([{ amount: 1200, completedAt: BOUGHT }], "plain", now)!;
    expect(short).toContain("С нашей стороны всё сделано");
    expect(short).not.toMatch(NO_DEADLINE);
    const wb = buildRobuxEtaWbChat([{ amount: 1200, completedAt: BOUGHT }], late)!;
    expect(wb.text).not.toMatch(/https?:|<b>/);
    expect(wb.text).toContain("С нашей стороны всё сделано");
    expect(wb.text).not.toMatch(NO_DEADLINE);
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

  it("ответ «Pending есть» — без срока", () => {
    expect(robuxPendingSeenText("plain")).not.toMatch(NO_DEADLINE);
    expect(robuxPendingSeenText("plain")).toContain("С нашей стороны всё сделано");
  });
});

describe("самопроверка по числу в Pending (24.10.2026)", () => {
  it("спрашивает ЧИСЛО и называет номинал и аккаунт", () => {
    const t = robuxSelfCheckText("plain", { amount: 1000, robloxUsername: "Kid123" });
    expect(t).toContain("Pending Robux");
    expect(t).toContain("число");
    expect(t).toContain("не меньше 1000");
    expect(t).toContain("Kid123");
    expect(t).toContain("а не 0");
  });

  it("кнопки помещаются в лимит VK (40 символов) даже на 10 000", () => {
    const btn = selfCheckButtons({ amount: 10000 });
    for (const label of Object.values(btn)) expect(label.length).toBeLessThanOrEqual(40);
    expect(btn.low).toContain("10000");
  });

  it("«меньше номинала» принимается только со скриншотом", () => {
    expect(intakeNeedsScreenshot(ROBUX_LOW_PENDING_CONTEXT)).toBe(true);
    expect(intakeNeedsScreenshot("robux_overdue")).toBe(false);
    expect(intakeNeedsScreenshot(undefined)).toBe(false);
    expect(robuxScreenshotRequestText("plain")).toMatch(/скриншот/i);
  });

  it("проверяем самый свежий выкуп", () => {
    const now = new Date(BOUGHT.getTime() + 9 * D);
    const fresh = { amount: 500, completedAt: new Date(now.getTime() - D) };
    const old = { amount: 1000, completedAt: BOUGHT };
    expect(selfCheckTarget([old, fresh], now)?.amount).toBe(500);
    expect(selfCheckTarget([], now)).toBeNull();
  });

  it("ответ про заморозку ведёт на страницу-объяснение", () => {
    const reply = buildRobuxEtaReply([{ amount: 1000, completedAt: BOUGHT }], "plain", new Date(BOUGHT.getTime() + D));
    expect(reply?.text).toContain(PENDING_INFO_URL);
  });
});

describe("опрос «пришли ли робуксы?» (26.10.2026)", () => {
  it("акцент: робуксы в Pending ИЛИ на балансе; без срока", () => {
    const t = robuxSurveyText("html", 800);
    expect(t).toContain("в Pending или уже на балансе");
    expect(t).toContain("800 или больше");
    expect(t).not.toMatch(NO_DEADLINE);
    expect(robuxSurveyText("plain", 800)).not.toContain("<b>");
  });

  it("кнопки влезают в лимит VK и не совпадают с командами самопроверки", () => {
    for (const label of Object.values(surveyButtons(10000))) expect(label.length).toBeLessThanOrEqual(40);
    expect(Object.values(SURVEY_CMD)).not.toContain("rbx_pend");
    expect(Object.values(SURVEY_CMD)).not.toContain("rbx_low");
  });
});

describe("«что на скриншоте?» (26.10.2026, YS3NU3X)", () => {
  it("вопрос называет оба варианта, ответ про Pending — без срока и с самопроверкой", () => {
    const q = photoKindQuestionText("plain");
    expect(q).toContain("Отзыв на Wildberries");
    expect(q).toContain("Transactions / Pending");
    const a = pendingPhotoReplyText("html");
    expect(a).not.toMatch(NO_DEADLINE);
    expect(a).toContain(NO_ROBUX_BUTTON);
  });

  it("кнопки влезают в лимит VK и не пересекаются с другими командами", () => {
    for (const l of Object.values(PHOTO_KIND_BUTTONS)) expect(l.length).toBeLessThanOrEqual(40);
    for (const c of Object.values(PHOTO_KIND_CMD)) expect(Object.values(SURVEY_CMD)).not.toContain(c);
  });
});

describe("«✅ Робуксы поступили» (27.10.2026)", () => {
  it("кнопка — та же команда, что «уже на балансе» в опросе, и влезает в VK", () => {
    expect(ROBUX_CONFIRM.command).toBe(SURVEY_CMD.got);
    expect(ROBUX_CONFIRM.label.length).toBeLessThanOrEqual(40);
  });

  it("просьба нажать есть в ответе «где робуксы?», в «в Pending — всё ок» и в рассылке; срока нет", () => {
    const eta = buildRobuxEtaReply([{ amount: 800, completedAt: BOUGHT }], "plain", new Date(BOUGHT.getTime() + D))!.text;
    expect(eta).toContain(ROBUX_CONFIRM.label);
    expect(robuxPendingSeenText("plain")).toContain(ROBUX_CONFIRM.label);
    const t = robuxConfirmText("html", 800);
    expect(t).toContain("800 R$");
    expect(t).not.toMatch(NO_DEADLINE);
  });
});
