#!/usr/bin/env node
/**
 * Read-only storefront smoke. It validates public routing, SEO boundaries,
 * custom 404, security headers and the maintenance gate without touching DB.
 *
 * Usage:
 *   npm run smoke:site
 *   npm run smoke:site -- --base=http://127.0.0.1:3000 --expect-public
 *   npm run smoke:site -- --expect-maintenance
 */

const baseArg = process.argv.find((value) => value.startsWith("--base="));
const BASE = (baseArg?.slice("--base=".length) || "https://robloxbank.ru").replace(/\/$/, "");
const EXPECT_PUBLIC = process.argv.includes("--expect-public");
const EXPECT_MAINTENANCE = process.argv.includes("--expect-maintenance");
const failures = [];
let passed = 0;

function ok(label) {
  passed += 1;
  console.log(`  ✅ ${label}`);
}

function fail(label, detail) {
  failures.push(`${label}: ${detail}`);
  console.error(`  ❌ ${label}: ${detail}`);
}

async function request(path, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    return await fetch(`${BASE}${path}`, { ...init, signal: controller.signal, redirect: "manual" });
  } finally {
    clearTimeout(timer);
  }
}

async function checkStatus(path, expected) {
  try {
    const response = await request(path);
    if (response.status === expected) ok(`${path} → ${expected}`);
    else fail(path, `HTTP ${response.status}, ожидали ${expected}`);
    return response;
  } catch (error) {
    fail(path, error instanceof Error ? error.message : String(error));
    return null;
  }
}

console.log(`Storefront smoke: ${BASE}`);

const health = await checkStatus("/api/health", 200);
if (health) {
  for (const header of ["content-security-policy", "x-content-type-options", "referrer-policy"]) {
    if (health.headers.get(header)) ok(`/api/health содержит ${header}`);
    else fail("security headers", `${header} отсутствует`);
  }
}

const unknown = await checkStatus("/__site-smoke-not-found__", 404);
if (unknown) {
  const html = await unknown.text();
  if (html.includes("Страница не найдена")) ok("кастомная 404 отображается");
  else fail("custom 404", "не найден ожидаемый текст");
}

const robots = await checkStatus("/robots.txt", 200);
if (robots) {
  const body = await robots.text();
  if (body.includes("Disallow: /checkout") && body.includes("Sitemap: https://robloxbank.ru/sitemap.xml")) ok("robots закрывает checkout и объявляет sitemap");
  else fail("robots", "SEO boundaries не совпадают");
}

const sitemap = await checkStatus("/sitemap.xml", 200);
if (sitemap) {
  const body = await sitemap.text();
  if (!body.includes("/checkout") && !body.includes("/legal/offer") && body.includes("/faq")) ok("sitemap содержит только готовые публичные страницы");
  else fail("sitemap", "найдены private/placeholder URL или отсутствует FAQ");
}

const guide = await checkStatus("/guide?source=site&amount=1000", 200);
if (guide) {
  const body = await guide.text();
  if (body.includes("ROBLOXBANK · ПОКУПКА НА САЙТЕ")) ok("SITE guide marker найден");
  else fail("SITE guide", "ожидаемый marker отсутствует");
  if (/^[a-f0-9]{16}$/.test(guide.headers.get("x-robloxbank-guide-release") || "")) ok("SITE guide содержит source fingerprint");
  else fail("SITE guide", "source fingerprint отсутствует");
}

try {
  const root = await request("/");
  const allowed = EXPECT_PUBLIC ? [200] : EXPECT_MAINTENANCE ? [503] : [200, 503];
  if (allowed.includes(root.status)) ok(`/ → ${root.status} (${root.status === 503 ? "maintenance" : "public"})`);
  else fail("/", `HTTP ${root.status}, допустимо ${allowed.join(" или ")}`);
  if (root.status === 503 && root.headers.get("retry-after")) ok("maintenance возвращает Retry-After");
  if (root.status === 200) {
    const html = await root.text();
    if (html.includes("Robux.") && html.includes("og:image")) ok("главная и OpenGraph metadata присутствуют");
    else fail("root HTML", "не найден hero или og:image");
  }
} catch (error) {
  fail("/", error instanceof Error ? error.message : String(error));
}

console.log(`Итог: ✅ ${passed} / ❌ ${failures.length}`);
if (failures.length) {
  failures.forEach((entry) => console.error(`  • ${entry}`));
  process.exit(1);
}
