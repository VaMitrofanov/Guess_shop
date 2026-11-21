jest.mock("../db", () => ({ db: {} }));
import { parseWbReplyCallback, wbReplyMarkup } from "../wb-reply-buttons";
import { passChecklist } from "../gamepass-acceptance";
import { dbsCardMarkup, dbsStepsLine, renderDbsCard } from "../wb-delivery-admin-notify";
import { orderPinMarkupTg, orderPinText } from "../order-pin";
import { robuxGotCardText } from "../robux-got-card";
import { morningDigestText } from "../../tg/wb-morning-digest";
import { isBuyerQuietHourMsk } from "../quiet-hours";

describe("ответ в чат WB из Telegram", () => {
  it("кнопки укладываются в 64 байта и разбираются обратно", () => {
    const kb = wbReplyMarkup("5536525331");
    for (const row of kb.inline_keyboard) for (const b of row) expect(Buffer.byteLength(b.callback_data)).toBeLessThanOrEqual(64);
    expect(parseWbReplyCallback("wbr:r:5536525331")).toEqual({ kind: "r", wbOrderId: "5536525331" });
    expect(parseWbReplyCallback("wbr:x:1")).toBeNull();
  });
});

describe("карточка DBS в 3 строки", () => {
  const state = {
    wbOrderId: "5536525331", buyerName: "Анна", denomination: 500, priceKopecks: 54900, activationCode: "ZT8BW8D",
    marker: "action" as const, title: "в очереди на выкуп", next: null,
    timeline: ["12:01  заказ принят", "12:40  код получен", "13:10  ссылка получена — в очереди на выкуп"],
    steps: [
      { label: "чат", state: "done" as const }, { label: "код", state: "done" as const }, { label: "гейт", state: "done" as const },
      { label: "пасс", state: "current" as const }, { label: "выкуп", state: "todo" as const },
    ],
  };
  it("шкала этапов, история свёрнута, номер WB внутри истории", () => {
    const text = renderDbsCard(state);
    expect(dbsStepsLine(state.steps)).toBe("✓ чат · ✓ код · ✓ гейт · <b>▸ пасс</b> · ○ выкуп");
    expect(text).toContain("<blockquote expandable>WB #5536525331");
    expect(text.split("</blockquote>")[0].split("<blockquote")[0].split("\n").length).toBeLessThanOrEqual(4);
  });
  it("выкупленный — без шкалы", () => {
    expect(renderDbsCard({ ...state, marker: "done", title: "выкуплен" })).not.toContain("▸");
  });
  it("единственная кнопка — «Открыть в TWA» по коду", () => {
    const m = dbsCardMarkup(state) as { reply_markup: { inline_keyboard: Array<Array<{ text: string; url: string }>> } };
    expect(m.reply_markup.inline_keyboard.flat()).toEqual([{ text: "📱 Открыть в TWA", url: "https://t.me/RobloxBankBot?startapp=ZT8BW8D" }]);
  });
});

describe("закреп-шкала у покупателя", () => {
  it("шаги, цена пасса, кнопка текущего шага", () => {
    const text = orderPinText({ code: "ZT8BW8D", amount: 500, stage: "wait", format: "plain" });
    expect(text).toContain("▰▱▱▱ ждём геймпасс");
    expect(text).toContain("Геймпасс — цена 715 R$");
    expect(orderPinMarkupTg("wait", "ZT8BW8D").inline_keyboard[0][0].callback_data).toBe("send_gp_link");
    expect(orderPinMarkupTg("done", "ZT8BW8D").inline_keyboard[1][0].callback_data).toBe("rbx_chk");
  });
});

describe("чек-лист пасса", () => {
  it("называет, что именно не так", () => {
    const t = passChecklist({ forSale: true, price: 700, expected: 715, managed: false, owner: "Misha2010" });
    expect(t).toContain("✅ В продаже");
    expect(t).toContain("❌ Цена 700 R$ — нужно <b>715 R$</b>");
    expect(t).toContain("✅ Региональные цены выключены");
    expect(t).toContain("<code>Misha2010</code>");
    expect(passChecklist({ forSale: false, price: null, expected: 715, html: false })).toContain("❌ Не в продаже");
  });
});

describe("утренняя сводка и тихие часы", () => {
  it("нули не показывает", () => {
    const t = morningDigestText({ waitCode: 3, waitCodeOld: 0, waitPassOld: 0, toBuy: 2, held: 0, badReviews: 0 }, "15 ноября");
    expect(t).toContain("Ждут код доставки: <b>3</b>");
    expect(t).not.toContain("Заморожено");
    expect(morningDigestText({ waitCode: 0, waitCodeOld: 0, waitPassOld: 0, toBuy: 0, held: 0, badReviews: 0 }, "15 ноября")).toContain("Всё спокойно");
  });
  it("22:00–9:00 МСК — тихо", () => {
    expect(isBuyerQuietHourMsk(Date.UTC(2026, 10, 15, 20, 0))).toBe(true); // 23:00 МСК
    expect(isBuyerQuietHourMsk(Date.UTC(2026, 10, 15, 5, 30))).toBe(true); // 8:30 МСК
    expect(isBuyerQuietHourMsk(Date.UTC(2026, 10, 15, 9, 0))).toBe(false); // 12:00 МСК
  });
});

describe("карточка «робуксы поступили»", () => {
  it("бонус за отзыв — только если ещё не получен", () => {
    expect(robuxGotCardText({ reviewPending: true, bonus: 100, fmt: "plain" })).toContain("+100 R$");
    expect(robuxGotCardText({ reviewPending: false, bonus: 100, fmt: "plain" })).not.toContain("+100");
  });
});
