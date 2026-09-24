#!/usr/bin/env node
/** Read-only: inspect WB codes + their users/orders for review-bonus crediting. */
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
const codes = process.argv.slice(2).map((c) => c.trim().toUpperCase());
if (codes.length === 0) { console.error("pass codes as args"); process.exit(1); }

async function main() {
  for (const code of codes) {
    console.log(`\n══════════ CODE: ${code} ══════════`);
    const { rows: cr } = await pool.query(
      `SELECT * FROM "WbCode" WHERE UPPER(code) = $1`, [code]
    );
    if (cr.length === 0) { console.log("  ❌ WbCode not found"); continue; }
    const c = cr[0];
    console.log("  WbCode:", {
      code: c.code, denomination: c.denomination, status: c.status,
      isUsed: c.isUsed, userId: c.userId, reviewBonusClaimed: c.reviewBonusClaimed,
    });

    if (c.userId) {
      const { rows: ur } = await pool.query(`SELECT * FROM "User" WHERE id = $1`, [c.userId]);
      const u = ur[0];
      console.log("  User:", u ? {
        id: u.id, tgId: u.tgId, vkId: u.vkId, name: u.name, username: u.username,
        balance: u.balance, reviewBonusGrantedAt: u.reviewBonusGrantedAt,
        reviewReminderLevel: u.reviewReminderLevel,
      } : "NOT FOUND");
    }

    const { rows: or } = await pool.query(
      `SELECT id, status, amount, platform, "wbCode", "gamepassUrl", "createdAt", "updatedAt"
       FROM "WbOrder" WHERE "wbCode" = $1 ORDER BY "createdAt" DESC`, [c.code]
    );
    console.log(`  Orders for code (${or.length}):`);
    for (const o of or) {
      console.log("   •", { id: o.id, short: o.id.slice(-6).toUpperCase(), status: o.status,
        amount: o.amount, platform: o.platform, updatedAt: o.updatedAt });
    }
  }
  await pool.end();
}
main().catch((e) => { console.error(e); pool.end().finally(() => process.exit(1)); });
