#!/usr/bin/env node
// Только чтение: баланс, сток по курсам. Ничего не создаёт.
// Запуск: RBXRUBY_API_KEY=... node scripts/rbxruby-probe.mjs   (или ключ из .env)
import { readFileSync } from "node:fs";
let key = process.env.RBXRUBY_API_KEY;
if (!key) try { key = readFileSync(".env", "utf8").match(/^RBXRUBY_API_KEY=(.+)$/m)?.[1]?.trim(); } catch {}
if (!key) { console.error("нет RBXRUBY_API_KEY"); process.exit(1); }
for (const p of ["shared/balance", "orders/stock", "orders/detailed-stock"]) {
  const r = await fetch(`https://rbxruby.io/api/${p}`, { headers: { "api-key": key } });
  console.log(p, r.status, await r.text());
}
