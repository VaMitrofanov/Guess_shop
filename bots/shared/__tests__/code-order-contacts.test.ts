import {
  addCodeOrderContact, codeAddedText, codeOfferText, codeOrderContextLine, codeOwnerNoticeText, cluesFromOcr, extractCodeOrderIds,
  extractOrderClues, findCodeOrders, nameKey, planCodeContact, rememberOffer, takeOffer, offerKey, type FoundCodeOrder,
} from "../order-contacts";

const NOW = new Date("2026-11-18T10:00:00Z").getTime();
const row = (over: Record<string, unknown> = {}) => ({
  id: "co_aaaaaaaaaaaa", publicId: "CODE-H2U9TA58", denomination: 800, status: "ISSUED",
  createdAt: new Date("2026-11-17T12:01:00Z"), issuedAt: new Date("2026-11-17T21:37:00Z"), refundedAt: null,
  creatorUserId: "vkUser", creator: { id: "vkUser", tgId: null, vkId: "34345713", name: "Екатерина Никитина", username: null },
  ...over,
});

describe("номер заказа кода", () => {
  it("CODE-… в любом регистре и с пробелом; голые 8 знаков из алфавита", () => {
    expect(extractCodeOrderIds("мой заказ CODE-H2U9TA58")).toEqual(["H2U9TA58"]);
    expect(extractCodeOrderIds("code h2u9ta58")).toEqual(["H2U9TA58"]);
    expect(extractCodeOrderIds("H2U9TA58")).toEqual(["H2U9TA58"]);
  });
  it("код WB (7 знаков), слова без цифр и знаки вне алфавита — не номер", () => {
    expect(extractCodeOrderIds("9SQJ2WP")).toEqual([]);
    expect(extractCodeOrderIds("подскажите пожалуйста")).toEqual([]);
    expect(extractCodeOrderIds("ABCDEFGH")).toEqual([]);
    expect(extractCodeOrderIds("AB0D1234")).toEqual([]); // 0 и 1 в номере не бывает
  });
  it("попадает в общие улики и со скриншота — только с префиксом", () => {
    expect(extractOrderClues("CODE-H2U9TA58").codeOrders).toEqual(["H2U9TA58"]);
    expect(cluesFromOcr("Заказ CODE-H2U9TA58 оплачен").codeOrders).toEqual(["H2U9TA58"]);
    expect(cluesFromOcr("H2U9TA58").codeOrders).toEqual([]);
  });
});

describe("имя профиля", () => {
  it("порядок слов, регистр и ё не важны; одно слово — не имя", () => {
    expect(nameKey("Никитина Екатерина")).toBe(nameKey("екатерина  НИКИТИНА"));
    expect(nameKey("Алёна Ёлкина")).toBe(nameKey("Алена Елкина"));
    expect(nameKey("Катя")).toBeNull();
    expect(nameKey(null)).toBeNull();
  });
});

function fakeDb(rows: ReturnType<typeof row>[], contacts: Array<{ codeOrderId: string; userId: string; removedAt?: Date | null; id?: string }> = []) {
  const events: unknown[] = [];
  return {
    events,
    contacts,
    codeOrder: {
      findMany: async ({ where }: { where: { publicId?: { in: string[] } } }) =>
        where.publicId ? rows.filter((r) => where.publicId!.in.includes(r.publicId)) : rows,
      findUnique: async ({ where }: { where: { id: string } }) => rows.find((r) => r.id === where.id) ?? null,
    },
    codeOrderContact: {
      findMany: async ({ where }: { where: { userId: string } }) => contacts.filter((c) => c.userId === where.userId && !c.removedAt),
      findUnique: async ({ where }: { where: { codeOrderId_userId: { codeOrderId: string; userId: string } } }) =>
        contacts.find((c) => c.codeOrderId === where.codeOrderId_userId.codeOrderId && c.userId === where.codeOrderId_userId.userId) ?? null,
      count: async () => contacts.filter((c) => !c.removedAt).length,
      create: async ({ data }: { data: { codeOrderId: string; userId: string } }) => { const c = { ...data, id: "cc1" }; contacts.push(c); return c; },
      update: async ({ where }: { where: { id: string } }) => ({ id: where.id }),
    },
    codeOrderEvent: { create: async (e: unknown) => { events.push(e); return e; } },
  };
}

