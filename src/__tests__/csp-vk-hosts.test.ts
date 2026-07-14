/**
 * Contract: every VK host family referenced by the vendored VK ID SDK must be
 * whitelisted in the CSP (next-security.ts).
 *
 * Инцидент 2026-07-14 (docs/security.md, риск №16): SDK 2.6.5 строит свои
 * эндпоинты от домена `vk.ru` (id.vk.ru / oauth.vk.ru / api.vk.ru /
 * login.vk.ru), а CSP разрешал только *.vk.com — обмен OAuth-кода молча
 * блокировался браузером, VK-логин был сломан на проде сутки без серверных
 * следов. Этот тест валит CI при любом рассинхроне «vendored SDK ↔ CSP»:
 * и при обновлении SDK (новый домен внутри бандла), и при правке CSP.
 */

import { readdirSync, readFileSync } from "fs";
import path from "path";
import { securityHeaders } from "../../next-security";

const VENDOR_DIR = path.join(__dirname, "..", "..", "public", "vendor");

/** Subdomains the SDK derives from each base domain (see bundle: `"id.".concat(base)` etc.). */
const CONNECT_SUBDOMAINS = ["id", "oauth", "api", "login"];
const FRAME_SUBDOMAINS = ["id", "oauth", "login"];

function loadSdkSources(): { file: string; source: string }[] {
  return readdirSync(VENDOR_DIR)
    .filter((f) => /^vkid-sdk-.*\.js$/.test(f))
    .map((f) => ({ file: f, source: readFileSync(path.join(VENDOR_DIR, f), "utf8") }));
}

/** Base VK domains ("vk.ru" / "vk.com") referenced as string literals in the bundle. */
function extractVkBaseDomains(source: string): string[] {
  const bases = new Set<string>();
  for (const m of source.matchAll(/"\.?(vk\.(?:ru|com))"/g)) bases.add(m[1]);
  return [...bases];
}

async function getCspDirectives(): Promise<Record<string, string>> {
  const rules = await (securityHeaders as () => Promise<
    { source: string; headers: { key: string; value: string }[] }[]
  >)();
  const root = rules.find((r) => r.source === "/:path*");
  const csp = root?.headers.find((h) => h.key === "Content-Security-Policy")?.value;
  if (!csp) throw new Error("Root CSP header not found in next-security.ts");
  const directives: Record<string, string> = {};
  for (const part of csp.split(";")) {
    const [name, ...rest] = part.trim().split(/\s+/);
    if (name) directives[name] = rest.join(" ");
  }
  return directives;
}

describe("CSP covers every VK host family used by the vendored VK ID SDK", () => {
  const sdks = loadSdkSources();

  it("finds at least one vendored VK ID SDK bundle", () => {
    expect(sdks.length).toBeGreaterThan(0);
  });

  it("extracts at least one VK base domain from each bundle", () => {
    for (const { file, source } of sdks) {
      const bases = extractVkBaseDomains(source);
      expect({ file, bases: bases.length > 0 }).toEqual({ file, bases: true });
    }
  });

  it("whitelists id/oauth/api/login of each SDK domain in connect-src", async () => {
    const { "connect-src": connectSrc } = await getCspDirectives();
    for (const { file, source } of sdks) {
      for (const base of extractVkBaseDomains(source)) {
        for (const sub of CONNECT_SUBDOMAINS) {
          const host = `https://${sub}.${base}`;
          expect({ file, host, allowed: connectSrc.includes(host) }).toEqual({
            file,
            host,
            allowed: true,
          });
        }
      }
    }
  });

  it("whitelists id/oauth/login of each SDK domain in frame-src", async () => {
    const { "frame-src": frameSrc } = await getCspDirectives();
    for (const { file, source } of sdks) {
      for (const base of extractVkBaseDomains(source)) {
        for (const sub of FRAME_SUBDOMAINS) {
          const host = `https://${sub}.${base}`;
          expect({ file, host, allowed: frameSrc.includes(host) }).toEqual({
            file,
            host,
            allowed: true,
          });
        }
      }
    }
  });
});
