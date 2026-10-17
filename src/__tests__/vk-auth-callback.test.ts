import { parseVkIdCallback } from "../components/auth/VKAuthCallback";

/**
 * Компонент возврата VK ID висит в корневом layout — то есть на каждой странице
 * сайта. Цена ошибки в этом предикате асимметрична: пропустить возврат значит
 * оставить покупателя на витрине (то, что чинили 21.08), а сработать лишний раз
 * значит накрыть оверлеем обычную страницу. Поэтому условие строгое и с тестом.
 */
describe("признак возврата VK ID", () => {
  it("узнаёт настоящий возврат", () => {
    expect(parseVkIdCallback("?code=vk2.a.AbC&device_id=dev123&type=code_v2&state=x")).toEqual({
      code: "vk2.a.AbC",
      deviceId: "dev123",
    });
  });

  it("молчит на обычных страницах", () => {
    for (const search of ["", "?", "?amount=500", "?source=wb&skip=1&code=3PSTN6T"]) {
      expect(parseVkIdCallback(search)).toBeNull();
    }
  });

  /** `?code=` — это ещё и наш семисимвольный код активации, и он ходит по сайту
   * в открытую (ссылка из чата WB, `/checkout`). Без `type=code_v2` реагировать
   * нельзя. */
  it("не путает наш код активации с кодом авторизации VK", () => {
    expect(parseVkIdCallback("?code=3PSTN6T")).toBeNull();
    expect(parseVkIdCallback("?code=3PSTN6T&device_id=dev123")).toBeNull();
  });

  it("требует оба поля обмена", () => {
    expect(parseVkIdCallback("?type=code_v2&code=vk2.a.AbC")).toBeNull();
    expect(parseVkIdCallback("?type=code_v2&device_id=dev123")).toBeNull();
    expect(parseVkIdCallback("?type=code_v2&code=&device_id=dev123")).toBeNull();
  });
});
