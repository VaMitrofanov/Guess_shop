/**
 * Диагностика браузерного транспорта выкупа. Ничего не покупает, cookie не трогает,
 * POST к Roblox не шлёт — только открывает страницу пасса и снимает то, на что смотрит
 * chef-challenge Roblox (см. docs/roblox-plus-buyout-plan.md).
 *
 * Запуск только на SG-сервере выкупа. Probe не проверяет donor readiness: для этого
 * используется Bearer-auth `/session`; donor-cookie нельзя проверять с RF/Node напрямую.
 *
 *   DISPLAY=:99 CHROME_PATH=/usr/bin/google-chrome-stable node browser-buyout-probe.mjs [gamepassId]
 *
 * Что должно быть в норме:
 *   startFlow            function            ← иначе покупать нечем
 *   webdriver            false               ← иначе маркер автоматизации
 *   brands               …Google Chrome      ← Chromium/Chrome for Testing бренд не отдают
 *   webglRenderer        не пусто            ← без GPU нужен SwiftShader-флаг
 *
 * `SwiftShader` в рендерере на VPS без видеокарты неустраним — это принятый риск,
 * а не поломка.
 */
import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME_PATH ?? "/usr/bin/google-chrome-stable";
const PROFILE = process.env.PROFILE_DIR ?? "/opt/roblox-buyout/profile";
const GP = process.argv[2] ?? "1882704092";

export const CHROME_ARGS = [
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--window-size=1280,900",
  // Без этого navigator.webdriver === true.
  "--disable-blink-features=AutomationControlled",
  // GPU на VPS нет: без этих трёх WebGL-контекст не создаётся вообще.
  "--enable-unsafe-swiftshader",
  "--use-gl=angle",
  "--use-angle=swiftshader",
];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  // headful под Xvfb: headless детектится отдельно от WebGL.
  headless: false,
  userDataDir: PROFILE,
  args: CHROME_ARGS,
  ignoreDefaultArgs: ["--enable-automation"],
});

try {
  const page = await browser.newPage();
  await page.goto(`https://www.roblox.com/game-pass/${GP}`, { waitUntil: "networkidle2", timeout: 60_000 });
  // Модуль покупки приезжает отдельным чанком уже после первой отрисовки.
  await new Promise((r) => setTimeout(r, 5_000));

  const report = await page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl");
    const dbg = gl && gl.getExtension("WEBGL_debug_renderer_info");
    const ip = window.RobloxItemPurchase;
    return {
      title: document.title,
      url: location.href,
      loggedIn: !!(window.Roblox?.CurrentUser?.userId),
      user: window.Roblox?.CurrentUser?.name ?? null,
      startFlow: ip ? typeof ip.startGamepassPurchaseFlow : "модуль не загружен",
      moduleKeys: ip ? Object.keys(ip).length : 0,
      webdriver: navigator.webdriver,
      brands: (navigator.userAgentData?.brands ?? []).map((b) => b.brand).join(", "),
      webglVendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : "нет WebGL",
      webglRenderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : "нет WebGL",
      hardwareConcurrency: navigator.hardwareConcurrency,
      ua: navigator.userAgent,
    };
  });

  console.log(JSON.stringify(report, null, 2));

  const problems = [
    report.startFlow !== "function" && "модуль покупки не загрузился",
    report.webdriver === true && "navigator.webdriver=true",
    !report.brands.includes("Google Chrome") && "бренд не Google Chrome",
    report.webglRenderer === "нет WebGL" && "WebGL недоступен",
  ].filter(Boolean);

  console.log(problems.length ? `\n❌ Проблемы: ${problems.join("; ")}` : "\n✅ Транспорт готов к тесту покупки");
  process.exitCode = problems.length ? 1 : 0;
} finally {
  await browser.close();
}
