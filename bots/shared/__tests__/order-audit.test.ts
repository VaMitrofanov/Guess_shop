import {
  auditNickEntered,
  auditGamepassSubmitted,
  orderAuditKey,
  ORDER_AUDIT_TYPE,
  type OrderAuditClient,
} from "../order-audit";

/**
 * Аудит существует ради одного сценария: клиент говорит «я такой ник не
 * указывал». Разбор 28.08.2026 по `CEALJKV` показал, что прямой записи об этом
 * не было вовсе — доказывать пришлось косвенно. Эти тесты держат ровно то,
 * без чего запись снова окажется бесполезной.
 */
describe("след покупателя", () => {
  const create = jest.fn();
  const findFirst = jest.fn();
  const client = { wbOrder: { findFirst }, orderEvent: { create } } as unknown as OrderAuditClient;

  beforeEach(() => {
    create.mockReset().mockResolvedValue({});
    findFirst.mockReset().mockResolvedValue({ id: "order-1" });
  });

  it("пишет ник с каналом ввода и временем", async () => {
    await auditNickEntered(client, { nick: "Genni_1122", via: "nick-search", wbCode: "CEALJKV" });
    const data = create.mock.calls[0][0].data;
    expect(data.type).toBe(ORDER_AUDIT_TYPE.NICK_ENTERED);
    expect(data.payload).toMatchObject({ nick: "Genni_1122", via: "nick-search" });
    expect(typeof data.payload.at).toBe("string");
  });

  it("владелец пасса пишется отдельно от того, что набрал покупатель", async () => {
    // Робуксы уходят создателю пасса — адрес назначения выбирает присланный
    // геймпасс, а не слова. Это решающая часть доказательства.
    await auditGamepassSubmitted(client, {
      gamepassId: "1934438644", via: "link", wbCode: "CEALJKV",
      creatorName: "Genni_1122", price: 1429,
    });
    expect(create.mock.calls[0][0].data.payload).toMatchObject({
      gamepassId: "1934438644", creatorName: "Genni_1122", price: 1429, via: "link",
    });
  });

  it("разные ники — разные строки, повтор одного не плодит записей", async () => {
    expect(orderAuditKey(ORDER_AUDIT_TYPE.NICK_ENTERED, "order-1", "Genni_1122"))
      .toBe(orderAuditKey(ORDER_AUDIT_TYPE.NICK_ENTERED, "order-1", "genni_1122"));
    expect(orderAuditKey(ORDER_AUDIT_TYPE.NICK_ENTERED, "order-1", "Genni_1122"))
      .not.toBe(orderAuditKey(ORDER_AUDIT_TYPE.NICK_ENTERED, "order-1", "OtherNick"));
    // Ключ уникален глобально, поэтому в него обязан входить заказ.
    expect(orderAuditKey(ORDER_AUDIT_TYPE.NICK_ENTERED, "order-1", "Genni_1122"))
      .not.toBe(orderAuditKey(ORDER_AUDIT_TYPE.NICK_ENTERED, "order-2", "Genni_1122"));
  });

  it("повторная запись того же действия — штатный исход, не ошибка", async () => {
    create.mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" }));
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    await expect(auditNickEntered(client, { nick: "Genni_1122", via: "nick-search", wbCode: "CEALJKV" }))
      .resolves.toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("ищет заказ БЕЗ фильтра по статусу — спор разбирают по выполненному", async () => {
    await auditNickEntered(client, { nick: "Genni_1122", via: "nick-search", wbCode: "CEALJKV" });
    expect(findFirst.mock.calls[0][0].where).not.toHaveProperty("status");
  });

  it("никогда не роняет поток: падение БД проглатывается", async () => {
    findFirst.mockRejectedValue(new Error("db down"));
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    await expect(auditNickEntered(client, { nick: "Genni_1122", via: "x", wbCode: "CEALJKV" }))
      .resolves.toBeUndefined();
    await expect(auditGamepassSubmitted(client, { gamepassId: "123456", via: "x", wbCode: "CEALJKV" }))
      .resolves.toBeUndefined();
    warn.mockRestore();
  });

  it("мусор и синтетические коды не пишутся", async () => {
    await auditNickEntered(client, { nick: "не ник!", via: "x", wbCode: "CEALJKV" });
    await auditGamepassSubmitted(client, { gamepassId: "abc", via: "x", wbCode: "CEALJKV" });
    await auditNickEntered(client, { nick: "Genni_1122", via: "x", wbCode: "DIR-1234" });
    expect(create).not.toHaveBeenCalled();
  });
});
