import { createHeldApiKeyStore } from "../held-api-key";

/** С 27.11.2026 ключ в памяти бессрочный: живёт до привязки пасса или drop. */
describe("held api key", () => {
  it("отдаёт ключ без срока", () => {
    const store = createHeldApiKeyStore();
    store.hold(7, "secret-key");
    expect(store.get(7)).toBe("secret-key");
    expect(store.get("7")).toBe("secret-key");
  });

  it("drop стирает ключ сразу", () => {
    const store = createHeldApiKeyStore();
    store.hold(1, "k");
    store.drop(1);
    expect(store.get(1)).toBeNull();
  });
});
