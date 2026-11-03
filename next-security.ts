import type { NextConfig } from "next";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { THEME_BOOT_SCRIPT } from "./src/lib/theme-boot";

/**
 * D3: хеш boot-скрипта темы для строгой политики. Хеш считается из той же
 * константы, что вставляется в разметку, поэтому разъехаться они не могут.
 *
 * ⚠️ Хеш живёт **только** в Report-Only. В боевой политике его быть не должно,
 * пока там есть `'unsafe-inline'`: по спецификации CSP наличие hash- или
 * nonce-источника **отменяет** `'unsafe-inline'` в той же директиве. 28.07 хеш
 * добавили в боевую политику — и она мгновенно заблокировала все inline-скрипты
 * Next.js: гидратация не запускалась вообще, клиентские страницы (`/login`,
 * `/checkout`) отдавали пустой экран. Убирать `'unsafe-inline'` можно только
 * вместе с переходом на nonce (риск №26, docs/security.md).
 * Контракт-тест: src/__tests__/theme-boot.test.ts.
 */
export const THEME_BOOT_CSP_HASH = `'sha256-${createHash("sha256").update(THEME_BOOT_SCRIPT, "utf8").digest("base64")}'`;

/**
 * Shared response headers for the main storefront and the separately-built
 * guide container. Keep this file outside `src/`: both Next configs import it
 * during build, before route pruning in Dockerfile.guide.
 *
 * CSP intentionally permits the bundled official VK SDK and the Next runtime. A
 * nonce-based policy is a later hardening step: it needs WebView coverage for
 * VK ID and Telegram before enforcement can be tightened safely.
 */
const commonCsp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  // Никаких hash/nonce в этой строке, пока в ней есть 'unsafe-inline':
  // они его отменяют, и Next.js остаётся без своих inline-скриптов.
  // Boot-скрипт темы здесь разрешён тем же 'unsafe-inline', что и остальные.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://telegram.org",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  // ⚠️ The official @vkid/sdk package builds its
  // endpoints from the vk.ru domain (id.vk.ru / oauth.vk.ru / api.vk.ru /
  // login.vk.ru), NOT vk.com — both families must stay whitelisted or the
  // OAuth code exchange is blocked client-side with no server-side trace
  // (docs/security.md, риск №16). Contract test: src/__tests__/csp-vk-hosts.test.ts
  "connect-src 'self' https://id.vk.com https://oauth.vk.com https://api.vk.com https://login.vk.com https://id.vk.ru https://oauth.vk.ru https://api.vk.ru https://login.vk.ru https://telegram.org",
  "frame-src 'self' https://id.vk.com https://oauth.vk.com https://login.vk.com https://id.vk.ru https://oauth.vk.ru https://login.vk.ru https://oauth.telegram.org https://telegram.org",
  "form-action 'self'",
].join("; ");

// Web and Guide are built as separate Coolify applications. Hash only inputs
// that survive Dockerfile.guide route pruning; the same checkout must produce
// the same value in both containers, while an older Guide build exposes a
// different header and fails scripts/smoke-corridor.mjs.
const GUIDE_RELEASE_INPUTS = [
  "next-security.ts",
  "package.json",
  "package-lock.json",
  "src/app/guide",
  "src/auth.ts",
  "src/components",
  "src/hooks",
  "src/lib",
  "public/guide",
  "public/vendor",
];

function releaseFiles(entry: string): string[] {
  const absolute = path.resolve(process.cwd(), entry);
  if (!existsSync(absolute)) return [];
  if (!statSync(absolute).isDirectory()) return [absolute];
  return readdirSync(absolute, { withFileTypes: true })
    .filter((item) => item.name !== ".DS_Store")
    .flatMap((item) => releaseFiles(path.join(entry, item.name)))
    .sort();
}

export function guideReleaseFingerprint(): string {
  const hash = createHash("sha256");
  for (const file of GUIDE_RELEASE_INPUTS.flatMap(releaseFiles).sort()) {
    hash.update(path.relative(process.cwd(), file));
    hash.update("\0");
    hash.update(readFileSync(file));
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 16);
}

/**
 * U10 (ultra-review), этап 1: строгая политика едет параллельно боевой в режиме
 * `Report-Only`. Она ничего не блокирует — только присылает нарушения на
 * `/api/observability/csp-report`, чтобы можно было увидеть, что именно
 * сломается без `unsafe-inline`/`unsafe-eval`, ДО того как их убрать.
 *
 * Enforce включаем отдельным шагом, после чистого отчёта на iPhone, Android,
 * Telegram WebView и VK WebView. Порядок шагов — docs/security.md, риск №26.
 */
const reportOnlyCsp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  // Целевое состояние: ни unsafe-inline, ни unsafe-eval — только 'self' и
  // явно разрешённый по хешу boot-скрипт темы.
  `script-src 'self' ${THEME_BOOT_CSP_HASH} https://telegram.org`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://id.vk.com https://oauth.vk.com https://api.vk.com https://login.vk.com https://id.vk.ru https://oauth.vk.ru https://api.vk.ru https://login.vk.ru https://telegram.org",
  "frame-src 'self' https://id.vk.com https://oauth.vk.com https://login.vk.com https://id.vk.ru https://oauth.vk.ru https://login.vk.ru https://oauth.telegram.org https://telegram.org",
  "form-action 'self'",
  "report-uri /api/observability/csp-report",
].join("; ");

const commonHeaders = [
  { key: "Content-Security-Policy", value: `${commonCsp}; frame-ancestors 'self'` },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "X-RobloxBank-Guide-Release", value: guideReleaseFingerprint() },
  { key: "Content-Security-Policy-Report-Only", value: reportOnlyCsp },
];

export const securityHeaders: NonNullable<NextConfig["headers"]> = async () => [
  {
    source: "/:path*",
    headers: commonHeaders,
  },
  // TWA is intentionally embeddable by Telegram. This overrides only the CSP
  // value from the generic rule; other common headers remain in force.
  {
    source: "/twa/:path*",
    headers: [
      {
        key: "Content-Security-Policy",
        value: `${commonCsp}; frame-ancestors 'self' https://web.telegram.org https://*.telegram.org`,
      },
    ],
  },
];
