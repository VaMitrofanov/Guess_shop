import fs from "fs";
import path from "path";
import {
  platformFromUserAgent,
  platformFromBrowser,
  GUIDE_PLATFORM_KEY,
} from "@/lib/device-platform";

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

/**
 * Короткий путь до формы пасса (сентябрь 2026) и разделение «телефон/компьютер».
 * Тест держит три вещи, которые легко сломать не глядя:
 *   1) основной маршрут идёт через ПОИСК, а старый путь остался запасным;
 *   2) кадры под устройство доезжают до ВСЕХ трёх поверхностей;
 *   3) браузерная догадка не может понизить телефон до компьютера.
 */
describe("инструкция: ярлык через поиск Creator Hub", () => {
  const steps = () => read("src/app/guide/guide-steps.tsx");

  test("основной маршрут — поиск, а не Monetization → Passes", () => {
    const s = steps();
    // Шаг 2 учит искать «pass» и жать «Create Pass».
    expect(s).toContain("Найди «Create Pass» через поиск");
    // Кадры ярлыка есть под оба устройства.
    for (const asset of ["/guide/wb-m-search.mp4", "/guide/wb-pc-search.mp4"]) {
      expect(s).toContain(asset);
    }
    // Старый путь остался, но ТОЛЬКО как свёрнутый запасной вариант.
    const longWay = s.slice(s.indexOf("function LongWayFallback"), s.indexOf("export interface GuideStepsProps"));
    expect(longWay).toContain("Monetization");
    expect(longWay).toContain("<details");
    // Вне запасного блока «Monetization» из инструкции ушло: если он всплывёт
    // в основном маршруте — значит человека снова повели длинной дорогой.
    // Комментарии не в счёт: они как раз объясняют, почему путь убрали.
    const mainRoute = s.replace(longWay, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(mainRoute).not.toContain("Monetization");
  });

  test("создание пасса укладывается в 4 шага (5 — когда пассов два)", () => {
    const s = steps();
    expect(s).toMatch(/<Step n="4" cls="wbi-key">/);
    expect(s).not.toContain('<Step n="6"');
    expect(s).not.toContain('<Step n="7"');
    // Финиш на пошаговой странице продолжает нумерацию инструкции.
    const page = read("src/app/guide/WBInstructionV2.tsx");
    expect(page).toContain('<Step n="5" pulse cls="wbi-key wbi-finish">');
    expect(page).toContain('<Step n="6">');
    // Ссылок на «шаг 7» после пересборки остаться не должно.
    expect(page).not.toMatch(/шаг[а-я]* <b>7<\/b>/);
  });

  test("кадры под устройство доезжают до всех трёх поверхностей", () => {
    // page.tsx читает User-Agent и отдаёт догадку в первом HTML.
    const page = read("src/app/guide/page.tsx");
    expect(page).toContain("platformFromUserAgent");
    expect(page).toContain("initialPlatform={initialPlatform}");
    // GuideClient раздаёт её и в проверку аккаунта, и в пошаговую страницу.
    const client = read("src/app/guide/GuideClient.tsx");
    expect(client.match(/initialPlatform=\{initialPlatform\}/g) ?? []).toHaveLength(3);
    // Обе поверхности прокидывают её дальше в общие шаги.
    for (const file of ["src/app/guide/WBInstructionV2.tsx", "src/app/guide/GamepassCheck.tsx"]) {
      expect(read(file)).toContain("initialPlatform={initialPlatform}");
    }
  });

  test("возврат в бота и на сайт от платформы не зависит", () => {
    // Хендофф живёт вне общих шагов: WB-гейт и прямой заказ уводят в бота,
    // сайт — в оформление. Платформа не должна там появляться никогда.
    const check = read("src/app/guide/GamepassCheck.tsx");
    expect(check).toContain("Заказ оформлен — вернись в бота");
    const handoff = check.slice(check.indexOf("Заказ оформлен — вернись в бота"));
    expect(handoff).not.toContain("initialPlatform");
    expect(handoff).not.toContain("platform ===");
  });
});

describe("определение устройства", () => {
  test("User-Agent: телефон отличается от компьютера", () => {
    expect(platformFromUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Mobile/15E148")).toBe("mobile");
    expect(platformFromUserAgent("Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari/537.36")).toBe("mobile");
    // Android-планшет без «Mobile» ближе к десктопной раскладке.
    expect(platformFromUserAgent("Mozilla/5.0 (Linux; Android 14; Tab S9) Safari/537.36")).toBe("pc");
    expect(platformFromUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/128")).toBe("pc");
    expect(platformFromUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128")).toBe("pc");
    expect(platformFromUserAgent(null)).toBe("pc");
  });

  test("браузер умеет только повысить до телефона, но не понизить", () => {
    const withEnv = (coarse: boolean, touchPoints: number) => {
      const w = global as unknown as { window?: unknown; navigator?: unknown };
      const prevW = w.window;
      const prevN = w.navigator;
      w.window = { matchMedia: () => ({ matches: coarse }) };
      w.navigator = { maxTouchPoints: touchPoints };
      try {
        return platformFromBrowser();
      } finally {
        w.window = prevW;
        w.navigator = prevN;
      }
    };
    // Айпад, который представляется макинтошем: тач есть — поднимаем до телефона.
    expect(withEnv(true, 5)).toBe("mobile");
    // Обычный десктоп: добавить нечего, серверная догадка остаётся в силе.
    expect(withEnv(false, 0)).toBeNull();
    // Ключевое: «pc» отсюда не возвращается НИКОГДА — иначе телефон, у которого
    // matchMedia ответил не то, останется без своих кадров.
    for (const [c, t] of [[true, 0], [false, 5], [false, 0], [true, 5]] as const) {
      expect(withEnv(c, t)).not.toBe("pc");
    }
  });

  test("ключ выбора один на все поверхности", () => {
    expect(GUIDE_PLATFORM_KEY).toBe("rb_guide_platform");
  });
});
