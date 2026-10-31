export {};

/**
 * У каждого бота свой `package.json` и свой образ.
 *
 * 02.09.2026 VK-бот ушёл в crash-loop в проде: в `bots/vk/handlers.ts` появился
 * value-импорт из `wb-delivery-sync`, тот тянет `wb-delivery-api`, тот — `zod`,
 * а `bots/vk/package.json` про `zod` не знает. Образ при этом собрался
 * **зелёным**: tsx резолвит импорты только в рантайме, поэтому падение
 * случилось на старте контейнера, уже в продакшене.
 *
 * Тест проходит граф импортов от точки входа каждого бота и проверяет, что
 * VK-бот не достаёт до воркера WB. `import type` не считается: он стирается при
 * транспиляции и рантайму ничего не стоит.
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

const ROOT = resolve(__dirname, "../../..");

/** Спецификаторы модулей, которые действительно окажутся в рантайме. */
function runtimeSpecifiers(source: string): string[] {
  const out: string[] = [];
  const re = /import\s+(type\s+)?([\s\S]*?)from\s+"([^"]+)"/g;
  for (let m = re.exec(source); m; m = re.exec(source)) {
    if (m[1]) continue;                       // import type { X } from "…"
    if (m[2].trimStart().startsWith("type ")) continue;
    out.push(m[3]);
  }
  return out;
}

function resolveRelative(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const base = resolve(dirname(fromFile), specifier);
  for (const candidate of [`${base}.ts`, `${base}/index.ts`]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function runtimeGraph(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [resolve(ROOT, entry)];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    for (const specifier of runtimeSpecifiers(readFileSync(file, "utf8"))) {
      const next = resolveRelative(file, specifier);
      if (next) queue.push(next);
    }
  }
  return seen;
}

const hits = (graph: Set<string>, needle: string) =>
  [...graph].filter((file) => file.includes(needle)).map((file) => file.replace(`${ROOT}/`, ""));

describe("граф модулей ботов", () => {
  it("VK-бот не тянет воркер WB и его API — в его образе нет zod", () => {
    const graph = runtimeGraph("bots/vk/bot.ts");
    expect(hits(graph, "wb-delivery-api")).toEqual([]);
    expect(hits(graph, "wb-delivery-sync")).toEqual([]);
  });

  it("живая карточка DBS доступна обоим ботам — она вынесена из воркера", () => {
    for (const entry of ["bots/vk/bot.ts", "bots/tg/bot.ts"]) {
      expect(hits(runtimeGraph(entry), "wb-dbs-thread")).toEqual(["bots/shared/wb-dbs-thread.ts"]);
    }
  });

  // Воркер живёт на TG — там он и должен быть виден.
  it("TG-бот воркер WB, наоборот, тянет", () => {
    expect(hits(runtimeGraph("bots/tg/bot.ts"), "wb-delivery-sync")).not.toEqual([]);
  });
});
