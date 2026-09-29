#!/usr/bin/env node
/**
 * Backfill probable Roblox nicks for orders in the TWA «Ждут ссылку» tab
 * (AWAITING_GAMEPASS, older than 40h, not favorite, no robloxUsername).
 *
 * The early-nick capture (bots/shared/nick.ts) only works from 2026-07-04 —
 * older orders never got their `[НИК? …]` note. This script reconstructs the
 * probable nick from what we already have:
 *   1. vk-gp   — gamepass links the user sent in the VK dialog → creator name
 *                (strongest: the user literally made that gamepass);
 *   2. user    — User.robloxUsername confirmed on a previous order;
 *   3. site    — WbCode.robloxNick (nick searched on the website, step 7);
 *   4. orders  — robloxUsername from the user's other orders;
 *   5. vk-msg  — nick-shaped tokens from the VK dialog, validated against
 *                the Roblox users API.
 *
 * TG dialogs are NOT readable retroactively (Bot API has no history method) —
 * TG-only orders are covered by sources 2-4 only.
 *
 * Writes follow the noteProbableNick convention: `[НИК? дата] ник (источник)`
 * appended to WbOrder.adminNote, NEVER to robloxUsername (owner's policy).
 * Only the single best candidate per order is written; the rest go to the report.
 *
 * Usage: node scripts/backfill-probable-nicks.mjs [--apply] [--limit=N]
 *        (dry-run by default — prints the report, writes nothing)
 */
import pg from "pg";
import dotenv from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local") });
dotenv.config({ path: resolve(__dirname, "../.env") });

const APPLY = process.argv.includes("--apply");
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? parseInt(limitArg.split("=")[1], 10) : 0;

const { DATABASE_URL, VK_TOKEN } = process.env;
if (!DATABASE_URL) throw new Error("DATABASE_URL required");
if (!VK_TOKEN) console.warn("⚠️  VK_TOKEN not set — VK dialog sources disabled");

const pool = new pg.Pool({ connectionString: DATABASE_URL });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const NICK_RE = /^[A-Za-z0-9_]{3,20}$/;
const HAS_LETTER = /[A-Za-z]/;
// Latin tokens users commonly type that are not their nick. Roblox validation
// filters non-existent users; this list only trims obvious API noise.
const STOPWORDS = new Set([
  "roblox", "robux", "robuxs", "gamepass", "game", "pass", "passes", "wildberries",
  "https", "http", "com", "www", "vk", "org", "ru", "net", "user", "users",
  "ok", "okey", "okay", "da", "net", "yes", "no", "hello", "hi", "hey", "thanks",
  "spasibo", "privet", "poka", "kod", "code", "nik", "nick", "nickname", "login",
  "catalog", "library", "sharing", "share", "android", "iphone", "ios", "screenshot",
]);

// ── Roblox helpers ───────────────────────────────────────────────────────────

/** Batch-validate usernames → Map<lowercased, canonicalName>. */
async function validateNicks(nicks) {
  const valid = new Map();
  const list = [...new Set(nicks.map((n) => n.toLowerCase()))];
  for (let i = 0; i < list.length; i += 100) {
    const batch = list.slice(i, i + 100);
    try {
      const res = await fetch("https://users.roblox.com/v1/usernames/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usernames: batch, excludeBannedUsers: true }),
      });
      if (!res.ok) { console.warn(`[roblox] usernames/users HTTP ${res.status}`); continue; }
      const data = await res.json();
      for (const u of data?.data ?? []) {
        valid.set(String(u.requestedUsername).toLowerCase(), u.name);
      }
    } catch (e) {
      console.warn("[roblox] usernames/users failed:", e.message);
    }
    await sleep(400);
  }
  return valid;
}

/** Gamepass id → creator name (product-info, roproxy fallback). */
const gpCreatorCache = new Map();
async function gamepassCreator(gpId) {
  if (gpCreatorCache.has(gpId)) return gpCreatorCache.get(gpId);
  let name = null;
  for (const host of ["apis.roblox.com", "apis.roproxy.com"]) {
    try {
      const res = await fetch(`https://${host}/game-passes/v1/game-passes/${gpId}/product-info`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) continue;
      const d = await res.json();
      name = d?.Creator?.Name ?? d?.creatorName ?? null;
      if (name) break;
    } catch { /* next host */ }
  }
  gpCreatorCache.set(gpId, name);
  await sleep(500);
  return name;
}

// ── VK dialog scan ───────────────────────────────────────────────────────────

/** All messages from the user in the group dialog (up to 600, newest first). */
async function vkUserMessages(vkId) {
  if (!VK_TOKEN) return [];
  const out = [];
  for (let offset = 0; offset < 600; offset += 200) {
    const params = new URLSearchParams({
      access_token: VK_TOKEN, v: "5.199",
      peer_id: String(vkId), count: "200", offset: String(offset),
    });
    try {
      const res = await fetch(`https://api.vk.com/method/messages.getHistory?${params}`);
      const json = await res.json();
      if (json.error) {
        if (offset === 0) console.warn(`[vk] getHistory ${vkId}: ${json.error.error_msg}`);
        break;
      }
      const items = json.response?.items ?? [];
      for (const m of items) {
        if (m.from_id === vkId && m.text) out.push(m.text);
      }
      if (items.length < 200) break;
    } catch (e) {
      console.warn(`[vk] getHistory ${vkId} failed:`, e.message);
      break;
    }
    await sleep(350);
  }
  return out;
}