describe("поиск заказа кода", () => {
  it("по номеру", async () => {
    const db = fakeDb([row()]);
    const found = await findCodeOrders(db, { ids: ["H2U9TA58"] });
    expect(found.map((f) => [f.publicId, f.clue, f.amount])).toEqual([["CODE-H2U9TA58", "code", 800]]);
  });
  it("по имени — тот самый случай @NikitinaEO", async () => {
    const db = fakeDb([row()]);
    const found = await findCodeOrders(db, { senderName: "Никитина Екатерина", now: NOW });
    expect(found.map((f) => f.clue)).toEqual(["name"]);
  });
  it("тёзки — два разных покупателя под одним именем: не угадываем", async () => {
    const db = fakeDb([row(), row({ id: "co_bbbbbbbbbbbb", publicId: "CODE-ZZZZ2222", creatorUserId: "other", creator: { id: "other", tgId: null, vkId: "1", name: "Никитина Екатерина", username: null } })]);
    expect(await findCodeOrders(db, { senderName: "Екатерина Никитина", now: NOW })).toEqual([]);
  });
  it("другое имя — ничего", async () => {
    expect(await findCodeOrders(fakeDb([row()]), { senderName: "Иван Петров", now: NOW })).toEqual([]);
  });
});

describe("план и привязка", () => {
  const found = (over: Partial<FoundCodeOrder> = {}): FoundCodeOrder => ({
    id: "co_aaaaaaaaaaaa", publicId: "CODE-H2U9TA58", amount: 800, status: "ISSUED", createdAt: new Date("2026-11-17T12:01:00Z"),
    issuedAt: null, creatorUserId: "vkUser", user: null, clue: "code", evidence: "CODE-H2U9TA58", ...over,
  });
  it("владелец сам — ничего не спрашиваем; чужой — предлагаем; уже подключён — known", async () => {
    expect((await planCodeContact(fakeDb([]), { senderUserId: "vkUser", orders: [found()] })).kind).toBe("known");
    expect((await planCodeContact(fakeDb([]), { senderUserId: "tgUser", orders: [found()] })).kind).toBe("offer");
    expect((await planCodeContact(fakeDb([]), { senderUserId: null, orders: [found()] })).kind).toBe("offer");
    const db = fakeDb([], [{ codeOrderId: "co_aaaaaaaaaaaa", userId: "tgUser" }]);
    expect((await planCodeContact(db, { senderUserId: "tgUser", orders: [found()] })).kind).toBe("known");
  });
  it("подключение пишет событие; повтор — тот же контакт; свой заказ — own", async () => {
    const db = fakeDb([row()]);
    const a = await addCodeOrderContact(db, { codeOrderId: "co_aaaaaaaaaaaa", userId: "tgUser", via: "support_name", platform: "TG", label: "Екатерина" });
    expect(a.ok && a.created).toBe(true);
    expect(db.events).toHaveLength(1);
    const b = await addCodeOrderContact(db, { codeOrderId: "co_aaaaaaaaaaaa", userId: "tgUser", via: "support_name", platform: "TG", label: "Екатерина" });
    expect(b.ok && !b.created).toBe(true);
    expect(await addCodeOrderContact(db, { codeOrderId: "co_aaaaaaaaaaaa", userId: "vkUser", via: "support_code", platform: "TG", label: "x" })).toEqual({ ok: false, reason: "own" });
  });
  it("возврат или неоплаченный — не подключаем", async () => {
    const db = fakeDb([row({ refundedAt: new Date() })]);
    expect(await addCodeOrderContact(db, { codeOrderId: "co_aaaaaaaaaaaa", userId: "tgUser", via: "support_code", platform: "TG", label: "x" })).toEqual({ ok: false, reason: "no_order" });
  });
  it("кнопка помнит, что это заказ кода", () => {
    rememberOffer(offerKey("TG", 42), [found()], "code");
    expect(takeOffer(offerKey("TG", 42), "co_aaaaaaaaaaaa")?.kind).toBe("code");
  });
});

describe("слова", () => {
  const o: FoundCodeOrder = {
    id: "x", publicId: "CODE-H2U9TA58", amount: 800, status: "ISSUED", createdAt: new Date("2026-11-17T12:01:00Z"), issuedAt: null,
    creatorUserId: "vkUser", user: { id: "vkUser", tgId: null, vkId: "1", name: "Екатерина Никитина", username: null }, clue: "name", evidence: "",
  };
  it("клиенту не называем ни номер заказа, ни сам код; имя — инициалами", () => {
    for (const t of [codeOfferText([o], "TG"), codeAddedText(o), codeOwnerNoticeText(o, { platform: "TG", label: "Катя" }), codeOrderContextLine(o)]) {
      expect(t).not.toMatch(/CODE-|H2U9TA58/);
    }
    expect(codeOfferText([o], "TG")).toContain("Е*** Н.");
    expect(codeOfferText([o], "TG")).toContain("800 R$");
  });
  it("ИИ знает, что геймпасс тут не нужен", () => {
    expect(codeOrderContextLine(o)).toMatch(/геймпасс не нужен/);
  });
});
