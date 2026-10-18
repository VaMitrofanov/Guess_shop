export {};

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { buildBuyerMenuText, humanAge, nextStepLine } from "../buyer-menu";

/**
 * Меню покупателя. Замечание владельца 18.10.2026: «добавить инфу по заказу
 * (потому что сейчас одна строчка „выполнен“, она теряется, не особо видно),
 * чтобы было более информативно… расширить (но не путать)».
 *
 * Тесты держат три вещи: строка «От тебя» не врёт ни на одном статусе,
 * выполненный заказ несёт дату выхода робуксов, и экран не превращается в
 * простыню при нескольких заказах.
 */

const DAY = 86_400_000;
const NOW = new Date("2026-10-18T12:00:00Z");

const order = (over: Partial<Parameters<typeof nextStepLine>[0]> = {}) => ({
  amount: 1000,
  status: "AWAITING_GAMEPASS",
  wbCode: "VGAA3F2",
  createdAt: new Date(NOW.getTime() - 2 * DAY),
  ...over,
});

const menu = (over: Record<string, unknown> = {}) =>
  buildBuyerMenuText({
    nick: "lox23_limon",
    orderCount: 3,
    isReturning: true,
    active: [order()],
    now: NOW,
    ...over,
  } as any);

describe("«От тебя» — что именно нужно от человека", () => {
  it("ждём геймпасс и ник известен — называет точную цену пасса", () => {
    const line = stepFor({ status: "AWAITING_GAMEPASS", robloxUsername: "lox23_limon" });
    expect(line).toContain("создать геймпасс");
    // 1000 чистых → пасс 1429 R$ (ceil(1000 / 0.7)).
    expect(line).toContain("1429 R$");
  });

  it("ника нет — сначала просим ник, а не пасс", () => {
    const line = stepFor({ status: "AWAITING_GAMEPASS" });
    expect(line).toContain("ник Roblox");
    expect(line).not.toContain("создать геймпасс");
  });

  it("в очереди на выкуп — от человека НИЧЕГО (и это сказано прямо)", () => {
    expect(stepFor({ status: "PENDING" })).toContain("ничего");
    expect(stepFor({ status: "IN_PROGRESS" })).toContain("ничего");
  });

  it("ждём оплату — просим оплатить", () => {
    expect(stepFor({ status: "PAYMENT_PENDING" })).toContain("оплатить");
  });

  it("отклонён — просим новый геймпасс", () => {
    expect(stepFor({ status: "REJECTED" })).toContain("новый геймпасс");
  });

  function stepFor(over: Record<string, unknown>) {
    return nextStepLine(order(over as any) as any);
  }
});

