import { containsSecretToken, redactWbChatText } from "../wb-delivery-crypto";

// Ключ выдуманный: формат как у Open Cloud (base64, порезан на строки), значение — нет.
const FAKE_KEY_LINES = [
  "Ab12Cd34Ef56Gh78Ij90Kl12Mn34Op56Qr78St",
  "Uv90Wx12Yz34Ab56Cd78Ef90Gh12Ij34",
  "Kl56Mn78",
];

describe("копия переписки WB не хранит ключи API (16.11.2026)", () => {
  it("ключ, порезанный на строки, скрыт по длинным кускам", () => {
    const out = redactWbChatText(FAKE_KEY_LINES.join("\n"));
    expect(out).not.toContain(FAKE_KEY_LINES[0]);
    expect(out).not.toContain(FAKE_KEY_LINES[1]);
    expect(out).toContain("[ключ скрыт]");
  });

  it("обычные слова, ники, ссылки на пасс и номера не трогает", () => {
    const text = "Здравствуйте! Ник Avrora_GamesSuper, пасс https://www.roblox.com/game-pass/2083382474/Some-Name, заказ 6279394778";
    expect(redactWbChatText(text)).toBe(text);
  });

  it("признак ключа — для отказа отправить его в чат WB", () => {
    expect(containsSecretToken(FAKE_KEY_LINES.join("\n"))).toBe(true);
    expect(containsSecretToken("Пришлите, пожалуйста, ссылку на геймпасс")).toBe(false);
  });
});
