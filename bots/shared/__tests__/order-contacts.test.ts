import {
  addedText, blockedText, declinedText, STALE_OFFER_TEXT, cluesFromOcr, contactEventText, extractOrderClues, ocrLooksUseful, maskName, offerText, parseContactCallback,
  planContactOffer, rememberOffer, takeOffer, offerKey, type FoundOrder,
} from "../order-contacts";

const base = (over: Partial<FoundOrder> = {}): FoundOrder => ({
  id: "ord_aaaaaaaaaaaa", wbCode: "9SQJ2WP", amount: 1000, status: "PENDING",
  createdAt: new Date(), completedAt: null, heldAt: null, robloxUsername: "krasotka_123106",
  probableNick: null, userId: "owner1",
  user: { id: "owner1", tgId: null, vkId: "555", name: "Анна Кравец", username: null },
  clue: "code", evidence: "9SQJ2WP", ...over,
});

function fakeDb(opts: { watched?: string[]; revoked?: number; counts?: Record<string, number> } = {}) {
  return {
    orderContact: {
      findMany: async () => (opts.watched ?? []).map((orderId) => ({ orderId })),
      groupBy: async () => Object.entries(opts.counts ?? {}).map(([orderId, n]) => ({ orderId, _count: { _all: n } })),
    },
    wbCode: { count: async () => opts.revoked ?? 0 },
  };
}

describe("extractOrderClues", () => {
  it("код текстом и в ссылке", () => {
    expect(extractOrderClues("9SQJ2WP").codes).toEqual(["9SQJ2WP"]);
    expect(extractOrderClues("вот https://robloxbank.ru/wb/9SQJ2WP спасибо").codes).toEqual(["9SQJ2WP"]);
    expect(extractOrderClues("https://robloxbank.ru/guide?source=wb&code=abc1234").codes).toEqual(["ABC1234"]);
  });
  it("код в нижнем регистре тоже код", () => {
    expect(extractOrderClues("9sqj2wp").codes).toEqual(["9SQJ2WP"]);
  });
  it("пасс по ссылке и по номеру; шесть цифр — код получения, не пасс", () => {
    expect(extractOrderClues("https://www.roblox.com/game-pass/1907029789/x").passIds).toEqual(["1907029789"]);
    expect(extractOrderClues("1907029789").passIds).toEqual(["1907029789"]);
    expect(extractOrderClues("483920").passIds).toEqual([]);
    expect(extractOrderClues("483920").codes).toEqual([]);
  });
  it("одно слово латиницей — ник; так же «ник: X»", () => {
    expect(extractOrderClues("krasotka_123106").nicks).toEqual(["krasotka_123106"]);
    expect(extractOrderClues("мой ник: Vika_Play").nicks).toEqual(["Vika_Play"]);
  });
  it("обычная речь и служебные слова — не ник", () => {
    expect(extractOrderClues("Сейчас").nicks).toEqual([]);
    expect(extractOrderClues("hello").nicks).toEqual([]);
    expect(extractOrderClues("где мои робуксы уже три дня").nicks).toEqual([]);
    expect(extractOrderClues("ok спасибо").nicks).toEqual([]);
  });
  it("код из семи букв без цифр — не код", () => {
    expect(extractOrderClues("ROBLOXX").codes).toEqual([]);
  });
});

describe("planContactOffer", () => {
  it("пишет владелец — ничего не спрашиваем", async () => {
    const plan = await planContactOffer(fakeDb(), { senderUserId: "owner1", orders: [base()] });
    expect(plan.kind).toBe("known");
  });
  it("уже подключён — ничего не спрашиваем", async () => {
    const plan = await planContactOffer(fakeDb({ watched: ["ord_aaaaaaaaaaaa"] }), { senderUserId: "u2", orders: [base()] });
    expect(plan.kind).toBe("known");
  });
  it("чужой аккаунт с кодом — предлагаем", async () => {
    const plan = await planContactOffer(fakeDb(), { senderUserId: null, orders: [base()] });
    expect(plan.kind).toBe("offer");
  });
  it("ник у заказов разных владельцев — не угадываем", async () => {
    const plan = await planContactOffer(fakeDb(), {
      senderUserId: null,
      orders: [base({ clue: "nick" }), base({ id: "ord_bbbbbbbbbbbb", userId: "owner2", clue: "nick" })],
    });
    expect(plan).toMatchObject({ kind: "blocked", reason: "ambiguous" });
  });
  it("замороженный — к человеку", async () => {
    const plan = await planContactOffer(fakeDb(), { senderUserId: null, orders: [base({ heldAt: new Date() })] });
    expect(plan).toMatchObject({ kind: "blocked", reason: "held" });
  });
  it("возврат WB по коду — к человеку", async () => {
    const plan = await planContactOffer(fakeDb({ revoked: 1 }), { senderUserId: null, orders: [base()] });
    expect(plan).toMatchObject({ kind: "blocked", reason: "revoked" });
  });
  it("пять аккаунтов — шестой только через админа", async () => {
    const plan = await planContactOffer(fakeDb({ counts: { ord_aaaaaaaaaaaa: 5 } }), { senderUserId: null, orders: [base()] });
    expect(plan).toMatchObject({ kind: "blocked", reason: "limit" });
  });
  it("выкуплен больше месяца назад — подключать незачем", async () => {
    const old = new Date(Date.now() - 40 * 24 * 3600_000);
    const plan = await planContactOffer(fakeDb(), { senderUserId: null, orders: [base({ status: "COMPLETED", completedAt: old, createdAt: old })] });
    expect(plan.kind).toBe("old");
  });
});

