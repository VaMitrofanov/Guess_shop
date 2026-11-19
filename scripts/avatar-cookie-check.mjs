#!/usr/bin/env node
/* 🧊 Проверка служебной cookie Roblox для 3D-персонажа (19.11.2026).

   ROBLOX_AVATAR_COOKIE='…' node scripts/avatar-cookie-check.mjs [robloxUserId]

   1. Чья сессия (users/authenticated) — убедиться, что это ПУСТОЙ служебный
      аккаунт, а не донор и не личный.
   2. avatar-3d для игрока → манифест → obj/mtl/первая текстура: адреса, статус
      CDN и CORS (браузер покупателя грузит их сам).
   Cookie в вывод не попадает. */

const raw = (process.env.ROBLOX_AVATAR_COOKIE ?? "").trim();
const cookie = raw.replace(/^\.ROBLOSECURITY=/, "").replace(/;.*$/, "").trim();
if (cookie.length < 50) {
  console.error("нет ROBLOX_AVATAR_COOKIE");
  process.exit(1);
}
const userId = process.argv[2] ?? "3828548511";
const headers = { accept: "application/json", cookie: `.ROBLOSECURITY=${cookie}` };

function cdnUrl(hash) {
  if (/^https:\/\//.test(hash)) return hash;
  let i = 31;
  for (let t = 0; t < hash.length; t++) i ^= hash.charCodeAt(t);
  return `https://t${i % 8}.rbxcdn.com/${hash}`;
}

async function probe(label, url) {
  const res = await fetch(url, { headers: { origin: "https://example.com" } });
  const body = await res.arrayBuffer();
  console.log(`${label}: ${res.status} · ${body.byteLength} байт · CORS=${res.headers.get("access-control-allow-origin") ?? "нет"} · ${url}`);
  return { res, body };
}

const me = await fetch("https://users.roblox.com/v1/users/authenticated", { headers });
if (!me.ok) {
  console.error(`сессия НЕ жива: users/authenticated → ${me.status}`);
  process.exit(2);
}
const who = await me.json();
console.log(`сессия жива: ${who.name} (id ${who.id})`);

for (let attempt = 0; attempt < 5; attempt++) {
  const res = await fetch(`https://thumbnails.roblox.com/v1/users/avatar-3d?userId=${userId}`, { headers });
  const body = await res.json().catch(() => null);
  console.log(`avatar-3d: ${res.status} state=${body?.state ?? "?"}`);
  if (body?.state === "Pending") { await new Promise((r) => setTimeout(r, 3000)); continue; }
  if (body?.state !== "Completed" || !body.imageUrl) process.exit(3);
  const { body: m } = await probe("манифест", body.imageUrl);
  const manifest = JSON.parse(Buffer.from(m).toString("utf8"));
  console.log("ключи манифеста:", Object.keys(manifest).join(", "), "· текстур:", manifest.textures?.length ?? 0);
  console.log("пример хешей:", manifest.obj, manifest.mtl);
  await probe("obj", cdnUrl(manifest.obj));
  const { body: mtl } = await probe("mtl", cdnUrl(manifest.mtl));
  console.log("mtl ссылается на:", [...Buffer.from(mtl).toString("utf8").matchAll(/map_\w+\s+(\S+)/g)].map((x) => x[1]).slice(0, 3).join(", "));
  if (manifest.textures?.[0]) await probe("текстура", cdnUrl(manifest.textures[0]));
  process.exit(0);
}
process.exit(4);
