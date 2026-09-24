export {};

import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Один язык для ВСЕХ push-уведомлений админам.
 *
 * 02.09.2026 владелец прислал скрин, где подряд идут три сообщения об одном
 * заказе: карточка активации `📦 ЗАКАЗ`, алерт `🚨 VK-бот упал` и карточка
 * выкупа `📦 ЗАКАЗ` — три разных заголовка, три набора эмодзи и ни одной
 * общей строки, по которой их можно связать глазом.
 *
 * `formatAdminNotice` + `orderRef` (`bots/shared/notify-format.ts`) это чинят,
 * но чинят ровно до следующего места, где кто-то соберёт сообщение руками.
 * Тест держит границу: каждый отправитель push'ей обязан звать форматтер, и ни
 * в одном не должно остаться самодельной шапки-баннера.
 *
 * Экраны админ-хаба (`bots/tg/admin/*`) сюда НЕ входят: это интерфейс, который
 * админ открывает сам, а не поток входящих сообщений.
 */

const ROOT = join(__dirname, "..", "..", "..");
const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");

/** Каждый файл, который шлёт админам push-сообщения. */
const PUSH_SENDERS = [
  "bots/shared/admin.ts",
  "bots/shared/wb-delivery-admin-notify.ts",
  "bots/tg/handlers.ts",
  "bots/vk/handlers.ts",
  "src/lib/admin-card.ts",
  "src/lib/buyout-admin-notify.ts",
  "src/lib/partner-buyout-notify.ts",
  "src/auth.ts",
];

describe("единый язык уведомлений админам", () => {
  it.each(PUSH_SENDERS)("%s собирает сообщения через formatAdminNotice", (file) => {
    expect(read(file)).toContain("formatAdminNotice");
  });

  /**
   * Самодельная шапка — это либо `📦 <b>ЗАКАЗ …`, либо линейка `━━━`, которой
   * раньше отбивали заголовок. И то и другое ставит сообщение вне общего
   * потока: значок перестаёт кодировать срочность, а зона исчезает.
   */
  it.each(PUSH_SENDERS)("%s не рисует свою шапку-баннер", (file) => {
    const source = read(file);
    // `bots/tg/handlers.ts` содержит линейку в сообщении ПОКУПАТЕЛЮ (расчёт
    // бонуса) — это не админский push, и общий язык на него не распространяется.
    const adminBanner = source.match(/`📦 <b>ЗАКАЗ/g) ?? [];
    expect(adminBanner).toHaveLength(0);
  });

  it("значок кодирует только срочность — своих эмодзи-заголовков нет", () => {
    const admin = read("bots/shared/admin.ts");
    for (const banner of ["🚨 <b>", "🆘 <b>ОБРАЩЕНИЕ", "🔷 <b>ПРЯМОЙ ЗАКАЗ", "🔷 <b>ЗАЯВКА"]) {
      expect(admin).not.toContain(banner);
    }
  });

  /**
   * Ключ заказа обязан стоять в КАЖДОМ сообщении о заказе: именно он делает
   * три сообщения одним делом, даже когда ветка не собралась (корень удалён,
   * заказ не DBS, Telegram отказал в reply).
   */
  it.each([
    "bots/shared/admin.ts",
    "bots/tg/handlers.ts",
    "bots/vk/handlers.ts",
    "src/lib/admin-card.ts",
    "src/auth.ts",
  ])("%s ставит ключ заказа через orderRef", (file) => {
    expect(read(file)).toContain("orderRef(");
  });
});

describe("алерт об упавшем боте называет МЕСТО, а не только текст ошибки", () => {
  const admin = read("bots/shared/admin.ts");

  /**
   * 02.09.2026 покупательница получила «Произошла ошибка», а алерт сказал ровно
   * `Code №10 — Internal server error`: слова VK, а не наш вызов. Логи
   * контейнера уехали вместе с раскаткой, и чинить стало нечего.
   */
  it("берёт первый кадр нашего стека", () => {
    expect(admin).toContain("function ourStackFrame");
    const frame = admin.slice(admin.indexOf("function ourStackFrame"));
    expect(frame).toContain("node_modules");
  });

  it("показывает, что прислал юзер, и метод внешнего API", () => {
    const notify = admin.slice(admin.indexOf("export async function notifyBotError"));
    expect(notify).toContain("Прислал:");
    expect(notify).toContain("apiMethodOf");
  });

  it("оба бота передают текст сообщения в алерт", () => {
    expect(read("bots/tg/bot.ts")).toContain("input");
    expect(read("bots/vk/bot.ts")).toContain("input:");
  });
});
