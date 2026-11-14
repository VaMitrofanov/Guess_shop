#!/usr/bin/env node
/**
 * Ops-скрипт: создать покупаемый геймпасс через Open Cloud (Part 1, ДОРМАНТ).
 *
 * Запускать ТАМ, где Roblox доступен (SG-хост) — с RF `apis.roblox.com` висит.
 * Это ручной инструмент для боевого прогона, НЕ часть клиентского флоу.
 *
 * Использование:
 *   RBX_API_KEY=<ключ> node scripts/roblox/create-gamepass.mjs --price 228 --nick mono262910
 *   node scripts/roblox/create-gamepass.mjs --key <ключ> --price 228 --universe 10302269431
 *   ... --place <placeId>   (резолвится в universe)
 *   ... --name "Pass 228"   (по умолчанию нейтральное имя по номиналу)
 *
 * Ключ можно передать через RBX_API_KEY (предпочтительно — не осядет в history)
 * или флагом --key. Скрипт ключ НЕ печатает.
 *
 * Ключ клиента должен быть выпущен на API System `game-passes` с операциями
 * `game-pass:read` + `game-pass:write` (проверено 06.09.2026 на двух аккаунтах).
 * `legacy-game-passes → manage` не подходит: 403 «Scope not authorized» на всё.
 *
 * Факты API — см. память project_roblox_opencloud_gamepass_api и
 * docs/roblox-gamepass-autocreate.md.
 */

const BASE = "https://apis.roblox.com/game-passes/v1/universes";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

// Имя пасса = реклама RobloxBank (см. bots/shared/roblox.ts BRAND_GAMEPASS_NAMES).
const BRAND_NAMES = [
  "RobloxBank",
  "RobloxBank лучший",
  "RobloxBank любимый",
  "RobloxBank топ",
  "RobloxBank №1 по робуксам",
  "RobloxBank лучший магазин робуксов",
  "Робуксы тут — RobloxBank",
  "RobloxBank рекомендую",
];

function safeName(_price, override) {
  const raw = (override ?? "").trim();
  if (raw && /^[A-Za-z0-9 ]{3,40}$/.test(raw)) return raw;
  return BRAND_NAMES[Math.floor(Math.random() * BRAND_NAMES.length)];
}

async function resolveUserId(username) {
  const res = await fetch("https://users.roblox.com/v1/usernames/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usernames: [username], excludeBannedUsers: true }),
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  return data?.data?.[0]?.id ?? null;
}

async function placeToUniverse(placeId) {
  const res = await fetch(`https://apis.roblox.com/universes/v1/places/${placeId}/universe`);
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  return data?.universeId != null ? String(data.universeId) : null;
}

async function userUniverses(userId) {
  const res = await fetch(`https://games.roblox.com/v2/users/${userId}/games?accessFilter=Public&limit=50`);
  if (!res.ok) return [];
  const data = await res.json().catch(() => null);
  return (data?.data ?? []).map((g) => String(g.id)).filter(Boolean);
}

async function createOnUniverse(apiKey, universeId, name, price) {
  const form = new FormData();
  form.append("request.Name", name);
  form.append("request.Description", "");
  form.append("request.Price", String(price));
  form.append("request.IsForSale", "true");
  const res = await fetch(`${BASE}/${universeId}/game-passes`, {
    method: "POST",
    headers: { "x-api-key": apiKey },
    body: form,
  });
  const text = await res.text().catch(() => "");
  if (res.status === 401) return { ok: false, error: "bad_key", universeId, detail: "ключ не принят Roblox (протух — JWT живёт час — или скопирован не целиком)" };
  if (res.status === 403) {
    // «Scope not authorized» = ключ не на том API System (нужен game-passes с
    // game-pass:read+write, а не legacy-game-passes). Перебор опытов не поможет.
    if (/scope not authorized/i.test(text)) {
      return { ok: false, error: "bad_scope", universeId, detail: "нужен API System game-passes (read+write)" };
    }
    return { ok: false, error: "not_authorized", universeId };
  }
  if (!res.ok) return { ok: false, error: `http_${res.status}`, universeId, detail: text.slice(0, 300) };
  let body = null;
  try { body = JSON.parse(text); } catch { /* ignore */ }
  return {
    ok: true,
    universeId,
    gamePassId: body?.gamePassId,
    isForSale: body?.isForSale,
    priceInRobux: body?.priceInformation?.defaultPriceInRobux,
    name: body?.name,
  };
}

async function main() {
  const apiKey = (process.env.RBX_API_KEY ?? arg("key") ?? "").trim();
  const price = Number(arg("price"));
  const nick = arg("nick");
  const universeArg = arg("universe");
  const placeArg = arg("place");

  if (!apiKey) { console.error("нет ключа: задай RBX_API_KEY или --key"); process.exit(2); }
  if (!Number.isInteger(price) || price < 1) { console.error("нужна --price (целое ≥1)"); process.exit(2); }

  const name = safeName(price, arg("name"));

  const candidates = [];
  if (universeArg) candidates.push(String(universeArg));
  if (placeArg) { const u = await placeToUniverse(placeArg); if (u) candidates.push(u); }
  if (nick) {
    const userId = await resolveUserId(nick.trim());
    if (userId != null) candidates.push(...(await userUniverses(userId)));
  }
  const unique = [...new Set(candidates)];
  if (unique.length === 0) { console.error("не определён experience: дай --universe / --place / --nick (публичный опыт)"); process.exit(1); }

  console.log(`Создаю пасс "${name}" за ${price} R$; кандидаты-universe: ${unique.join(", ")}`);
  let last = null;
  for (const universeId of unique) {
    const r = await createOnUniverse(apiKey, universeId, name, price);
    if (r.ok) {
      console.log(`✅ создан: gamePassId=${r.gamePassId} universe=${r.universeId} price=${r.priceInRobux} forSale=${r.isForSale} name="${r.name}"`);
      process.exit(0);
    }
    last = r;
    if (r.error !== "not_authorized") break;
    console.log(`  universe ${universeId}: ключ не авторизован — пробую следующий`);
  }
  console.error(`❌ не удалось: ${last?.error ?? "unknown"}${last?.detail ? " — " + last.detail : ""}`);
  process.exit(1);
}

main().catch((e) => { console.error("ошибка:", e?.message ?? e); process.exit(1); });
