import { decodeWbEntities } from "../wb-delivery-contract";
import { redactWbChatText } from "../wb-delivery-crypto";

/**
 * С 16.09.2026 WB отдаёт текст чата экранированным — и наш, и покупателя.
 * Живые примеры из ленты 17–20.09.2026.
 */
describe("decodeWbEntities", () => {
  it("возвращает кавычки, апостроф и амперсанд", () => {
    expect(decodeWbEntities("в разделе &#34;Доставки&#34; приложения")).toBe('в разделе "Доставки" приложения');
    expect(decodeWbEntities("Где посмотреть I&#39;d pass?")).toBe("Где посмотреть I'd pass?");
    expect(decodeWbEntities("https://robloxbank.ru/guide?source=wb&amp;skip=1&amp;code=ABCDEFG"))
      .toBe("https://robloxbank.ru/guide?source=wb&skip=1&code=ABCDEFG");
    expect(decodeWbEntities("&quot;x&quot; &lt;b&gt; &#x41;")).toBe('"x" <b> A');
  });

  it("раскодирует ровно один слой и не трогает обычный текст", () => {
    expect(decodeWbEntities("&amp;#34;")).toBe("&#34;");
    expect(decodeWbEntities("Том & Джерри")).toBe("Том & Джерри");
    expect(decodeWbEntities("&unknown;")).toBe("&unknown;");
    expect(decodeWbEntities(undefined)).toBeUndefined();
  });

  it("после раскодирования код в ссылке маскируется, как раньше", () => {
    const stored = redactWbChatText(decodeWbEntities("https://robloxbank.ru/guide?source=wb&amp;skip=1&amp;code=ABCDEFG"));
    expect(stored).not.toContain("ABCDEFG");
  });
});
