/** Кто этот покупатель WB у нас (12.11.2026). */
import { contactOf, extractRobloxRefs, identityLines, type BuyerIdentity, type BuyerMatch } from "../buyer-identity";

const m = (over: Partial<BuyerMatch> = {}): BuyerMatch => ({
  userId: "u1", name: "Анна", tgUsername: "anna", tgId: "1", vkId: null, orders: 3, bought: 2, lastCode: "ZT8BW8D",
  level: "exact", why: "этот заказ активирован", ...over,
});
const id = (over: Partial<BuyerIdentity> = {}): BuyerIdentity => ({ matches: [], namesakes: 0, buyerName: "Анна", ...over });

describe("extractRobloxRefs", () => {
  it("ник и Pass ID из сообщений чата WB", () => {
    const r = extractRobloxRefs(["мой ник nikita228", "вот пасс https://www.roblox.com/game-pass/1907029789/vip"]);
    expect(r.nicks).toContain("nikita228");
    expect(r.passIds).toEqual(["1907029789"]);
  });

  it("обычные слова и служебные — не ники", () => {
    const r = extractRobloxRefs(["Здравствуйте, где мой заказ? roblox pass ok"]);
    expect(r.nicks).toEqual([]);
  });
});

describe("identityLines", () => {
  it("точное совпадение — «наш клиент» с контактом", () => {
    const [line] = identityLines(id({ matches: [m()] }));
    expect(line).toContain("👤 Наш клиент: Анна · @anna (TG)");
    expect(line).toContain("этот заказ активирован");
  });

  it("догадка по имени — «вероятно»", () => {
    expect(identityLines(id({ matches: [m({ level: "likely", why: "то же имя на WB" })] }))[0]).toContain("Вероятно наш клиент");
  });

  it("тёзки — предупреждение, без выдачи догадки за факт", () => {
    const lines = identityLines(id({ namesakes: 4, matches: [m({ level: "namesake" })] }));
    expect(lines).toEqual(["👥 «Анна» — 4 разных покупателей с таким именем в базе, не путать"]);
  });

  it("никого — новый покупатель", () => {
    expect(identityLines(id())).toEqual(["🆕 Новый покупатель — у нас его ещё нет"]);
  });

  it("контакты TG и VK", () => {
    expect(contactOf({ tgUsername: null, tgId: "5", vkId: "77" })).toBe("TG id 5 · vk.com/id77");
  });
});
