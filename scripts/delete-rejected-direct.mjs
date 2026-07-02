#!/usr/bin/env node
/**
 * Delete a REJECTED direct order for a user identified by their WB code.
 * Usage: node scripts/delete-rejected-direct.mjs UTIWINA [--dry-run]
 */
import pg from "pg";
import dotenv from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local") });
dotenv.config({ path: resolve(__dirname, "../.env") });

const { DATABASE_URL } = process.env;
if (!DATABASE_URL) throw new Error("DATABASE_URL required");

const pool = new pg.Pool({ connectionString: DATABASE_URL });
const code = (process.argv[2] || "").trim().toUpperCase();
const dryRun = process.argv.includes("--dry-run");

if (!code) { console.error("Usage: node scripts/delete-rejected-direct.mjs <CODE> [--dry-run]"); process.exit(1); }

async function main() {
  // 1. Find the WB code → userId
  const { rows: codeRows } = await pool.query(
    `SELECT * FROM "WbCode" WHERE UPPER(code) = $1`, [code]
  );
  if (codeRows.length === 0) { console.error(`❌ WbCode "${code}" not found`); process.exit(1); }
  const wbCode = codeRows[0];
  console.log(`✅ WbCode: ${wbCode.code} (${wbCode.denomination} R$), userId=${wbCode.userId}`);

  if (!wbCode.userId) { console.error("❌ No userId on code"); process.exit(1); }

  // 2. Find ALL orders for this user
  const { rows: orders } = await pool.query(
    `SELECT id, amount, status, "isDirectOrder", "wbCode", "createdAt", "robloxUsername"
     FROM "WbOrder" WHERE "userId" = $1 ORDER BY "createdAt" DESC`,
    [wbCode.userId]
  );
  console.log(`\n📦 Orders for user (${orders.length} total):`);
  for (const o of orders) {
    const marker = o.isDirectOrder && o.status === "REJECTED" ? " ← TO DELETE" : "";
    console.log(`  ${o.id.slice(-8)} | ${o.amount}R$ | ${o.status} | direct=${o.isDirectOrder} | wb=${o.wbCode} | nick=${o.robloxUsername || "-"}${marker}`);
  }

  // 3. Find rejected direct orders
  const toDelete = orders.filter(o => o.isDirectOrder && o.status === "REJECTED");
  if (toDelete.length === 0) {
    console.log("\n✅ No REJECTED direct orders to delete.");
    process.exit(0);
  }

  console.log(`\n🗑  Will delete ${toDelete.length} REJECTED direct order(s):`);
  for (const o of toDelete) {
    console.log(`  → ${o.id} (${o.amount}R$, created ${o.createdAt})`);
  }

  if (dryRun) {
    console.log("\n🔍 DRY RUN — no changes made.");
    process.exit(0);
  }

  // 4. Delete
  for (const o of toDelete) {
    await pool.query(`DELETE FROM "WbOrder" WHERE id = $1`, [o.id]);
    console.log(`  ✅ Deleted ${o.id}`);
  }

  // 5. Verify remaining
  const { rows: remaining } = await pool.query(
    `SELECT id, amount, status, "isDirectOrder", "wbCode" FROM "WbOrder" WHERE "userId" = $1 ORDER BY "createdAt" DESC`,
    [wbCode.userId]
  );
  console.log(`\n📦 Remaining orders (${remaining.length}):`);
  for (const o of remaining) {
    console.log(`  ${o.id.slice(-8)} | ${o.amount}R$ | ${o.status} | direct=${o.isDirectOrder} | wb=${o.wbCode}`);
  }
}

main().catch(console.error).finally(() => pool.end());
