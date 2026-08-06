/**
 * D3 (ultra-review 28.07): тема применяется boot-скриптом в <head> до первой
 * отрисовки. У этого решения две связки, которые ломаются молча:
 *
 *   1. ключ localStorage в скрипте ↔ STORAGE_KEY в ThemeProvider —
 *      разъедутся, и первый кадр будет выбирать тему не тем источником;
 *   2. текст скрипта ↔ sha256-хеш в CSP — разъедутся, и браузер заблокирует
 *      скрипт, вернув ровно тот FOUC, ради которого всё делалось.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { THEME_BOOT_SCRIPT, THEME_STORAGE_KEY } from "@/lib/theme-boot";
import { THEME_BOOT_CSP_HASH, securityHeaders } from "../../next-security";

const root = path.resolve(__dirname, "../..");

describe("boot-скрипт темы", () => {
  it("использует тот же ключ хранилища, что и ThemeProvider", () => {
    const provider = readFileSync(path.join(root, "src/components/theme-provider.tsx"), "utf8");
    // Провайдер обязан брать ключ из общего модуля, а не объявлять свой литерал.
    expect(provider).toContain("THEME_STORAGE_KEY");
    expect(THEME_BOOT_SCRIPT).toContain(`'${THEME_STORAGE_KEY}'`);
  });

  it("проставляет data-theme и colorScheme синхронно", () => {
    expect(THEME_BOOT_SCRIPT).toContain("dataset.theme");
    expect(THEME_BOOT_SCRIPT).toContain("colorScheme");
    expect(THEME_BOOT_SCRIPT).toContain("prefers-color-scheme: dark");
  });

  it("не падает, если localStorage недоступен", () => {
    expect(THEME_BOOT_SCRIPT).toContain("try{");
    expect(THEME_BOOT_SCRIPT).toContain("catch");
  });

  it("реально применяет тёмную тему при системной тёмной и пустом хранилище", () => {
    const element = { dataset: {} as Record<string, string>, style: {} as Record<string, string> };
    const sandbox = {
      localStorage: { getItem: () => null },
      window: { matchMedia: () => ({ matches: true }) },
      document: { documentElement: element },
    };
    new Function("localStorage", "window", "document", THEME_BOOT_SCRIPT)(
      sandbox.localStorage, sandbox.window, sandbox.document,
    );
    expect(element.dataset.theme).toBe("dark");
    expect(element.dataset.themeMode).toBe("auto");
    expect(element.style.colorScheme).toBe("dark");
  });

  it("явный светлый выбор побеждает системную тёмную", () => {
    const element = { dataset: {} as Record<string, string>, style: {} as Record<string, string> };
    new Function("localStorage", "window", "document", THEME_BOOT_SCRIPT)(
      { getItem: () => "light" },
      { matchMedia: () => ({ matches: true }) },
      { documentElement: element },
    );
    expect(element.dataset.theme).toBe("light");
  });
});

describe("CSP", () => {
  /** Директива `script-src` из боевой и из Report-Only политики. */
  async function scriptSrc(): Promise<{ enforced: string; reportOnly: string }> {
    const headers = await securityHeaders();
    const common = headers[0].headers;
    const pick = (key: string) => common.find((h) => h.key === key)!.value.match(/script-src[^;]*/)![0];
    return { enforced: pick("Content-Security-Policy"), reportOnly: pick("Content-Security-Policy-Report-Only") };
  }

  it("хеш посчитан именно от вставляемого скрипта", () => {
    const expected = `'sha256-${createHash("sha256").update(THEME_BOOT_SCRIPT, "utf8").digest("base64")}'`;
    expect(THEME_BOOT_CSP_HASH).toBe(expected);
  });

  it("хеш живёт в Report-Only и не попадает в боевую политику", async () => {
    const { enforced, reportOnly } = await scriptSrc();

    expect(reportOnly).toContain(THEME_BOOT_CSP_HASH);
    expect(enforced).not.toContain(THEME_BOOT_CSP_HASH);

    // Строгая политика не должна тихо обзавестись послаблениями в script-src.
    // `style-src 'unsafe-inline'` пока остаётся осознанно — это отдельный шаг
    // (риск №26), поэтому проверяем именно директиву скриптов.
    expect(reportOnly).not.toContain("unsafe-inline");
    expect(reportOnly).not.toContain("unsafe-eval");
  });

  /**
   * Регресс 28.07: хеш добавили в боевую политику рядом с `'unsafe-inline'`.
   * По спецификации CSP hash- или nonce-источник отменяет `'unsafe-inline'` в
   * той же директиве, поэтому браузер заблокировал все inline-скрипты Next.js:
   * гидратация не запускалась, `/login` и `/checkout` отдавали пустой экран.
   * Пока в боевой политике есть `'unsafe-inline'`, hash/nonce в ней запрещены.
   */
  it("боевая политика не смешивает 'unsafe-inline' с hash или nonce", async () => {
    const { enforced } = await scriptSrc();
    if (!enforced.includes("'unsafe-inline'")) return;
    expect(enforced).not.toMatch(/'sha(256|384|512)-/);
    expect(enforced).not.toMatch(/'nonce-/);
  });

  it("правило TWA наследует ту же директиву скриптов", async () => {
    const headers = await securityHeaders();
    const twa = headers.find((rule) => rule.source.startsWith("/twa"))!;
    const twaCsp = twa.headers.find((h) => h.key === "Content-Security-Policy")!.value;
    const twaScriptSrc = twaCsp.match(/script-src[^;]*/)![0];
    const { enforced } = await scriptSrc();
    expect(twaScriptSrc).toBe(enforced);
  });

  it("layout вставляет скрипт из общего модуля, а не свой литерал", () => {
    const layout = readFileSync(path.join(root, "src/app/layout.tsx"), "utf8");
    expect(layout).toContain("THEME_BOOT_SCRIPT");
  });
});
