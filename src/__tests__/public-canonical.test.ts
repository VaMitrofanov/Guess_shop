/**
 * Contract: у каждой индексируемой страницы есть `<link rel="canonical">`
 * (D11, ultra-review 2026-07-28).
 *
 * Контент сайта доступен на apex и на `www` (последний отдаёт 308, но ссылки
 * из внешних источников ведут на оба), плюс `/guide` открывается с разными
 * query. Без canonical поисковик сам выбирает адрес — а канонический хост у
 * нас один и зафиксирован волной 0.
 *
 * Источник правды — `sitemap.ts`: добавили страницу в карту сайта, но забыли
 * canonical → тест красный. Значение берётся относительным, поэтому смена
 * канонического хоста остаётся правкой одного `metadataBase`.
 */

import { readFileSync } from "fs";
import path from "path";

const ROOT = path.join(__dirname, "..", "..");

function read(file: string): string {
  return readFileSync(path.join(ROOT, file), "utf8");
}

/** Пути из sitemap.ts — ровно то, что мы отдаём на индексацию. */
function sitemapPaths(): string[] {
  const source = read("src/app/sitemap.ts");
  return [...source.matchAll(/\{\s*path:\s*"([^"]+)"/g)].map((m) => m[1]);
}

/** Файл страницы App Router для пути маршрута. */
function pageFile(routePath: string): string {
  return routePath === "/" ? "src/app/page.tsx" : `src/app${routePath}/page.tsx`;
}

function declaredCanonical(file: string): string | null {
  const match = /alternates:\s*\{\s*canonical:\s*"([^"]+)"/.exec(read(file));
  return match ? match[1] : null;
}

describe("canonical на публичных страницах (D11)", () => {
  const paths = sitemapPaths();

  it("читает список индексируемых страниц из sitemap", () => {
    expect(paths).toContain("/");
    expect(paths.length).toBeGreaterThanOrEqual(5);
  });

  it("каждая страница из sitemap объявляет свой canonical", () => {
    for (const routePath of paths) {
      const file = pageFile(routePath);
      expect({ routePath, canonical: declaredCanonical(file) }).toEqual({
        routePath,
        canonical: routePath,
      });
    }
  });

  it("публичные юридические страницы тоже объявляют canonical", () => {
    for (const routePath of ["/legal/offer", "/legal/policy", "/legal/details"]) {
      expect({ routePath, canonical: declaredCanonical(pageFile(routePath)) }).toEqual({
        routePath,
        canonical: routePath,
      });
    }
  });

  it("canonical объявлен относительным путём, а не захардкоженным хостом", () => {
    for (const routePath of [...paths, "/legal/offer", "/legal/policy", "/legal/details"]) {
      const canonical = declaredCanonical(pageFile(routePath));
      expect({ routePath, absolute: canonical?.startsWith("http") ?? true }).toEqual({
        routePath,
        absolute: false,
      });
    }
  });

  it("корневой layout не объявляет canonical — иначе его унаследуют /login и /checkout", () => {
    expect(read("src/app/layout.tsx")).not.toMatch(/canonical:/);
  });
});
