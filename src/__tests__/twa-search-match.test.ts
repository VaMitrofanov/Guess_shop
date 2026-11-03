import { getOrderMatchReason, type SearchMatchOrder } from "../lib/twa-search-match";

const order: SearchMatchOrder = {
  id: "cm123order-tail",
  wbCode: "ABC1234",
  robloxUsername: "Builderman",
  probableNick: "Builder_guess",
  gamepassUrl: "https://www.roblox.com/game-pass/1906424022/test",
  user: { username: "client_name", name: "Иван Клиент", tgId: "99887766", vkId: "55443322" },
};

describe("TWA search match reasons", () => {
  test.each([
    ["abc1234", "по коду"],
    ["order-tail", "по ID заказа"],
    ["Builder", "по Roblox-нику"],
    ["1906424022", "по gamepass ID"],
    ["@client_name", "по @username"],
    ["Иван", "по имени клиента"],
    ["99887766", "по ID клиента"],
  ])("explains %s as %s", (query, reason) => {
    expect(getOrderMatchReason(order, query)).toBe(reason);
  });
});
