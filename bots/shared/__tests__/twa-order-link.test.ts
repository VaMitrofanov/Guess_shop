jest.mock("../db", () => ({ db: {} }));

import { orderCodeCandidates, twaOrderUrl } from "../../tg/twa-order-link";

describe("кнопка «открыть заказ в TWA»", () => {
  it("берёт коды WB и прямых заказов, пропускает слова и номера", () => {
    const text = "📦 <b>ZT8BW8D</b> · 1000 R$ · ждёт пасс\nDIR-B0D5F79C выкуплен; ANTHROP, 1234567, WB #6261575245";
    expect(orderCodeCandidates(text)).toEqual(["ZT8BW8D", "DIR-B0D5F79C"]);
  });
  it("код не вырезается из длинного слова", () => {
    expect(orderCodeCandidates("ABCD1234X")).toEqual([]);
  });
  it("ссылка открывает мини-приложение с кодом", () => {
    expect(twaOrderUrl("RobloxBankBot", "DIR-B0D5F79C")).toBe("https://t.me/RobloxBankBot?startapp=DIR-B0D5F79C");
  });
});
