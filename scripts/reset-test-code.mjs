/**
 * Upserts a permanent test WB code TESTDEV into the database and resets it to
 * AVAILABLE so it can be reused repeatedly during local development.
 *
 * Usage:
 *   node scripts/reset-test-code.mjs
 *   # or
 *   npm run dev:reset-test
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pkg from "pg";
import dotenv from "dotenv";

const { Pool } = pkg;
dotenv.config({ path: ".env.local" });
dotenv.config(); // fallback to .env

// Permanent test codes. All carry isTest=true so they never leak into stats.
// ⚠️ Keep in sync with src/lib/test-codes.ts (the admin/TWA source of truth).
const TEST_CODES = [
  { code: "TESTDEV", denomination: 500 },
  { code: "TEST300", denomination: 300 },
  { code: "TEST500", denomination: 500 },
  { code: "TEST700", denomination: 700 },
  { code: "TEST800", denomination: 800 },
  { code: "TST1000", denomination: 1000 },
  { code: "TST2000", denomination: 2000 },
  { code: "TST3000", denomination: 3000 },
  { code: "TST5000", denomination: 5000 },
];

const pool    = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma  = new PrismaClient({ adapter });

async function main() {
  const codes = TEST_CODES.map((c) => c.code);

  // Drop any leftover orders for the test codes so a fresh activation isn't
  // blocked by the unique wbCode constraint (and so the new site-materialised
  // flow starts from a clean AWAITING_GAMEPASS each time).
  const del = await prisma.wbOrder.deleteMany({ where: { wbCode: { in: codes } } });
  if (del.count > 0) console.log(`🧹 Removed ${del.count} leftover test order(s)`);

  for (const { code, denomination } of TEST_CODES) {
    const result = await prisma.wbCode.upsert({
      where:  { code },
      update: {
        status:             "AVAILABLE",
        isUsed:             false,
        isTest:             true,
        userId:             null,
        sessionId:          null,
        reservedUntil:      null,
        usedAt:             null,
        // New site-handoff fields — clear so the bot doesn't offer a stale pick.
        selectedGamepassId: null,
        robloxNick:         null,
        reviewBonusClaimed: false,
      },
      create: {
        code,
        denomination,
        status: "AVAILABLE",
        isTest: true,
      },
    });
    console.log(`✅ Test code ready: ${result.code}  (${result.denomination} R$, status=${result.status})`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });
