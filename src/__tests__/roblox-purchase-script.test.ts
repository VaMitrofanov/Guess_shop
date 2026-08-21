import { buildGamepassPurchaseScript } from "@/lib/roblox-purchase-script";

const input = {
  gamepassId: 1882704092,
  productId: 3605935014,
  expectedPrice: 715,
  sellerId: 9093114547,
  buyerUserId: 11295557875,
};

describe("buildGamepassPurchaseScript", () => {
  it("покупает через официальный модуль страницы, а не мёртвый economy endpoint", () => {
    const script = buildGamepassPurchaseScript(input);
    expect(script).toContain("RobloxItemPurchase");
    expect(script).toContain("startGamepassPurchaseFlow");
    expect(script).not.toContain("economy.roblox.com");
  });

  it("передаёт в модуль ProductId, а не gamepassId — purchase API ждёт именно его", () => {
    const script = buildGamepassPurchaseScript(input);
    expect(script).toContain("PID=3605935014");
    expect(script).toContain("productId:PID");
    // product-info и inventory, наоборот, адресуются gamepassId
    expect(script).toContain("GP=1882704092");
    expect(script).toContain(`game-passes/"+GP+"/product-info`);
  });

  it("зашивает цену по номиналу, чтобы подорожавший пасс не купился", () => {
    const script = buildGamepassPurchaseScript({ ...input, expectedPrice: 715 });
    expect(script).toContain("PRICE=715");
    expect(script).toContain("expectedPrice:PRICE");
    expect(script).toContain("[ЦЕНА-СТОП]");
  });

  it("держит [ПРОДАВЕЦ-СТОП] на клиенте: новый API не сверяет продавца сам", () => {
    const script = buildGamepassPurchaseScript(input);
    expect(script).toContain("SELLER=9093114547");
    expect(script).toContain("[ПРОДАВЕЦ-СТОП]");
  });

  it("не даёт купить не с донорского аккаунта", () => {
    const script = buildGamepassPurchaseScript(input);
    expect(script).toContain("BUYER=11295557875");
    expect(script).toContain("[АККАУНТ-СТОП]");
  });

  it("без известного донора пропускает проверку аккаунта, а не ломает скрипт", () => {
    const script = buildGamepassPurchaseScript({ ...input, buyerUserId: null });
    expect(script).toContain("BUYER=0");
  });

  it("не подставляет в скрипт текст, заданный клиентом", () => {
    // Имя пасса и ник продавца задаёт клиент: в тексте скрипта их быть не должно —
    // только числа. Иначе кавычка в названии пасса = инъекция в консоль менеджера.
    const script = buildGamepassPurchaseScript(input);
    expect(script).toContain("assetName:info.Name");
    expect(script).toContain("sellerName:(info.Creator&&info.Creator.Name)");
  });

  it("падает на нечисловом вводе вместо генерации битого скрипта", () => {
    expect(() => buildGamepassPurchaseScript({ ...input, productId: "нет" })).toThrow(/productId/);
    expect(() => buildGamepassPurchaseScript({ ...input, expectedPrice: NaN })).toThrow(/expectedPrice/);
  });

  it("остаётся одной строкой — его вставляют в консоль", () => {
    expect(buildGamepassPurchaseScript(input)).not.toContain("\n");
  });
});
