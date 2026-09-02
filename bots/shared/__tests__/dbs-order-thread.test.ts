/**
 * Один заказ — одна нить.
 *
 * 01.09.2026 владелец прислал скриншот, где по заказу WB #5638591741 подряд
 * висят три сообщения: живая карточка DBS, сообщение покупателя и карточка
 * «📦 ЗАКАЗ ZZF7T5B» о входе на сайт. Заказ один, а выглядит как три разных
 * дела: у первых двух ключ — номер WB, у третьей — только код гейта, общего
 * поля нет ни одного.
 *
 * Здесь проверяется ровно то, что делает их одним заказом:
 *   1. единая шапка — номер WB и код гейта в каждом сообщении;
 *   2. ветка — сообщение уходит ответом на живую карточку;
 *   3. отсутствие корня не должно ронять уведомление о деньгах.
 */

const tgSend = jest.fn();

jest.mock("../notify", () => ({
  tgSend: (...args: unknown[]) => tgSend(...args),
  tgEdit: jest.fn(),
  tgDelete: jest.fn(),
  tgMessageId: () => null,
  escapeHtml: (s: string) => s,
}));

type AdminNotify = typeof import("../wb-delivery-admin-notify");
let notify: AdminNotify;

beforeAll(async () => {
  process.env.ADMIN_IDS = "85137352,7788";
  notify = await import("../wb-delivery-admin-notify");
});

beforeEach(() => {
  tgSend.mockReset();
  tgSend.mockResolvedValue({ ok: true, result: { message_id: 1 } });
});

const ref = {
  wbOrderId: "5638591741",
  code: "ZZF7T5B",
  denomination: 1000,
  priceKopecks: 78000,
  buyerName: "Анастасия",
  cardMessages: { "85137352": 2902, "7788": 4501 },
};

/** Первый аргумент — chatId, второй — текст, третий — опции. */
function sent(index = 0) {
  const [chatId, text, extra] = tgSend.mock.calls[index] as [string, string, Record<string, unknown>];
  return { chatId, text, extra };
}

describe("единая шапка", () => {
  it("несёт и номер WB, и код гейта, и сумму, и покупателя", () => {
    notify.notifyDbsBuyerMessage(ref, "Здравствуйте");
    const { text } = sent();
    expect(text).toContain("WB #5638591741");
    expect(text).toContain("ZZF7T5B");
    // toLocaleString("ru-RU") разделяет тысячи неразрывным пробелом.
    expect(text.replace(/\u00a0/g, " ")).toContain("1 000 R$");
    expect(text).toContain("Анастасия");
  });

  it("та же строка стоит и в живой карточке — ключи совпадают целиком", () => {
    const card = notify.renderDbsCard({
      wbOrderId: ref.wbOrderId,
      buyerName: ref.buyerName,
      denomination: ref.denomination,
      priceKopecks: ref.priceKopecks,
      activationCode: ref.code,
      marker: "done",
      title: "доставка закрыта, гейт отправлен",
      next: "покупатель активирует код в боте",
      timeline: [],
    });
    expect(card).toContain("WB #5638591741");
    expect(card).toContain("ZZF7T5B");
    // Отдельной строки «Код гейта:» больше нет: код живёт в шапке.
    expect(card).not.toContain("Код гейта:");
  });
});

describe("ветка", () => {
  it("сообщение уходит ответом на карточку — своим id у каждого админа", () => {
    notify.notifyDbsCodeRejected(ref, true);
    expect(tgSend).toHaveBeenCalledTimes(2);
    expect(sent(0).extra).toMatchObject({ reply_to_message_id: 2902, allow_sending_without_reply: true });
    expect(sent(1).extra).toMatchObject({ reply_to_message_id: 4501 });
  });

  it("без карточки уведомление всё равно уходит — просто вне ветки", () => {
    notify.notifyDbsCodeRejected({ wbOrderId: "5638591741" }, true);
    expect(tgSend).toHaveBeenCalledTimes(2);
    expect(sent(0).extra).not.toHaveProperty("reply_to_message_id");
  });

  // Карточку могли удалить или переслать заново (pushDbsCard так и делает,
  // когда Telegram отказался редактировать). Ответ на исчезнувший корень
  // Telegram отвергает — и уведомление о деньгах потерялось бы из-за оформления.
  it("к id карточки всегда идёт allow_sending_without_reply", () => {
    notify.notifyDbsGateNotOpened(ref);
    expect(sent(0).extra).toMatchObject({ allow_sending_without_reply: true });
  });
});
