export {};

/**
 * Покупатель прислал в бота код доставки Wildberries вместо нашего.
 *
 * Он приходит с этим кодом не от глупости: в чате WB ему только что сказали
 * «пришлите код», а наш семизначный он потерял или не открыл. Механизм привязки
 * по коду доставки написан давно (F14), но две вещи делали его наполовину
 * бесполезным, и обе чинятся здесь:
 *
 * 1. **Промах возвращал `false`** — сообщение падало в общее «у тебя нет
 *    активных заявок». Это и тупик для человека, и оракул для перебора: по
 *    разнице ответов («передал менеджеру» против «нет заявок») пятизначный код
 *    отличим от чужого. Ответ обязан быть ОДИН на все исходы.
 *
 * 2. **Окно автопривязки в три часа.** Оценка, сделанная до данных. На
 *    07.09.2026 по 64 закрытым доставкам: 60 приходят за 3 часа, ещё 3 — за
 *    сутки, один — через 45 часов. Три часа отсекали каждого шестнадцатого, и
 *    каждый превращался в ручную переписку.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { AUTO_LINK_WINDOW_MS, allowDeliveryCodeAttempt } from "../wb-buyer-link";

const ROOT = join(__dirname, "..", "..", "..");
/** Только код: комментарии рассказывают, как было до правки. */
const code = (rel: string) =>
  readFileSync(join(ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const TG = code("bots/tg/handlers.ts");
const VK = code("bots/vk/handlers.ts");

describe("окно автопривязки", () => {
  test("сутки — покрывает 63 из 64 наблюдавшихся покупателей", () => {
    expect(AUTO_LINK_WINDOW_MS).toBe(24 * 60 * 60_000);
  });

  test("окно не безгранично: дальше зовём человека", () => {
    // За сутками это уже не «покупатель не дошёл», а разбор.
    expect(AUTO_LINK_WINDOW_MS).toBeLessThan(72 * 60 * 60_000);
  });
});

describe("лимит попыток остаётся единственной защитой от перебора", () => {
  test("три попытки в час на человека", () => {
    const key = `test:${Math.random()}`;
    expect(allowDeliveryCodeAttempt(key)).toBe(true);
    expect(allowDeliveryCodeAttempt(key)).toBe(true);
    expect(allowDeliveryCodeAttempt(key)).toBe(true);
    expect(allowDeliveryCodeAttempt(key)).toBe(false);
  });

  test("счётчик у каждого свой — чужие попытки не блокируют", () => {
    const a = `test-a:${Math.random()}`;
    const b = `test-b:${Math.random()}`;
    allowDeliveryCodeAttempt(a);
    allowDeliveryCodeAttempt(a);
    allowDeliveryCodeAttempt(a);
    expect(allowDeliveryCodeAttempt(a)).toBe(false);
    expect(allowDeliveryCodeAttempt(b)).toBe(true);
  });

  test("окно попыток истекает и счётчик обнуляется", () => {
    const key = `test-w:${Math.random()}`;
    expect(allowDeliveryCodeAttempt(key, 1, 1)).toBe(true);
    expect(allowDeliveryCodeAttempt(key, 1, 1)).toBe(false);
    const until = Date.now() + 5;
    while (Date.now() < until) { /* ждём истечения миллисекундного окна */ }
    expect(allowDeliveryCodeAttempt(key, 1, 1)).toBe(true);
  });
});

describe("оба бота отвечают одинаково на любой исход", () => {
  test.each([["TG", TG], ["VK", VK]])("%s не возвращает промах в общий обработчик", (_name, source) => {
    // `if (!match) return false` отправлял человека в «нет активных заявок»
    // и делал ответ бота различимым — обе беды разом.
    expect(source).not.toContain("if (!match) return false;");
    expect(source).toContain("if (!match) {");
  });

  test.each([["TG", TG], ["VK", VK]])("%s зовёт оператора, когда кода нет в базе", (_name, source) => {
    // Кода доставки у нас нет у 70 % DBS-заказов (покупатель не присылал его в
    // чат WB) — без пинга оператор просто не узнаёт, что человек пришёл.
    expect(source).toContain("notifyDbsUnknownDeliveryCode");
  });

  test.each([["TG", TG], ["VK", VK]])("%s ловит 5–6 цифр только у человека без активного шага", (_name, source) => {
    expect(source).toMatch(/\\d\{5,6\}\$/);
  });
});

describe("проба живости моста", () => {
  const bridge = code("bots/shared/bridge.ts");

  test("/healthz отвечает без ключа — иначе healthcheck видит 401", () => {
    const health = bridge.indexOf('url.pathname === "/healthz"');
    const auth = bridge.indexOf("if (expectedKey) {");
    expect(health).toBeGreaterThan(-1);
    expect(health).toBeLessThan(auth);
  });

  test("проба ничего не рассказывает о содержимом моста", () => {
    const line = bridge.split("\n").find((l) => l.includes("uptime: Math.round")) ?? "";
    expect(line).toContain("ok: true");
    expect(line).not.toMatch(/token|key|cookie/i);
  });
});
