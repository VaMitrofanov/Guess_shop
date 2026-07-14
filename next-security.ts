import type { NextConfig } from "next";

/**
 * Shared response headers for the main storefront and the separately-built
 * guide container. Keep this file outside `src/`: both Next configs import it
 * during build, before route pruning in Dockerfile.guide.
 *
 * CSP intentionally permits the self-hosted VK SDK and the Next runtime. A
 * nonce-based policy is a later hardening step: it needs WebView coverage for
 * VK ID and Telegram before enforcement can be tightened safely.
 */
const commonCsp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://telegram.org",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  // ⚠️ The vendored VK ID SDK (public/vendor/vkid-sdk-*.js) builds its
  // endpoints from the vk.ru domain (id.vk.ru / oauth.vk.ru / api.vk.ru /
  // login.vk.ru), NOT vk.com — both families must stay whitelisted or the
  // OAuth code exchange is blocked client-side with no server-side trace
  // (docs/security.md, риск №16). Contract test: src/__tests__/csp-vk-hosts.test.ts
  "connect-src 'self' https://id.vk.com https://oauth.vk.com https://api.vk.com https://login.vk.com https://id.vk.ru https://oauth.vk.ru https://api.vk.ru https://login.vk.ru https://telegram.org",
  "frame-src 'self' https://id.vk.com https://oauth.vk.com https://login.vk.com https://id.vk.ru https://oauth.vk.ru https://login.vk.ru https://oauth.telegram.org https://telegram.org",
  "form-action 'self'",
].join("; ");

const commonHeaders = [
  { key: "Content-Security-Policy", value: `${commonCsp}; frame-ancestors 'self'` },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
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
