/**
 * Clears WbCode + Order, then re-imports codes from a column-based CSV.
 *
 * CSV format  ("Новая таблица - Лист1.csv"):
 *   Row 0  — header : 300,500,800,800,800,1000,1000,1200,1200,2000
 *             Each numeric cell = denomination for that column.
 *             Duplicate headers are both collected (800 appears 3×, etc.)
 *   Row 1+ — data   : 7-char codes; empty cells are skipped.
 *
 * Usage:
 *   npx tsx scripts/refresh-database.ts "/Users/.../Новая таблица - Лист1.csv"
 */

import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

// ─── Types ────────────────────────────────────────────────────────────────────

type CodeEntry = { code: string; denomination: number };

// ─── CSV parser ───────────────────────────────────────────────────────────────

function parseCSV(filePath: string): CodeEntry[] {
  const raw = fs.readFileSync(filePath, "utf-8");

  const lines = raw
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n");

  if (lines.length < 2) return [];

  // Row 0: identify every column whose header is a positive integer (denomination)
  const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));

  const activeCols: { index: number; denomination: number }[] = [];
  for (let i = 0; i < headers.length; i++) {
    const n = Number(headers[i]);
    if (Number.isInteger(n) && n > 0) {
      activeCols.push({ index: i, denomination: n });
    }
  }

  if (activeCols.length === 0) {
    throw new Error(
      `Header row has no numeric denomination columns.\n  Got: "${lines[0]}"`
    );
  }

  const entries: CodeEntry[] = [];

  for (let rowIdx = 1; rowIdx < lines.length; rowIdx++) {
    const line = lines[rowIdx];
    if (!line.trim()) continue;

    const cells = line.split(",");
    for (const col of activeCols) {
      const cell = (cells[col.index] ?? "").trim().replace(/^"|"$/g, "");
      if (cell) {
        entries.push({ code: cell, denomination: col.denomination });
      }
    }
  }

  return entries;
}

// ─── Prisma client (matches src/lib/prisma.ts pattern) ────────────────────────

function createDb(): { client: PrismaClient; pool: Pool } {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set. Check .env or .env.local.");
  }
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 15_000,
  });
  const adapter = new PrismaPg(pool);
  const client = new PrismaClient({ adapter });
  return { client, pool };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const csvArg = process.argv[2];
  if (!csvArg) {
    console.error(
      '\n❌  No file specified.\n\n' +
      '    Usage:\n' +
      '      npx tsx scripts/refresh-database.ts "path/to/Новая таблица - Лист1.csv"\n'
    );
    process.exit(1);
  }

  const csvPath = path.resolve(process.cwd(), csvArg);
  if (!fs.existsSync(csvPath)) {
    console.error(`\n❌  File not found: ${csvPath}\n`);
    process.exit(1);
  }

  // ── Parse CSV ──────────────────────────────────────────────────────────────
  console.log(`\n📂  Reading: ${path.basename(csvPath)}`);

  let entries: CodeEntry[];
  try {
    entries = parseCSV(csvPath);
  } catch (err) {
    console.error(`\n❌  Parse error: ${(err as Error).message}\n`);
    process.exit(1);
  }

  if (entries.length === 0) {
    console.error(
      "\n❌  No codes found in CSV.\n" +
      "    Ensure the first row contains numeric denominations (e.g. 300,500,800).\n"
    );
    process.exit(1);
  }

  // Breakdown by denomination
  const byDenom = new Map<number, number>();
  for (const e of entries) {
    byDenom.set(e.denomination, (byDenom.get(e.denomination) ?? 0) + 1);
  }

  console.log("\n📊  Parsed breakdown:");
  for (const [denom, count] of Array.from(byDenom.entries()).sort((a, b) => a[0] - b[0])) {
    console.log(`    ${String(denom).padStart(5)} R$  →  ${count} codes`);
  }
  console.log(`    ${"Total".padStart(8)}      ${entries.length} codes`);

  // ── Connect ────────────────────────────────────────────────────────────────
  const { client: db, pool } = createDb();

  try {
    // ── Phase 1: Cleanup ───────────────────────────────────────────────────
    // FK safety:
    //   WbCode.userId  → User.id   (deleting WbCode is safe; no table FKs to WbCode.id)
    //   Order.userId   → User.id   (deleting Order is safe; no table FKs to Order.id)
    //   Order.productId → Product.id  (same)
    //   WbOrder.wbCode is a plain String — not a FK — unaffected by WbCode deletion
    console.log("\n🗑️   Cleaning up tables...");
    const [wbResult, ordResult] = await db.$transaction([
      db.wbCode.deleteMany({}),
      db.order.deleteMany({}),
    ]);
    console.log(`    WbCode : ${wbResult.count} records deleted`);
    console.log(`    Order  : ${ordResult.count} records deleted`);

    // ── Phase 2: Import ────────────────────────────────────────────────────
    console.log("\n📦  Importing new codes...");
    const CHUNK_SIZE = 500;
    let inserted = 0;

    for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
      const chunk = entries.slice(i, i + CHUNK_SIZE);
      const { count } = await db.wbCode.createMany({
        data: chunk.map(({ code, denomination }) => ({
          code,
          denomination,
          isUsed: false,
        })),
        skipDuplicates: true,
      });
      inserted += count;
      process.stdout.write(`\r    ✓ ${inserted}/${entries.length}`);
    }

    process.stdout.write("\n");

    // ── Final DB state ─────────────────────────────────────────────────────
    const stats = await db.wbCode.groupBy({
      by: ["denomination"],
      _count: { id: true },
      orderBy: { denomination: "asc" },
    });

    console.log("\n📊  Database state after import:");
    for (const row of stats) {
      console.log(`    ${String(row.denomination).padStart(5)} R$  →  ${row._count.id} codes`);
    }

    const skipped = entries.length - inserted;
    if (skipped > 0) {
      console.warn(`\n⚠️   ${skipped} duplicate(s) skipped.`);
    }

    console.log(`\n✅  Done! ${inserted} WbCode records inserted.\n`);

  } finally {
    await db.$disconnect();
    await pool.end();
  }
}

main().catch((err: Error) => {
  console.error("\n❌  Fatal:", err.message ?? err);
  process.exit(1);
});
