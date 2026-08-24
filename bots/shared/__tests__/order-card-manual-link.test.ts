/**
 * Заказ, оформленный по присланной ссылке, обязан отличаться в карточке админа.
 *
 * Поиск по нику опирается на публичные списки Roblox и молчит при скрытом
 * плейсе — по разбору 22.08 это треть застрявших активаций. Такой заказ теперь
 * оформляется по ссылке и штатно доезжает до менеджера, но менеджеру важно
 * видеть, что пасс нашёлся не поиском: плейс, скорее всего, закрыт, и выкуп
 * стоит глянуть глазами.
 */

// `export {}` — файл без верхнеуровневых импортов иначе считается скриптом,
// и `tgSend` сталкивается с одноимённым моком в dbs-card.test.ts.
export {};

const tgSend = jest.fn();

jest.mock("../notify", () => ({
  tgSend: (...args: unknown[]) => tgSend(...args),
  tgSendPhoto: jest.fn(),
  escapeHtml: (s: string) => s,
}));
jest.mock("../db", () => ({ db: {} }));
jest.mock("../wb-order-source", () => ({
  resolveWbOrderSource: async () => "WB_DBS",
  wbOrderSourceLabel: () => "WB DBS",
}));
jest.mock("../twa-link", () => ({ twaLaunchUrl: () => "https://robloxbank.ru/twa" }));

type Admin = typeof import("../admin");
let sendAdminOrderCard: Admin["sendAdminOrderCard"];

beforeAll(async () => {
  process.env.ADMIN_IDS = "85137352";
  ({ sendAdminOrderCard } = await import("../admin"));
});

beforeEach(() => {
  tgSend.mockReset();
  tgSend.mockResolvedValue({ ok: true });
});

const base = {
  id: "order-1",
  amount: 1000,
  gamepassUrl: "https://www.roblox.com/game-pass/1784555857",
  platform: "TG" as const,
  wbCode: "QARJR71",
  userDisplay: "@buyer",
  createdAt: new Date("2026-08-24T10:00:00.000Z"),
};

describe("метка ручной ссылки в карточке заказа", () => {
  it("ставится, когда поиск по нику не нашёл геймпасс", async () => {
    await sendAdminOrderCard({ ...base, viaManualLink: true });
    expect(tgSend.mock.calls[0][1]).toContain("ССЫЛКА ВРУЧНУЮ");
  });

  it("не появляется на обычном заказе", async () => {
    await sendAdminOrderCard({ ...base });
    expect(tgSend.mock.calls[0][1]).not.toContain("ССЫЛКА ВРУЧНУЮ");
  });
});
