/**
 * POST /api/admin/wb-codes
 * Bulk-imports WB activation codes into the database.
 *
 * Auth: Bearer token via ADMIN_SECRET env variable.
 *
 * Request body:
 * {
 *   codes: Array<{ code: string; denomination: number; batch?: string }>
 * }
 *
 * Response:
 * {
 *   inserted: number;   // newly added codes
 *   skipped:  number;   // already existed (by unique code)
 * }
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { PrismaClientWithWb } from "@/types/prisma-wb";

// Typed cast — WbCode delegate is added after `prisma generate` is run locally
const db = prisma as unknown as PrismaClientWithWb;

const VALID_DENOMINATIONS = new Set([300, 500, 800, 1000, 1200, 2000]);

interface CodeEntry {
  code:         string;
  denomination: number;
  batch?:       string;
}

export async function POST(request: Request) {
  // ── Auth ───────────────────────────────────────────────────────────────────
  const authHeader = request.headers.get("authorization") ?? "";
  const secret     = process.env.ADMIN_SECRET;

  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Parse body ─────────────────────────────────────────────────────────────
  let codes: CodeEntry[];
  try {
    const body = await request.json();
    codes = body?.codes;
    if (!Array.isArray(codes) || codes.length === 0) {
      return NextResponse.json(
        { error: "Field 'codes' must be a non-empty array" },
        { status: 400 }
      );
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // ── Validate each entry ────────────────────────────────────────────────────
  const rows: CodeEntry[] = [];
  const validationErrors: string[] = [];

  for (let i = 0; i < codes.length; i++) {
    const entry = codes[i];
    const code = (entry?.code ?? "").toString().trim().toUpperCase();
    const denomination = Number(entry?.denomination);

    if (!code || code.length < 4 || code.length > 16) {
      validationErrors.push(`[${i}] invalid code: "${entry?.code}"`);
      continue;
    }
    if (!VALID_DENOMINATIONS.has(denomination)) {
      validationErrors.push(
        `[${i}] invalid denomination: ${denomination}. Allowed: ${[...VALID_DENOMINATIONS].join(", ")}`
      );
      continue;
    }

    rows.push({
      code,
      denomination,
      batch: entry.batch ? entry.batch.toString().trim() : undefined,
    });
  }

  if (validationErrors.length > 0) {
    return NextResponse.json(
      { error: "Validation failed", details: validationErrors },
      { status: 422 }
    );
  }

  // ── Upsert — skip duplicates, count inserts ────────────────────────────────
  let inserted = 0;
  let skipped  = 0;

  // Process in batches of 100 to stay within DB limits
  const BATCH_SIZE = 100;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE);

    const result = await db.wbCode.createMany({
      data: chunk,
      skipDuplicates: true,   // Prisma honours the unique index — no throw on conflict
    });

    inserted += result.count;
    skipped  += chunk.length - result.count;
  }

  return NextResponse.json({ ok: true, inserted, skipped });
}

// ── GET — quick stats ──────────────────────────────────────────────────────────
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization") ?? "";
  const secret     = process.env.ADMIN_SECRET;

  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const stats = await db.wbCode.groupBy({
    by: ["denomination", "isUsed"],
    _count: { id: true },
    orderBy: { denomination: "asc" },
  });

  // Reshape into { denomination: { total, used, available } }
  const summary: Record<number, { total: number; used: number; available: number }> = {};

  for (const row of stats) {
    const d = row.denomination;
    if (!summary[d]) summary[d] = { total: 0, used: 0, available: 0 };
    summary[d].total    += row._count.id;
    if (row.isUsed) summary[d].used      += row._count.id;
    else            summary[d].available += row._count.id;
  }

  return NextResponse.json({ ok: true, summary });
}
