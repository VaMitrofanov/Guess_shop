import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";

/**
 * Консоль админа и TWA не читают сессию next-auth — и не должны начать молча.
 *
 * `SessionProvider` отдаёт им `session={null}`, чтобы не ходить в
 * `/api/auth/session` ради никого: на проде это два запроса на открытие
 * страницы, каждый со своим заходом в базу в Сингапуре (см.
 * `docs/admin-performance-optimization-plan-2026-08-04.md`). Личность там
 * приходит с сервера — `resolveAdminFromSession` в layout консоли и
 * Bearer-пропуск в TWA.
 *
 * Цена допущения — ровно в том, что оно молчаливое: экран, который однажды
 * позовёт `useSession` под `/admin` или `/twa`, получит «не авторизован» и
 * спрячет то, что должен показать, не сломавшись ни единым исключением.
 * Поэтому граница держится тестом, а не комментарием.
 *
 * Если такой экран действительно понадобится — снимать надо не тест, а
 * исключение в `readsSession` для его пути.
 */

const root = path.join(__dirname, "..");

/** Все `.ts`/`.tsx` под каталогом, рекурсивно. */
function sourcesUnder(dir: string): string[] {
  const absolute = path.join(root, dir);
  const out: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      const full = path.join(current, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (/\.tsx?$/.test(entry)) out.push(full);
    }
  };
  walk(absolute);
  return out;
}

/** Поверхности, которым провайдер отдаёт `session={null}`. */
const SILENT_SURFACES = [
  "app/admin/(protected)",
  "app/twa",
  "components/admin",
];

describe("SessionProvider молчит там, где сессию никто не читает", () => {
  it.each(SILENT_SURFACES)("%s не вызывает useSession", (dir) => {
    const offenders = sourcesUnder(dir).filter((file) =>
      /\buseSession\b/.test(readFileSync(file, "utf8")),
    );
    expect(offenders.map((file) => path.relative(root, file))).toEqual([]);
  });

  it("исключение для /admin/login на месте — там живёт Navbar с useSession", () => {
    // Обратная сторона правила: страница входа сессию читает, и провайдер
    // обязан оставаться там живым, иначе у вошедшего админа пропадут ссылки.
    expect(readFileSync(path.join(root, "app/admin/login/page.tsx"), "utf8")).toContain("Navbar");
    expect(readFileSync(path.join(root, "components/navbar.tsx"), "utf8")).toContain("useSession");

    const provider = readFileSync(path.join(root, "components/session-provider.tsx"), "utf8");
    expect(provider).toContain('pathname === "/admin/login"');
    // Пересоздание обязательно: провайдер решает «синхронизирован ли я» один
    // раз, и без ключа уход из админки оставил бы Navbar разлогиненным.
    expect(provider).toMatch(/key=\{live \? "live" : "silent"\}/);
  });
});
