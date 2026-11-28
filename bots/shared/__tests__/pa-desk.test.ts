/**
 * Разметка чатов поддержки @RobloxBank_PA (12.11.2026).
 */
import { answeredByReaction, badReviewMark, deskDecision, heartTarget, isThanksLike, type HeartMsg, isDeskLabel, nextContactName, type DeskOrder } from "../pa-desk";

const o = (over: Partial<DeskOrder> = {}): DeskOrder => ({
  wbCode: "ZT8BW8D", amount: 500, status: "COMPLETED", createdAt: new Date("2026-11-10T10:00:00Z"),
  heldAt: null, openFlags: false, ...over,
});

describe("deskDecision", () => {
  it("без заказов — «Новые», без метки", () => {
    expect(deskDecision([])).toEqual({ folder: "NEW", tag: null });
  });

  it("всё выкуплено — «Готово»", () => {
    expect(deskDecision([o()])).toEqual({ folder: "DONE", tag: "ZT8BW8D · 500 · выкуплен" });
  });

  it("активный заказ важнее свежего выкупленного", () => {
    const d = deskDecision([
      o({ wbCode: "NEWDONE", createdAt: new Date("2026-11-12T10:00:00Z") }),
      o({ wbCode: "WAITGP1", status: "AWAITING_GAMEPASS", amount: 1000 }),
    ]);
    expect(d).toEqual({ folder: "QUEUE", tag: "WAITGP1 · 1000 · ждём пасс · +1" });
  });

  it("заморозка или ошибка — «Проблемы», метка про проблемный заказ", () => {
    const d = deskDecision([o({ status: "PENDING" }), o({ wbCode: "HELD123", status: "AWAITING_GAMEPASS", heldAt: new Date() })]);
    expect(d.folder).toBe("PROBLEM");
    expect(d.tag).toContain("HELD123 · 500 · заморожен");
    expect(deskDecision([o({ status: "ERROR" })]).folder).toBe("PROBLEM");
  });

  it("пометка на выкупленном заказе не делает его проблемой", () => {
    expect(deskDecision([o({ openFlags: true })]).folder).toBe("DONE");
    expect(deskDecision([o({ status: "PENDING", openFlags: true })]).folder).toBe("PROBLEM");
  });
});

describe("имя контакта", () => {
  it("наша метка узнаётся, имя оператора — нет", () => {
    expect(isDeskLabel("Анна · ZT8BW8D · 500 · выкуплен")).toBe(true);
    expect(isDeskLabel("Анна мама Пети")).toBe(false);
    // Прямой заказ: код вида DIR-060947AC.
    expect(isDeskLabel("♬ · DIR-060947AC · 300 · выкуплен · +6")).toBe(true);
  });

  it("незнакомец с заказом получает метку", () => {
    expect(nextContactName({ isContact: false, currentName: "Анна", fallbackName: "Анна", tag: "ZT8BW8D · 500 · выкуплен" }))
      .toBe("Анна · ZT8BW8D · 500 · выкуплен");
  });

  it("метка обновляется при смене стадии, имя сохраняется", () => {
    expect(nextContactName({ isContact: true, currentName: "Анна · ZT8BW8D · 500 · ждём пасс", fallbackName: "x", tag: "ZT8BW8D · 500 · выкуплен" }))
      .toBe("Анна · ZT8BW8D · 500 · выкуплен");
  });

  it("контакт, переименованный оператором, не трогаем", () => {
    expect(nextContactName({ isContact: true, currentName: "Анна (мама Пети)", fallbackName: "Анна", tag: "ZT8BW8D · 500 · выкуплен" })).toBeNull();
  });

  it("без изменений и без заказов — ничего не делаем", () => {
    expect(nextContactName({ isContact: true, currentName: "Анна · ZT8BW8D · 500 · выкуплен", fallbackName: "x", tag: "ZT8BW8D · 500 · выкуплен" })).toBeNull();
    expect(nextContactName({ isContact: false, currentName: "Анна", fallbackName: "Анна", tag: null })).toBeNull();
  });

  it("плохой отзыв — хвост метки, и метка остаётся нашей", () => {
    const tag = `ZT8BW8D · 500 · выкуплен${badReviewMark(1)}`;
    expect(tag).toBe("ZT8BW8D · 500 · выкуплен · ★1 отзыв");
    expect(isDeskLabel(`Анна · ${tag}`)).toBe(true);
    expect(badReviewMark(null)).toBe("");
  });

  it("длинное имя не выходит за 64 символа", () => {
    const n = nextContactName({ isContact: false, currentName: "А".repeat(80), fallbackName: "x", tag: "ZT8BW8D · 2000 · выкупается · +12" })!;
    expect(n.length).toBeLessThanOrEqual(64);
  });
});

