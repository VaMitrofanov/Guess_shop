#!/usr/bin/env node
/**
 * Синтетический смоук WB-коридора (docs/corridor-and-site.md, риск №16 в
 * docs/security.md). «Страница 200» ничего не гарантирует: HTML гейта отдаёт
 * Guide-контейнер, JS-чанки идут через префикс /_next-guide, а поломка VK
 * видна только в браузере клиента. Скрипт проверяет всё это с точки зрения
 * клиента:
 *
 *   1. GET /guide?source=wb            → 200 + маркер Guide-контейнера;
 *   2. каждый чанк /_next-guide/...    → 200 (рассинхрон Web/Guide = 404);
 *   3. каждый public/vendor/*.js       → 200 (self-hosted SDK на месте);
 *   4. CSP guide-ответа содержит vk.ru-хосты SDK в connect-src и frame-src;
 *   5. GET /api/wb-code?code=TESTDEV   → 200 (жив Prisma-путь чтения кода);
 *   6. (--reserve) POST /api/wb-code с TEST300 → ok:true (жив резерв; код
 *      останется RESERVED до 60 мин — сброс из TWA Settings → «Тестовые коды»).
 *   7. SITE и WB Guide отдают одинаковый source fingerprint — отдельный
 *      Guide-контейнер не отстал от Web по коду/ассетам.
 *
 * Usage:
 *   node scripts/smoke-corridor.mjs                     # против prod
 *   node scripts/smoke-corridor.mjs --base=http://localhost:3000
 *   node scripts/smoke-corridor.mjs --reserve           # + живой POST-резерв
 *   node scripts/smoke-corridor.mjs --alert             # фейлы → TG-админам
 *
 * Exit code 0 = всё зелёное, 1 = есть фейлы (удобно для cron/CI).
 * Для --alert нужны env TG_TOKEN + ADMIN_IDS (или TG_CHAT_ID).
 */
import { readdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local") });
dotenv.config({ path: resolve(__dirname, "../.env") });

const baseArg = process.argv.find((a) => a.startsWith("--base="));
const BASE = (baseArg ? baseArg.split("=")[1] : "https://robloxbank.ru").replace(/\/$/, "");
const RESERVE = process.argv.includes("--reserve");
const ALERT = process.argv.includes("--alert");
/**
 * U5: лёгкий режим для крона раз в 15 минут — только страница гейта и сверка
 * release-фингерпринтов Web ↔ Guide. Полный смоук тянет ~30 чанков и для
 * постоянного мониторинга избыточен.
 */
const DRIFT_ONLY = process.argv.includes("--drift-only");

/** Хосты, которые vendored VK ID SDK использует в рантайме (риск №16). */
const REQUIRED_VK_HOSTS = ["https://id.vk.ru", "https://oauth.vk.ru", "https://api.vk.ru"];

const failures = [];
const passed = [];

function ok(label) {
  passed.push(label);
  console.log(`  ✅ ${label}`);
}
function fail(label, detail = "") {
  failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
  console.error(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`);
}

async function fetchWithTimeout(url, init = {}, timeoutMs = 20_000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal, redirect: "manual" });
  } finally {
    clearTimeout(t);
  }
}

async function expectStatus(url, expected = 200, label = url) {
  try {
    const res = await fetchWithTimeout(url);
    if (res.status === expected) {
      ok(`${label} → ${res.status}`);
      return res;
    }
    fail(label, `HTTP ${res.status}, ожидали ${expected}`);
  } catch (e) {
    fail(label, e.message);
  }
  return null;
}

console.log(`Смоук коридора против ${BASE}\n`);

// ── 1. Гейт: HTML + маркер Guide-контейнера ────────────────────────────────
console.log("1) Страница гейта");
const gateRes = await expectStatus(`${BASE}/guide?source=wb`, 200, "/guide?source=wb");
let gateHtml = "";
if (gateRes) {
  gateHtml = await gateRes.text();
  if (gateHtml.includes("RobloxBank-Guide")) ok("ответ пришёл из Guide-контейнера (__svc marker)");
  else fail("__svc marker", "HTML без data-served-by=RobloxBank-Guide — отвечает не Guide?");
}

// ── 1.1 Web/Guide source fingerprint ───────────────────────────────────────
console.log("\n1.1) Версия Web ↔ Guide");
try {
  const siteGuideRes = await fetchWithTimeout(`${BASE}/guide?source=site&amount=1000`);
  const webRelease = siteGuideRes.headers.get("x-robloxbank-guide-release");
  const guideRelease = gateRes?.headers.get("x-robloxbank-guide-release");
  if (siteGuideRes.status !== 200) {
    fail("SITE guide version", `HTTP ${siteGuideRes.status}`);
  } else if (!webRelease || !guideRelease) {
    fail("Web/Guide release header", "x-robloxbank-guide-release отсутствует");
  } else if (webRelease !== guideRelease) {
    fail("Web/Guide version", `Web=${webRelease}, Guide=${guideRelease} — нужен последовательный redeploy Guide`);
  } else {
    ok(`Web и Guide на одном source fingerprint ${webRelease}`);
  }
} catch (e) {
  fail("Web/Guide version", e.message);
}

// ── 2. Все чанки гейта (префикс /_next-guide, НЕ голый /_next!) ────────────
if (!DRIFT_ONLY) {
console.log("\n2) JS/CSS-чанки гейта (/_next-guide)");
const chunkSet = new Set(
  [...gateHtml.matchAll(/"(\/_next-guide\/_next\/static\/[^"\\]+)"/g)].map((m) => m[1])
);
if (chunkSet.size === 0 && gateHtml) fail("чанки", "в HTML не найдено ни одного /_next-guide-ассета");
// Заодно копим тела чанков: ниже по ним проверяется, что бандл VK ID реально
// попал в сборку гейта (он подключается ленивым import, поэтому в HTML его нет).
let chunkBodies = "";
for (const chunk of chunkSet) {
  const res = await expectStatus(`${BASE}${chunk}`, 200, chunk);
  if (res && chunk.endsWith(".js")) chunkBodies += await res.text().catch(() => "");
}

// ── 3. Self-hosted vendor SDK ──────────────────────────────────────────────
//
// U15: раньше цикл шёл по всему `public/vendor` и рапортовал ✅ на
// `vkid-sdk-2.6.5.js`, который приложение не подключает (VKAuthButton
// импортирует npm-пакет @vkid/sdk). Ложный зелёный. Теперь проверяем только
// реально используемые файлы + присутствие бандла VK ID в статике Guide.
console.log("\n3) Vendored SDK (public/vendor)");
const USED_VENDOR_FILES = ["telegram-web-app.js"];
const vendorFiles = readdirSync(resolve(__dirname, "../public/vendor")).filter((f) => f.endsWith(".js"));
for (const f of USED_VENDOR_FILES) {
  if (!vendorFiles.includes(f)) fail(`/vendor/${f}`, "файл пропал из public/vendor");
  else await expectStatus(`${BASE}/vendor/${f}`, 200, `/vendor/${f}`);
}
const unusedVendor = vendorFiles.filter((f) => !USED_VENDOR_FILES.includes(f));
if (unusedVendor.length > 0) {
  fail("public/vendor", `неиспользуемые файлы: ${unusedVendor.join(", ")} — удалить или подключить`);
} else {
  ok("в public/vendor нет неиспользуемых файлов");
}

// VK ID SDK приезжает из npm и подключается ленивым import — в HTML его нет,
// он лежит внутри чанков гейта. Проверяем именно их: если бандл выпадет из
// сборки, VK-вход на гейте сломается так же тихо, как в инциденте 14.07.
if (/vk\.ru|VKIDSDK|@vkid/.test(chunkBodies)) {
  ok("бандл VK ID присутствует в чанках гейта");
} else {
  fail("VK ID в сборке гейта", "ни в одном чанке гейта не найдено следов VK ID SDK");
}

// Присутствия бандла мало: 28.07 в проде оказался ЧУЖОЙ `NEXT_PUBLIC_VK_APP_ID`
// (`51912345` вместо `54539012`). Бандл был на месте, CSP в порядке, смоук
// зелёный — а `id.vk.ru` встречал каждого «Ошибкой загрузки». Переменная
// build-time, поэтому неверное значение запекается в сборку и живёт до
// пересборки. Сверяем то, что реально уехало в прод.
const EXPECTED_VK_APP_ID = process.env.EXPECTED_VK_APP_ID ?? "54539012";
// Границы обязательны: простой `includes` даёт ложный зелёный, потому что любая
// последовательность цифр находится внутри чужих чисел (проверено: «99999999»
// совпадает с float-литералами вида `1.0000000000001` из framer-motion).
// Сборщик сворачивает `Number(process.env.X ?? "…")` в `Number("<id>")`,
// поэтому в бандле остаётся ровно одно вхождение — то, что уехало в прод.
const bounded = (id) => new RegExp(`(?<!\\d)${id}(?!\\d)`).test(chunkBodies);
if (bounded(EXPECTED_VK_APP_ID)) {
  ok(`VK app id в сборке гейта — ожидаемый ${EXPECTED_VK_APP_ID}`);
} else {
  const found = [...new Set(
    [...chunkBodies.matchAll(/Number\("(\d{6,12})"\)/g)].map((m) => m[1]),
  )];
  fail(
    "VK app id в сборке гейта",
    `ожидали ${EXPECTED_VK_APP_ID}, в сборке: ${found.join(", ") || "не найден"}. ` +
    "Проверь NEXT_PUBLIC_VK_APP_ID на Web И Guide и пересобери — переменная build-time",
  );
}
}

// ── 4. CSP гейта покрывает vk.ru-хосты SDK ─────────────────────────────────
console.log("\n4) CSP гейта (vk.ru-хосты VK ID SDK)");
if (gateRes) {
  const csp = gateRes.headers.get("content-security-policy") ?? "";
  const directive = (name) => (csp.split(";").find((p) => p.trim().startsWith(name)) ?? "");
  for (const host of REQUIRED_VK_HOSTS) {
    if (directive("connect-src").includes(host)) ok(`connect-src содержит ${host}`);
    else fail(`connect-src ${host}`, "VK-логин будет заблокирован браузером (риск №16)");
  }
  for (const host of ["https://id.vk.ru", "https://oauth.vk.ru"]) {
    if (directive("frame-src").includes(host)) ok(`frame-src содержит ${host}`);
    else fail(`frame-src ${host}`, "VK-виджет не сможет открыть iframe (риск №16)");
  }
}

// ── 5. API коридора: чтение кода ───────────────────────────────────────────
if (!DRIFT_ONLY) {
console.log("\n5) API коридора");
try {
  const res = await fetchWithTimeout(`${BASE}/api/wb-code?code=TESTDEV`);
  const body = await res.json().catch(() => null);
  if (res.status === 200 && body && typeof body.claimed === "boolean") {
    ok(`/api/wb-code?code=TESTDEV → 200 (claimed=${body.claimed})`);
  } else {
    fail("/api/wb-code GET", `HTTP ${res.status} / body ${JSON.stringify(body)}`);
  }
} catch (e) {
  fail("/api/wb-code GET", e.message);
}
}

// ── 6. Опциональный живой резерв (пишет в прод-БД тест-кодом) ──────────────
if (RESERVE) {
  console.log("\n6) POST-резерв TEST300 (--reserve)");
  try {
    const res = await fetchWithTimeout(`${BASE}/api/wb-code`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "TEST300", sessionId: `smoke-${Date.now()}` }),
    });
    const body = await res.json().catch(() => null);
    if (res.status === 200 && body?.ok) ok(`резерв TEST300 → ok (номинал ${body.denomination})`);
    else fail("POST /api/wb-code TEST300", `HTTP ${res.status} / ${JSON.stringify(body)}`);
  } catch (e) {
    fail("POST /api/wb-code TEST300", e.message);
  }
}

// ── Итог + опциональный TG-алерт ───────────────────────────────────────────
console.log(`\nИтог: ✅ ${passed.length} / ❌ ${failures.length}`);

if (failures.length > 0 && ALERT) {
  const token = process.env.TG_TOKEN;
  const chatIds = (process.env.ADMIN_IDS ?? process.env.TG_CHAT_ID ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  if (token && chatIds.length > 0) {
    const text =
      `🚨 Смоук WB-коридора: ${failures.length} фейл(ов) на ${BASE}\n\n` +
      failures.slice(0, 15).map((f) => `• ${f}`).join("\n") +
      (failures.length > 15 ? `\n… и ещё ${failures.length - 15}` : "");
    for (const chatId of chatIds) {
      await fetchWithTimeout(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text }),
      }).catch((e) => console.error(`TG alert to ${chatId} failed: ${e.message}`));
    }
    console.log("Алерт отправлен TG-админам.");
  } else {
    console.error("--alert: нет TG_TOKEN / ADMIN_IDS в env — алерт пропущен.");
  }
}

process.exit(failures.length > 0 ? 1 : 0);
