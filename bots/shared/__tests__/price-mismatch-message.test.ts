export {};

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { priceMismatchMessage } from "../gamepass-acceptance";

/**
 * Порядок причин несовпадения цены — замечание владельца от 18.10.2026:
 * «Бот пишет что причина чаще всего в рег цене, но чаще всего она в том, что
 * цена реально не та, которая нужна. А потом уже в рег цене».
 *
 * До правки оба бота в этой ветке первой причиной называли Managed pricing,
 * причём TG попадал в неё ровно тогда, когда product-info сказал «выключен»,
 * а VK не спрашивал product-info вовсе.
 */
describe("priceMismatchMessage", () => {
  it("без подтверждённого Managed pricing первой причиной называет саму цену", () => {
    const text = priceMismatchMessage({ expected: 715, actual: 500 });
    const wrongPrice = text.indexOf("Цена указана не та");
    const managed = text.indexOf("Managed pricing");
    expect(wrongPrice).toBeGreaterThan(-1);
    expect(managed).toBeGreaterThan(wrongPrice);
    expect(text).toContain("715 R$");
    expect(text).toContain("500 R$");
  });

  it("второй причиной — несохранённая правка (Save Changes)", () => {
    const text = priceMismatchMessage({ expected: 715, actual: 500 });
    const save = text.indexOf("Save Changes");
    expect(save).toBeGreaterThan(text.indexOf("Цена указана не та"));
    expect(save).toBeLessThan(text.lastIndexOf("Managed pricing"));
  });

  it("с подтверждённым Managed pricing показывает три цены, а не догадку", () => {
    const text = priceMismatchMessage({ expected: 715, actual: 1430, managed: true, basePrice: 715 });
    expect(text).toContain("Managed pricing включён");
    expect(text).toContain("Цена Roblox: <b>1430 R$</b>");
    expect(text).toContain("Твоя цена:   <b>715 R$</b>");
    expect(text).toContain("Нужна:       <b>715 R$</b>");
    expect(text).not.toContain("Цена указана не та");
  });

  it("для набора называет цену части, а не всего заказа", () => {
    const text = priceMismatchMessage({ expected: 2143, actual: 1000, part: true });
    expect(text).toContain("одной части");
    expect(text).toContain("2143 R$");
  });

  it("не предлагает «скорее всего» — только проверяемые шаги", () => {
    const text = priceMismatchMessage({ expected: 715, actual: 500 });
    expect(text).not.toContain("Чаще всего");
  });
});

/** Слова про цену живут в одном месте — иначе боты разъедутся снова. */
describe("оба бота зовут общий текст", () => {
  const ROOT = join(__dirname, "..", "..", "..");
  const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");

  it.each(["bots/tg/handlers.ts", "bots/vk/handlers.ts"])("%s использует priceMismatchMessage", (file) => {
    expect(read(file)).toContain("priceMismatchMessage(");
  });

  it.each(["bots/tg/handlers.ts", "bots/vk/handlers.ts"])("%s не называет Managed pricing самой частой причиной", (file) => {
    expect(read(file)).not.toContain("Чаще всего причина — включённый");
  });

  it("VK спрашивает product-info перед тем, как винить Managed pricing", () => {
    const vk = read("bots/vk/handlers.ts");
    const call = vk.indexOf("priceMismatchMessage(");
    expect(vk.slice(Math.max(0, call - 600), call)).toContain("getGamepassProductInfo(passId)");
  });
});