describe("реакция поддержки = ответ (17.11.2026)", () => {
  it("наша реакция (chosenOrder) закрывает «без ответа»", () => {
    expect(answeredByReaction({ results: [{ chosenOrder: 0 }] })).toBe(true);
    expect(answeredByReaction({ results: [{}], recentReactions: [{ my: true }] })).toBe(true);
  });
  it("реакция клиента на своё же сообщение — не ответ; без реакций — не ответ", () => {
    expect(answeredByReaction({ results: [{ chosenOrder: null }], recentReactions: [{ my: false }] })).toBe(false);
    expect(answeredByReaction(undefined)).toBe(false);
  });
});

describe("заказ кода в метке чата", () => {
  it("оплаченный код — «к выкупу», в метке короткий номер без CODE-", () => {
    const d = deskDecision([{ wbCode: "JKTTGD5S", amount: 1000, status: "CODE_PAID", createdAt: new Date(), heldAt: null, openFlags: false }]);
    expect(d).toEqual({ folder: "QUEUE", tag: "JKTTGD5S · 1000 · код: выдать" });
    expect(isDeskLabel(`Тайота · ${d.tag}`)).toBe(true);
  });
});

describe("авто-❤️ на финальное «спасибо» (17.11.2026)", () => {
  const ours = { out: true, text: "Вот логин и пароль", ourReaction: false };
  const c = (text: string, extra: Partial<HeartMsg> = {}): HeartMsg => ({ out: false, text, ourReaction: false, ...extra });

  it.each([
    "Спасибо!",
    "спс",
    "Огромное спасибо 🙏",
    "Всё пришло, спасибо большое",
    "А поняла,спасибо,все вошла,извините... реально просто не догоняю как и что здесь надо делать,спасибо за помощь",
    "Благодарю за помощь",
  ])("благодарность: %s", (text) => {
    expect(isThanksLike(text)).toBe("thanks");
  });

  it.each([
    "спасибо, а когда придут робуксы?",
    "Спасибо, но робуксы не пришли",
    "спасибо, жду",
    "спасибо, ещё не зачислили",
    "Спасибо, верните деньги",
    "Здравствуйте",
    "Мой ник Misha2010",
  ])("не финал: %s", (text) => {
    expect(isThanksLike(text)).toBeNull();
  });

  it("❤️ — когда последним отвечали мы, а хвост клиента — благодарность", () => {
    expect(heartTarget([c("спасибо за помощь"), ours])).toBe(0);
    expect(heartTarget([c("спасибо"), c("всё пришло"), ours])).toBe(0);
  });

  it("не ставим: нет нашего ответа, только «ок», уже стоит реакция, стикер, длинный хвост", () => {
    expect(heartTarget([c("спасибо")])).toBeNull();
    expect(heartTarget([c("ок"), ours])).toBeNull();
    expect(heartTarget([c("спасибо", { ourReaction: true }), ours])).toBeNull();
    expect(heartTarget([c("", { media: true }), c("спасибо"), ours])).toBeNull();
    expect(heartTarget([c("спасибо"), c("спасибо"), c("спасибо"), c("спасибо"), ours])).toBeNull();
    expect(heartTarget([c("спасибо"), c("а когда придут?"), ours])).toBeNull();
    expect(heartTarget([c("спасибо"), { out: true, text: "📌 Ваш заказ · 500 R$", ourReaction: false }, c("где робуксы")])).toBeNull();
  });
});

describe("isBuyIntent — 💸 Прямые", () => {
  const { isBuyIntent } = jest.requireActual("../pa-desk") as typeof import("../pa-desk");
  it.each(["Хочу купить робуксы", "сколько стоит 1000?", "Можно ли заказать ещё", "хочу ещё 500", "а цена какая", "есть коды?"])("да: %s", (t) => expect(isBuyIntent(t)).toBe(true));
  it.each(["где мои робуксы?", "спасибо, пришли", "не могу создать геймпасс"])("нет: %s", (t) => expect(isBuyIntent(t)).toBe(false));
});
