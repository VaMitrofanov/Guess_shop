import { HELD_KEY_TTL_MS, createHeldApiKeyStore } from "../held-api-key";

/** Ключ ждёт ссылку на игру 15 минут и только в памяти процесса. */
describe("held api key", () => {
  it("отдаёт ключ, пока он жив, и забывает после срока", () => {
    let now = 1_000;
    const store = createHeldApiKeyStore(() => now);
    store.hold(7, "secret-key");
    expect(store.get(7)).toBe("secret-key");
    expect(store.get("7")).toBe("secret-key");
    now += HELD_KEY_TTL_MS + 1;
    expect(store.get(7)).toBeNull();
  });

  it("drop стирает ключ сразу", () => {
    const store = createHeldApiKeyStore();
    store.hold(1, "k");
    store.drop(1);
    expect(store.get(1)).toBeNull();
  });
});
