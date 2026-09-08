import { readFileSync } from "node:fs";
import { join } from "node:path";

/* Прямой заказ не может быть принят с пассом не по цене.
 *
 * `DIR-39544969` (08.09.2026): заказ на 200 R$ уехал в очередь выкупа с пассом
 * на 715 R$ — ценой заказа на 500. Проверка в проекте была, но ровно на тех
 * путях, по которым этот заказ не шёл:
 *
 *   сайт            → validateCheckoutGamepass, жёсткий throw
 *   бот, ссылка     → жёсткий отказ «нужна ровно N R$»
 *   бот, кнопка     → ТЕКСТОВОЕ предупреждение, кнопка «Оформить» жива
 *
 * Плюс прайс-гард выкупа, который в ручном цикле не срабатывает никогда:
 * кнопка «Выкуплено» цену не сверяет.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const botOrder = read("src/lib/canonical-bot-order.ts");
const tg = read("bots/tg/handlers.ts");
const vk = read("bots/vk/handlers.ts");
const quest = read("bots/shared/gamepass-quest.ts");
const screen = read("src/app/twa/_components/screens/OrdersScreen.tsx");
const presentation = read("src/lib/order-presentation.ts");
const adminCards = read("bots/shared/admin.ts");
const crons = read("bots/tg/crons.ts");

describe("Сервер перепроверяет пасс перед созданием заказа", () => {
  it("гейт стоит в каноническом создателе заказа бота", () => {
    expect(botOrder).toContain("await assertIntentGamepassStillValid(input.intentId, input.platform, input.subject);");
  });

  it("сверяются цена, продавец и «в продаже»", () => {
    expect(botOrder).toContain("passFitsAmount(pass.price, intent.totalAmount)");
    expect(botOrder).toContain("pass.isForSale === false");
    expect(botOrder).toContain("pass.creatorName.toLowerCase() !== intent.robloxUsername.toLowerCase()");
  });

  it("уже выкупленный пасс второй раз не принимается", () => {
    expect(botOrder).toContain('status: "COMPLETED"');
    expect(botOrder).toContain("уже выкуплен по прошлому заказу");
  });

  it("молчание Roblox не блокирует оплату — иначе наша недоступность станет отказом клиенту", () => {
    expect(botOrder).toContain("if (!pass || !pass.price) return;");
  });
});

describe("Бот не предлагает оформить пасс не по цене", () => {
  it("вместо предупреждения — развилка с пересчётом (TG и VK)", () => {
    expect(tg).toContain("const requote = mismatch");
    expect(tg).toContain("CB.directRequote");
    expect(vk).toContain('command: "direct_requote"');
    // Прежняя пассивная строка ушла из обоих каналов.
    expect(tg).not.toContain("Лучше создать новый с правильной ценой");
    expect(vk).not.toContain("Лучше создать новый с правильной ценой");
  });

  it("пасс не той цены подписан тем, во что он превращается", () => {
    expect(tg).toContain("→ заказ на ${Math.floor(g.robux * 0.7)} R$");
    expect(vk).toContain("→ заказ на ${Math.floor(g.robux * 0.7)} R$");
  });
});

describe("Ключ — первый путь везде", () => {
  it("в развилке квеста кнопка ключа идёт раньше инструкции", () => {
    const rows = quest.slice(quest.indexOf("const rows: QuestButton[][] = []"));
    expect(rows.indexOf("QUEST.key")).toBeLessThan(rows.indexOf("Создам сам (инструкция)"));
    expect(rows.indexOf("Создам сам (инструкция)")).toBeLessThan(rows.indexOf("QUEST.passid"));
  });

  it("в прямом заказе ключ предлагается и когда пасса нет, и когда цена не та", () => {
    expect(tg).toContain("CB.directKey");
    expect(vk).toContain('command: "direct_key"');
  });

  it("ключ прямого заказа не уводит в коридор WB", () => {
    // guideUrlFor без кода ведёт на инструкцию прямого заказа, а не в WB-гейт.
    expect(quest).toContain('"https://robloxbank.ru/guide?source=direct"');
  });
});

describe("Расхождение видно человеку", () => {
  it("живая проверка помечает заказ спрошенным ТОЛЬКО после ответа", () => {
    expect(screen).toContain("Object.keys(d.results).forEach(id => liveRequestedRef.current.add(id));");
    expect(screen).toContain("liveInFlightRef");
  });

  it("копирование ID пасса сверяет цену заново", () => {
    expect(screen).toContain("async function copyPassAndVerify");
    expect(screen).toContain("void copyPassAndVerify(copySlot.text");
  });

  it("повтор уже выкупленного пасса — отдельная строка, а не молчание", () => {
    expect(presentation).toContain("live?.reusedIn");
    expect(screen).toContain("Этот пасс уже выкуплен в заказе");
  });

  it("карточка оплаты называет цену пасса — это последний ручной шаг", () => {
    expect(adminCards).toContain("async function paymentCardPassLine");
    expect(adminCards).toContain("ПАСС НЕ СХОДИТСЯ");
  });

  it("цена принятого пасса сторожится, пока заказ ждёт выкупа", () => {
    expect(crons).toContain("async function watchQueuedGamepassPrices");
    expect(crons).toContain("[ЦЕНА-ИЗМЕНИЛАСЬ");
  });
});
