/**
 * Живая карточка DBS-заказа обязана быть ОДНИМ сообщением.
 *
 * 20.08.2026 владелец прислал скриншот, где по заказу WB #5536525331 в чате
 * висят три карточки подряд: красная «закрыт на WB, но гейт не выдан» и две
 * одинаковые зелёные «доставка закрыта, гейт отправлен». Две независимые
 * причины, обе проверяются здесь:
 *   1. мост в Сингапуре срезал `message_id` из ответа Telegram, так что
 *      карточка никогда не узнавала id собственного сообщения;
 *   2. Telegram отвечает на «отредактируй в то же самое» ошибкой 400, и
 *      карточка принимала это за отказ и отправляла копию.
 */

const tgSend = jest.fn();
const tgEdit = jest.fn();
const tgDelete = jest.fn();

jest.mock("../notify", () => ({
  tgSend: (...args: unknown[]) => tgSend(...args),
  tgEdit: (...args: unknown[]) => tgEdit(...args),
  tgDelete: (...args: unknown[]) => tgDelete(...args),
  tgMessageId: (sent: { result?: { message_id?: number } } | null) =>
    (typeof sent?.result?.message_id === "number" ? sent.result.message_id : null),
  escapeHtml: (s: string) => s,
}));

// `ADMIN_IDS` читается на импорте модуля, поэтому импорт динамический: иначе
// список адресатов оказывается пустым и карточка никуда не уходит.
type AdminNotify = typeof import("../wb-delivery-admin-notify");
let pushDbsCard: AdminNotify["pushDbsCard"];
let renderDbsCard: AdminNotify["renderDbsCard"];

beforeAll(async () => {
  process.env.ADMIN_IDS = "85137352";
  ({ pushDbsCard, renderDbsCard } = await import("../wb-delivery-admin-notify"));
});

const state = {
  wbOrderId: "5536525331",
  buyerName: "Максим",
  denomination: 1000,
  priceKopecks: 90900,
  activationCode: "7KA63QA",
  marker: "done" as const,
  title: "доставка закрыта, гейт отправлен",
  next: "покупатель активирует код в боте",
  timeline: ["12:04  доставка закрыта", "12:04  гейт отправлен"],
};

beforeEach(() => {
  tgSend.mockReset();
  tgEdit.mockReset();
  tgDelete.mockReset();
  tgSend.mockResolvedValue({ ok: true, result: { message_id: 2902 } });
  tgEdit.mockResolvedValue(true);
});

describe("pushDbsCard", () => {
  it("запоминает id отправленного сообщения", async () => {
    const ids = await pushDbsCard(state, null);
    expect(ids).toEqual({ "85137352": 2902 });
    expect(tgSend).toHaveBeenCalledTimes(1);
  });

  it("следующее состояние редактирует то же сообщение, а не шлёт новое", async () => {
    const ids = await pushDbsCard(state, null);
    await pushDbsCard({ ...state, title: "покупатель активировал код" }, ids);
    expect(tgSend).toHaveBeenCalledTimes(1);
    expect(tgEdit).toHaveBeenCalledWith("85137352", 2902, expect.any(String), expect.anything());
  });

  // Именно этот случай и дал два одинаковых зелёных сообщения на скриншоте.
  it("без id сообщения (старый мост) карточка уходила заново каждый раз", async () => {
    tgSend.mockResolvedValue({ ok: true });
    const first = await pushDbsCard(state, null);
    expect(first).toEqual({});
    await pushDbsCard(state, first);
    expect(tgSend).toHaveBeenCalledTimes(2);
  });

  it("если сообщение исчезло — старое удаляется, новое отправляется одно", async () => {
    tgEdit.mockResolvedValue(false);
    tgSend.mockResolvedValue({ ok: true, result: { message_id: 3001 } });
    const ids = await pushDbsCard(state, { "85137352": 2902 });
    expect(tgDelete).toHaveBeenCalledWith("85137352", 2902);
    expect(tgSend).toHaveBeenCalledTimes(1);
    expect(ids).toEqual({ "85137352": 3001 });
  });
});

describe("renderDbsCard", () => {
  it("рисует маркер, заказ, покупателя, код и историю этапов", () => {
    const text = renderDbsCard(state);
    expect(text).toContain("5536525331");
    expect(text).toContain("Максим");
    expect(text).toContain("7KA63QA");
    expect(text).toContain("Дальше:");
    expect(text).toContain("гейт отправлен");
  });

  it("одинаковое состояние даёт одинаковый текст — на этом и стоит дедуп", () => {
    expect(renderDbsCard(state)).toBe(renderDbsCard({ ...state }));
  });
});