function extractCandidates(texts, wbCode) {
  const gpIds = new Set();
  const tokens = new Map(); // lower → { raw, count }
  for (const text of texts) {
    for (const m of text.matchAll(/game-pass\/(\d+)/g)) gpIds.add(m[1]);
    for (const raw of text.split(/[^A-Za-z0-9_]+/)) {
      if (!NICK_RE.test(raw) || !HAS_LETTER.test(raw)) continue;
      const lower = raw.toLowerCase();
      if (STOPWORDS.has(lower) || lower === wbCode.toLowerCase()) continue;
      const cur = tokens.get(lower) ?? { raw, count: 0 };
      cur.count++;
      tokens.set(lower, cur);
    }
  }
  return { gpIds: [...gpIds], tokens };
}

// ── Write (mirrors bots/shared/nick.ts) ─────────────────────────────────────

async function writeNote(order, nick, source) {
  const note = order.adminNote ?? "";
  if (note.toLowerCase().includes(nick.toLowerCase())) return "уже в заметке";
  const stamp = new Date().toISOString().slice(0, 10);
  const prefix = note ? `${note}\n` : "";
  const next = `${prefix}[НИК? ${stamp}] ${nick} (${source})`.slice(0, 2000);
  if (APPLY) {
    await pool.query(`UPDATE "WbOrder" SET "adminNote" = $1, "updatedAt" = NOW() WHERE id = $2`, [next, order.id]);
    return "✍️ записан";
  }
  return "был бы записан (dry-run)";
}

// ── Main ─────────────────────────────────────────────────────────────────────

const { rows: orders } = await pool.query(`
  SELECT o.id, o."wbCode", o.amount, o."createdAt", o."adminNote", o.platform,
         u.id AS "userId", u."vkId", u."tgId", u."robloxUsername" AS "userNick"
  FROM "WbOrder" o JOIN "User" u ON u.id = o."userId"
  WHERE o.status = 'AWAITING_GAMEPASS' AND o."isTest" = false AND o."isFavorite" = false
    AND o."createdAt" <= NOW() - INTERVAL '40 hours'
    AND o."robloxUsername" IS NULL
  ORDER BY o."createdAt" DESC
  ${LIMIT ? `LIMIT ${LIMIT}` : ""}
`);
console.log(`«Ждут ссылку» без ника: ${orders.length} заказов${APPLY ? " — APPLY" : " — DRY-RUN"}\n`);

const report = [];
for (const o of orders) {
  const expectedPrice = Math.ceil(o.amount / 0.7);
  const candidates = []; // { nick, source, prio, note? }

  // 2. Confirmed nick on the user record (from another order).
  if (o.userNick) candidates.push({ nick: o.userNick, source: "backfill-user", prio: 2 });

  // 3. Nick searched on the website for this code.
  const { rows: wc } = await pool.query(
    `SELECT "robloxNick" FROM "WbCode" WHERE UPPER(code) = UPPER($1) AND "robloxNick" IS NOT NULL`, [o.wbCode]);
  if (wc[0]?.robloxNick) candidates.push({ nick: wc[0].robloxNick, source: "backfill-site", prio: 3 });

  // 4. robloxUsername from the user's other orders.
  const { rows: others } = await pool.query(
    `SELECT DISTINCT "robloxUsername" FROM "WbOrder"
     WHERE "userId" = $1 AND id != $2 AND "robloxUsername" IS NOT NULL`, [o.userId, o.id]);
  for (const r of others) candidates.push({ nick: r.robloxUsername, source: "backfill-orders", prio: 4 });

  // 1+5. VK dialog: gamepass links (→ creator) and nick-shaped tokens.
  let vkTokens = new Map();
  if (o.vkId && VK_TOKEN) {
    const texts = await vkUserMessages(Number(o.vkId));
    const { gpIds, tokens } = extractCandidates(texts, o.wbCode);
    vkTokens = tokens;
    for (const gpId of gpIds.slice(0, 5)) {
      const creator = await gamepassCreator(gpId);
      if (creator) candidates.push({ nick: creator, source: "backfill-vk-gp", prio: 1, note: `gp ${gpId}` });
    }
  }

  // Validate everything in one batch: explicit candidates + dialog tokens.
  const validated = await validateNicks([
    ...candidates.map((c) => c.nick),
    ...[...vkTokens.values()].map((t) => t.raw),
  ]);

  const seen = new Set();
  const final = [];
  for (const c of candidates.sort((a, b) => a.prio - b.prio)) {
    const canon = validated.get(c.nick.toLowerCase());
    if (!canon || seen.has(canon.toLowerCase())) continue;
    seen.add(canon.toLowerCase());
    final.push({ ...c, nick: canon });
  }
  // Dialog tokens (weakest) — only validated ones, most-mentioned first.
  for (const [lower, t] of [...vkTokens.entries()].sort((a, b) => b[1].count - a[1].count)) {
    const canon = validated.get(lower);
    if (!canon || seen.has(canon.toLowerCase())) continue;
    seen.add(canon.toLowerCase());
    final.push({ nick: canon, source: "backfill-vk-msg", prio: 5, note: `${t.count}×` });
  }

  const best = final[0];
  let action = "— кандидатов нет";
  if (best) action = await writeNote(o, best.nick, best.source);

  report.push({
    код: o.wbCode,
    "R$": o.amount,
    "цена ГП": expectedPrice,
    платформа: o.platform + (o.vkId ? "/vk✓" : ""),
    ник: best?.nick ?? "—",
    источник: best ? `${best.source}${best.note ? ` (${best.note})` : ""}` : "—",
    ещё: final.slice(1).map((c) => `${c.nick}[${c.source.replace("backfill-", "")}]`).join(", ") || "—",
    действие: action,
  });
}

console.table(report);
const found = report.filter((r) => r.ник !== "—").length;
console.log(`\nИтог: ник найден у ${found}/${orders.length}${APPLY ? ", записан в adminNote" : " (dry-run, ничего не записано)"}`);
await pool.end();