describe("слова", () => {
  it("по коду называем код, по нику — никогда", () => {
    expect(offerText([base()], "TG")).toContain("9SQJ2WP");
    expect(offerText([base({ clue: "nick" })], "TG")).not.toContain("9SQJ2WP");
    expect(addedText(base({ clue: "nick" }), { inBot: false })).not.toContain("9SQJ2WP");
    expect(addedText(base(), { inBot: true })).toContain("9SQJ2WP");
  });
  it("имя владельца — только инициалы", () => {
    expect(maskName("Анна Кравец")).toBe("А*** К.");
    expect(maskName("💗Ви💗чка")).toBe("В***");
    expect(maskName(null)).toBeNull();
    expect(offerText([base()], "TG")).toContain("во ВКонтакте (А*** К.)");
    expect(offerText([base()], "TG")).not.toContain("Анна");
  });
  it("строки ленты", () => {
    expect(contactEventText("CONTACT_ADDED", { via: "support_code", platform: "TG", who: "Вика" })).toBe("Добавлен контакт: Telegram «Вика» — из поддержки по коду");
    expect(contactEventText("CONTACT_REMOVED", { by: "owner" })).toBe("Контакт убран владельцем");
    expect(contactEventText("OTHER", {})).toBeNull();
  });
});

describe("кнопки", () => {
  it("разбор callback", () => {
    expect(parseContactCallback("oc_add:cmh1abcdef0001")).toEqual({ action: "add", id: "cmh1abcdef0001" });
    expect(parseContactCallback("oc_rm:x")).toBeNull();
    expect(parseContactCallback("xlink:ABC1234:u")).toBeNull();
  });
  it("«да» засчитывается только для предложенного этому аккаунту заказа", () => {
    rememberOffer(offerKey("TG", 42), [base()]);
    expect(takeOffer(offerKey("TG", 42), "ord_aaaaaaaaaaaa")).toEqual({ clue: "code", evidence: "9SQJ2WP", kind: "wb" });
    expect(takeOffer(offerKey("TG", 43), "ord_aaaaaaaaaaaa")).toBeNull();
    expect(takeOffer(offerKey("TG", 42), "ord_zzzzzzzzzzzz")).toBeNull();
  });
});

describe("скриншот (OCR)", () => {
  it("код из текста скрина чата WB, ссылка разорвана переносом строки", () => {
    const text = "Kog Bawero 3aka3a: 9SQJ2WP\nhttps://robloxbank.ru/wb/\n9SQJ2WP\nЕсли ссылка не открылась";
    expect(cluesFromOcr(text).codes).toContain("9SQJ2WP");
  });
  it("OCR перепутал 2 и Z, O и 0 — нужный вариант всё равно среди кандидатов", () => {
    expect(cluesFromOcr("code 9SQJZWP").codes).toContain("9SQJ2WP");
    expect(cluesFromOcr("AB0C1D7").codes).toContain("ABOCID7");
  });
  it("ник со скрина не берём, число вариантов ограничено", () => {
    expect(cluesFromOcr("krasotka_123106").nicks).toEqual([]);
    expect(cluesFromOcr("OOOOOOO IIIIIII").codes.length).toBeLessThanOrEqual(400);
  });
  it("признак полезного текста", () => {
    expect(ocrLooksUseful("https://robloxbank.ru/wb/")).toBe(true);
    expect(ocrLooksUseful("Pending Robux 500")).toBe(false);
  });
});

describe("голос поддержки", () => {
  it("тексты для клиента — от команды, без рода", () => {
    const all = [offerText([base()], "TG"), offerText([base(), base({ id: "ord_bbbbbbbbbbbb" })], "TG"), declinedText(), blockedText("held"), blockedText("ambiguous"), STALE_OFFER_TEXT];
    for (const t of all) expect(t).not.toMatch(/(нашла|поняла|передала|проверила|сама|найду|добавлю)\b/i);
  });
});
