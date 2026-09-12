import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * С RF-хоста наружу ходим только через сингапурский мост.
 *
 * Два живых случая, из-за которых этот файл существует:
 *
 * 1. **Алерты drift-watch молчали шесть недель.** Скрипт слал в
 *    `api.telegram.org` напрямую — с хоста, который Telegram не видит (ровно
 *    поэтому оба бота и сайт живут за мостом). С 27.07 по 07.09 в логе 3046
 *    строк `alert to <id> failed`, `curl: (28) Failed to connect`. Монитор при
 *    этом исправно чинил Guide, то есть работал вслепую: перестань самолечение
 *    справляться — никто бы не узнал.
 *
 * 2. **Донорский cookie уходил в Roblox напрямую.** Запасной путь в
 *    `roblox-account` слал `.ROBLOSECURITY` в `users.roblox.com` мимо
 *    единственной разрешённой точки выхода, а с 27.08 ещё и гарантированно
 *    падал в таймаут — и его `ok: false` подставлялся как вердикт «Cookie
 *    невалиден». Оператор шёл перевыпускать рабочий cookie.
 *
 * Контракт единственной точки выхода донорского cookie держит
 * `donor-single-egress.test.ts`; здесь — про честность вердикта и про Telegram.
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
/** Только КОД: комментарии этого же файла объясняют, чего в нём больше нет, и
 *  без вычистки проверка ловила бы собственное объяснение. */
const code = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
/** То же для shell: строки-комментарии объясняют, как делать НЕ надо. */
const shellCode = (rel: string) => read(rel).replace(/^\s*#.*$/gm, "");

describe("drift-watch шлёт алерты через мост", () => {
  const script = shellCode("scripts/drift-watch.sh");

  test("отправка идёт на /tg-proxy и берёт адрес моста из окружения Web", () => {
    expect(script).toContain("/tg-proxy");
    expect(script).toContain("VALIDATOR_SOURCE_URL");
    expect(script).toContain("VALIDATOR_KEY");
  });

  test("прямой вызов Telegram остался только запасным путём", () => {
    // Он допустим (хост может и видеть Telegram), но не может быть единственным.
    const direct = script.indexOf("api.telegram.org/bot");
    const bridge = script.indexOf("$bridge/tg-proxy");
    expect(bridge).toBeGreaterThan(-1);
    expect(bridge).toBeLessThan(direct);
  });

  test("ключ моста передаётся массивом, а не подстановкой с кавычками", () => {
    // `${bkey:+-H "x-validator-key: $bkey"}` bash разбивает по пробелам уже
    // ПОСЛЕ подстановки, кавычки не перечитываются — мост отвечал бы 401.
    expect(script).not.toContain('${bkey:+-H');
    expect(script).toContain('curl_headers+=(-H "x-validator-key: $bkey")');
  });

  test("исход отправки виден в логе, а не только ошибка curl", () => {
    // `-o /dev/null` прятал тело ответа, и `{"ok":false}` выглядел успехом.
    expect(script).toContain('"ok":true');
    expect(script).toContain("alert delivered");
  });

  test("значения можно подменить снаружи — иначе отправку нечем проверить", () => {
    expect(script).toContain('if [[ -n "${!name:-}" ]]; then');
  });
});

describe("донорский cookie: недоступный сервис не выдаётся за плохой cookie", () => {
  const route = code("src/app/api/twa/roblox-account/route.ts");

  test("прямого запроса в Roblox с cookie больше нет", () => {
    expect(route).not.toContain("robloxApiFallback");
    expect(route).not.toContain("users.roblox.com");
    expect(route).not.toContain("economy.roblox.com");
  });

  test("вердикт «Cookie невалиден» больше не выносится вслепую", () => {
    expect(route).not.toContain("Cookie невалиден — Roblox не принял");
  });

  test("лежащий сервис — это «не проверяли», а не «плохой»", () => {
    // Клиент считает cookie плохим только по явному `false`.
    expect(route).toContain("cookieValid: serviceDown ? null : false");
    expect(route).toContain("browserUnavailable: serviceDown");
  });

  test("непроверенный cookie не сохраняется", () => {
    // Сохранение живёт только в ветке, где браузерный сервис ответил `ok`.
    const save = route.slice(route.indexOf('body.action === "set-cookie"'));
    const upsert = save.indexOf("globalSettings.upsert");
    const okBranch = save.indexOf("browser.ok && browser.session");
    expect(okBranch).toBeGreaterThan(-1);
    expect(upsert).toBeGreaterThan(okBranch);
    expect(save.split("globalSettings.upsert").length - 1).toBe(1);
  });
});
