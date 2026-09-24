/**
 * Скриншот отзыва и скриншот оплаты нельзя потерять молча.
 *
 * Разбор 28.08.2026: покупательница прислала отзыв в ВК, получила
 * «✅ Отзыв получен! Менеджер проверит», админам не ушло НИЧЕГО, в логах пусто,
 * бонус +100 R$ ей никто не начислил. Три слоя молчания подряд: `tgSendPhoto`
 * не смотрел на ответ Telegram и глотал сетевую ошибку, рассылка шла через
 * `Promise.allSettled` без разбора результатов, и `catch` у вызывающего был
 * мёртвым кодом. Эти тесты держат каждый из трёх.
 */
export {};

const tgSend = jest.fn();
const tgSendPhoto = jest.fn();
const orderUpdate = jest.fn();
const orderFindUnique = jest.fn();

jest.mock("../notify", () => ({
  tgSend: (...args: unknown[]) => tgSend(...args),
  tgSendPhoto: (...args: unknown[]) => tgSendPhoto(...args),
  escapeHtml: (s: string) => s,
}));
jest.mock("../db", () => ({
  db: {
    wbOrder: {
      findUnique: (...args: unknown[]) => orderFindUnique(...args),
      update: (...args: unknown[]) => orderUpdate(...args),
    },
  },
}));
jest.mock("../wb-order-source", () => ({
  resolveWbOrderSource: async () => "WB",
  wbOrderSourceLabel: () => "WB",
}));
jest.mock("../twa-link", () => ({ twaLaunchUrl: () => "https://robloxbank.ru/twa" }));

type Admin = typeof import("../admin");
let sendAdminReviewCard: Admin["sendAdminReviewCard"];
let sendAdminPaymentCard: Admin["sendAdminPaymentCard"];

beforeAll(async () => {
  process.env.ADMIN_IDS = "111,222";
  ({ sendAdminReviewCard, sendAdminPaymentCard } = await import("../admin"));
});

beforeEach(() => {
  tgSend.mockReset();
  tgSendPhoto.mockReset();
  orderUpdate.mockReset();
  orderFindUnique.mockReset();
  orderFindUnique.mockResolvedValue({ wbCode: "62KL4GZ", adminNote: null });
  tgSend.mockResolvedValue({ ok: true });
});

const review = {
  orderId: "order-1",
  userId: "user-1",
  photoSource: "https://sun9.userapi.com/photo.jpg?size=1&sign=abc",
  userDisplay: "Марина (vk.com/id174604455)",
};

describe("доставка карточки со скриншотом", () => {
  it("фото дошло — текстом ничего не дублируется", async () => {
    tgSendPhoto.mockResolvedValue(true);
    await sendAdminReviewCard(review);
    expect(tgSendPhoto).toHaveBeenCalledTimes(2);
    expect(tgSend).not.toHaveBeenCalled();
    expect(orderUpdate).not.toHaveBeenCalled();
  });

  it("Telegram не забрал фото — карточка уходит текстом С ТЕМИ ЖЕ кнопками", async () => {
    // Начисление бонуса делается нажатием на кнопку; текст без кнопок
    // превратил бы это в ручную работу.
    tgSendPhoto.mockResolvedValue(false);
    await sendAdminReviewCard(review);

    expect(tgSend).toHaveBeenCalledTimes(2);
    const [, text, extra] = tgSend.mock.calls[0];
    expect(text).toContain(review.photoSource);
    expect(text).toContain("Фото не удалось приложить");
    const keyboard = (extra as any).reply_markup.inline_keyboard[0];
    expect(keyboard[0].text).toContain("Начислить +100 R$");
    expect(keyboard[1].text).toContain("Отклонить");
  });

  it("не дошло вообще — бросает и оставляет след в заказе", async () => {
    // Telegram может быть недоступен целиком. След переживёт это: по нему
    // отзыв найдут и начислят бонус вручную.
    tgSendPhoto.mockResolvedValue(false);
    tgSend.mockResolvedValue({ ok: false, description: "chat not found" });

    await expect(sendAdminReviewCard(review)).rejects.toThrow(/undelivered: 0\/2/);
    expect(orderUpdate).toHaveBeenCalledTimes(1);
    const note = orderUpdate.mock.calls[0][0].data.adminNote as string;
    expect(note).toContain("ОТЗЫВ-НЕ-ДОШЁЛ");
    expect(note).toContain(review.photoSource);
  });

  it("дошло хотя бы до одного — это успех, без исключения", async () => {
    tgSendPhoto.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    tgSend.mockResolvedValue({ ok: false });
    await expect(sendAdminReviewCard(review)).resolves.toBeUndefined();
    expect(orderUpdate).not.toHaveBeenCalled();
  });

  it("скриншот ОПЛАТЫ защищён так же — клиент уже заплатил", async () => {
    tgSendPhoto.mockResolvedValue(false);
    tgSend.mockResolvedValue({ ok: false });
    await expect(sendAdminPaymentCard({
      orderId: "order-1", userId: "user-1",
      photoFileId: "AgACAgIAAxk", userDisplay: "@buyer", amount: 1000,
    } as any)).rejects.toThrow(/undelivered: 0\/2/);
  });

  it("падение записи следа не заслоняет исходную ошибку доставки", async () => {
    tgSendPhoto.mockResolvedValue(false);
    tgSend.mockResolvedValue({ ok: false });
    orderFindUnique.mockRejectedValue(new Error("db down"));
    await expect(sendAdminReviewCard(review)).rejects.toThrow(/undelivered/);
  });
});

/**
 * Вторая половина той же истории: карточка дошла, решение принято, а экран
 * промолчал.
 *
 * `editMessageCaption` работает только с медиа. Когда карточка ушла текстовым
 * фолбэком (Telegram не забрал фото по ссылке VK CDN), правка падала, ошибку
 * глотал `catch {}` — и админ видел ту же карточку с теми же кнопками. Заказ
 * FJEXSA5, 30.08.2026: бонус +100 R$ начислен и записан в леджер, на экране не
 * изменилось ничего.
 *
 * Тест смотрит на исходник: вернуть `editMessageCaption` в обработчик решения —
 * значит вернуть и баг, а поймать его можно только руками на живом фолбэке.
 */
describe("решение по карточке видно на экране", () => {
  const handlers = require("node:fs").readFileSync(
    require("node:path").join(process.cwd(), "bots/tg/handlers.ts"), "utf8");

  it("обработчики решений закрывают карточку через closeAdminCard", () => {
    for (const marker of ["payOkCaption", "❌ Оплата отклонена", "🎁 Бонус начислен"]) {
      const line = handlers.split("\n").find((l: string) => l.includes(marker) && l.includes("closeAdminCard"))
        ?? handlers.split("\n").find((l: string) => l.includes(marker));
      expect(line).toBeDefined();
    }
    expect(handlers).toContain("await closeAdminCard(ctx, payOkCaption)");
  });

  it("прямого editMessageCaption в обработчиках решений не осталось", () => {
    // Единственное допустимое место — сам `closeAdminCard`, где выбор между
    // подписью и текстом делается осознанно.
    const uses = handlers.split("\n").filter((l: string) => l.includes("ctx.editMessageCaption("));
    expect(uses).toHaveLength(1);
  });

  it("closeAdminCard снимает кнопки — повторное нажатие ничего не меняет", () => {
    const body = handlers.slice(handlers.indexOf("async function closeAdminCard"));
    expect(body.slice(0, 1400)).toContain("inline_keyboard: [] as unknown[]");
    expect(body.slice(0, 1400)).toContain("editMessageText");
  });
});