describe("экран целиком", () => {
  it("показывает статус, возраст и код ВБ заказа", () => {
    const text = menu().text;
    expect(text).toContain("ТВОЙ ЗАКАЗ");
    expect(text).toContain("1000 R$");
    expect(text).toContain("Ждём геймпасс");
    expect(text).toContain("2 дня назад");
    expect(text).toContain("VGAA3F2");
  });

  it("у прямого заказа кода ВБ нет — не придумываем его", () => {
    const text = menu({ active: [order({ wbCode: "DIR-9D0FAFC0", isDirectOrder: true })] }).text;
    expect(text).not.toContain("Код ВБ");
    expect(text).not.toContain("DIR-");
  });

  it("выполненный заказ — блок, а не строчка, и с датой выхода робуксов", () => {
    const text = menu({
      active: [],
      lastCompleted: order({ status: "COMPLETED", completedAt: new Date(NOW.getTime() - 2 * DAY) }),
    }).text;
    expect(text).toContain("ГОТОВО");
    expect(text).toContain("выкуплен");
    // Выкуп + 5 дней = 21 октября.
    expect(text).toContain("Робуксы выйдут из Pending");
    expect(text).toContain("21 октября");
  });

  it("когда срок Pending вышел — не обещает ожидание, а отправляет в Transactions", () => {
    const text = menu({
      active: [],
      lastCompleted: order({ status: "COMPLETED", completedAt: new Date(NOW.getTime() - 9 * DAY) }),
    }).text;
    expect(text).toContain("разблокированы");
    expect(text).toContain("Transactions");
  });

  it("три активных заказа: подробно один, остальные — кнопкой (О4)", () => {
    const result = menu({ active: [order(), order({ amount: 500 }), order({ amount: 300 })] });
    expect(result.othersCount).toBe(2);
    expect(result.text).toContain("Ещё 2 заказа");
    // Подробно — только первый: второй номинал в тексте не фигурирует.
    expect(result.text).not.toContain("500 R$");
    expect(result.focus?.amount).toBe(1000);
  });

  it("ключ назван как быстрый путь там, где ждём геймпасс", () => {
    expect(menu().text).toContain("пришли ключ Roblox");
    // А в очереди на выкуп это было бы ложью: ключ там уже ничего не меняет.
    expect(menu({ active: [order({ status: "PENDING" })] }).text).not.toContain("пришли ключ");
  });

  it("бонус и скидка стоят в шапке одной строкой", () => {
    const text = menu({ bonus: 150, bonusExpiresAt: new Date("2026-10-24T00:00:00Z"), rubleDiscount: 60 }).text;
    expect(text).toContain("🎁 150 R$");
    expect(text).toContain("24 октября");
    expect(text).toContain("💰 Скидка 60 ₽");
  });

  it("не превращается в простыню", () => {
    const lines = menu({
      bonus: 150,
      bonusExpiresAt: new Date("2026-10-24T00:00:00Z"),
      rubleDiscount: 60,
      active: [order(), order({ amount: 500 })],
      lastCompleted: order({ status: "COMPLETED", completedAt: new Date(NOW.getTime() - DAY) }),
    }).text.split("\n");
    expect(lines.length).toBeLessThanOrEqual(20);
  });

  it("без заказов зовёт за прямым, а не показывает пустые блоки", () => {
    const text = menu({ active: [], lastCompleted: null, orderCount: 0, isReturning: false }).text;
    expect(text).not.toContain("ТВОЙ ЗАКАЗ");
    expect(text).not.toContain("ГОТОВО");
    expect(text).toContain("напрямую");
    expect(text).toContain("Новый клиент");
  });
});

describe("возраст словами покупателя", () => {
  it("без светофора — он для админов", () => {
    expect(humanAge(new Date(NOW.getTime() - 3 * DAY), NOW)).toBe("3 дня назад");
    expect(humanAge(new Date(NOW.getTime() - 3 * DAY), NOW)).not.toContain("🟠");
  });

  it.each([
    [60_000, "только что"],
    [20 * 60_000, "20 минут назад"],
    [3 * 3_600_000, "3 часа назад"],
    [21 * DAY, "21 день назад"],
  ])("%s мс → «%s»", (ms, expected) => {
    expect(humanAge(new Date(NOW.getTime() - (ms as number)), NOW)).toBe(expected);
  });
});

/** Один экран на оба бота: копии разъезжаются, а меню у покупателя одно. */
describe("оба бота зовут общий сборщик", () => {
  const ROOT = join(__dirname, "..", "..", "..");
  const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");

  it.each(["bots/tg/handlers.ts", "bots/vk/handlers.ts"])("%s использует buildBuyerMenuText", (file) => {
    expect(read(file)).toContain("buildBuyerMenuText({");
  });

  it("VK отдаёт текст без HTML", () => {
    const vk = read("bots/vk/handlers.ts");
    expect(vk).toContain("stripHtml(menu.text)");
  });

  it("у обоих есть кнопка «Другие заказы»", () => {
    expect(read("bots/tg/handlers.ts")).toContain("Другие заказы (${menu.othersCount})");
    expect(read("bots/vk/handlers.ts")).toContain("Другие заказы (${menu.othersCount})");
  });
});
