import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Контракт раздела «пасс по ключу» в инструкции.
 *
 * Держим то, что легко сломать правкой вёрстки и не увидеть глазами:
 *   • все кадры, на которые ссылается компонент, лежат в public/guide;
 *   • ползунок Experience Restrictions НЕ обведён (обведённое жмут не читая,
 *     а он уводит человека в лишнее окно и выбор опыта — решение владельца 06.09);
 *   • у каждого шага есть кадр и под телефон, и под ПК;
 *   • ключ не утекает: ни в URL, ни в лог.
 */

const ROOT = process.cwd();
const COMPONENT = join(ROOT, "src/app/guide/KeyCreate.tsx");
const ROUTE = join(ROOT, "src/app/api/roblox/gamepass-create/route.ts");
const src = readFileSync(COMPONENT, "utf8");
const routeSrc = readFileSync(ROUTE, "utf8");

describe("кадры инструкции про ключ", () => {
  const refs = [...src.matchAll(/"(\/guide\/wb-key-[a-z0-9-]+\.jpg)"/g)].map((m) => m[1]);

  test("компонент ссылается на кадры обеих платформ", () => {
    expect(refs.filter((r) => r.includes("wb-key-m-")).length).toBeGreaterThanOrEqual(8);
    expect(refs.filter((r) => r.includes("wb-key-pc-")).length).toBeGreaterThanOrEqual(7);
  });

  test("каждый кадр реально лежит в public/guide", () => {
    const missing = [...new Set(refs)].filter((r) => !existsSync(join(ROOT, "public", r)));
    expect(missing).toEqual([]);
  });
});

describe("рамки-подсветки", () => {
  test("ползунок не обведён: жёлтых рамок в разделе нет вовсе", () => {
    expect(src).not.toContain('wbi-box y');
  });

  test("красная рамка ровно одна на платформу — это legacy-game-passes", () => {
    const red = [...src.matchAll(/wbi-box r/g)].length;
    expect(red).toBe(2); // мобильная ветка и десктопная
  });

  test("у рамок заданы все четыре координаты (иначе рамка уезжает)", () => {
    const boxes = [...src.matchAll(/className="wbi-box[^"]*" style=\{\{([^}]+)\}\}/g)].map((m) => m[1]);
    expect(boxes.length).toBeGreaterThan(8);
    for (const box of boxes) {
      expect(box).toContain("left:");
      expect(box).toContain("top:");
      expect(box).toContain("width:");
      expect(box).toContain("height:");
    }
  });
});

describe("ключ покупателя не утекает", () => {
  test("уходит только телом POST — ни в URL, ни в query", () => {
    expect(src).toContain('method: "POST"');
    expect(src).not.toMatch(/gamepass-create\?[^"]*key/);
  });

  test("после успеха поле очищается", () => {
    expect(src).toContain('setApiKey("")');
  });

  test("роут не логирует тело запроса", () => {
    const logs = [...routeSrc.matchAll(/console\.(log|warn|error)\(([^\n]*)/g)].map((m) => m[2]);
    for (const line of logs) {
      expect(line).not.toContain("body");
      expect(line).not.toContain("key");
    }
  });

  test("роут закрыт флагом и рейт-лимитом", () => {
    expect(routeSrc).toContain("gamepassAutocreateEnabled()");
    expect(routeSrc).toContain("rateLimit(");
  });
});
