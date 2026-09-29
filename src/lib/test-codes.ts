import { prisma } from "@/lib/prisma";

/**
 * Canonical permanent test WB codes. All carry `isTest=true` so they never leak
 * into stats/inventory, but otherwise behave exactly like real codes (welcome,
 * instruction, subscription gate, order creation, admin card, dashboard order).
 *
 * Constraints: `code` is exactly 7 chars `[A-Za-z0-9]` with ≥1 letter (matches
 * the site/bot entry regex). The pass price a tester must hit is
 * `Math.ceil(denomination / 0.7)`.
 *
 * ⚠️ Keep this list in sync with `scripts/reset-test-code.mjs` (the CLI fallback).
 */
export const TEST_CODES: { code: string; denomination: number }[] = [
  { code: "TESTDEV", denomination: 500  }, // dev default
  { code: "TEST300", denomination: 300  }, // → pass 429
  { code: "TEST500", denomination: 500  }, // → pass 715
  { code: "TEST700", denomination: 700  }, // → pass 1000 (exact)
  { code: "TEST800", denomination: 800  }, // → pass 1143
  { code: "TST1000", denomination: 1000 }, // → pass 1429
  { code: "TST2000", denomination: 2000 }, // → pass 2858
  { code: "TST3000", denomination: 3000 }, // → pass 4286
  { code: "TST5000", denomination: 5000 }, // → pass 7143
];

export const TEST_CODE_SET = new Set(TEST_CODES.map((c) => c.code));

/** Pass price a tester must set on the gamepass for a given denomination. */
export function testPassPrice(denomination: number): number {
  return Math.ceil(denomination / 0.7);
}

/**
 * Reset test codes back to a clean AVAILABLE state so a fresh buyer run starts
 * from scratch. Idempotent: upserts each canonical code (creates if missing),
 * clears the claim/reservation/site-handoff/review fields, and drops any
 * leftover WbOrder so the unique `wbCode` constraint never blocks re-activation.
 *
 * @param codes  optional subset of code strings; when omitted, resets all.
 * @returns the list of codes that were reset.
 */
export async function resetTestCodes(codes?: string[]): Promise<string[]> {
  const targets = codes
    ? TEST_CODES.filter((c) => codes.includes(c.code))
    : TEST_CODES;
  const codeStrs = targets.map((c) => c.code);
  if (codeStrs.length === 0) return [];

  // Drop leftover orders first (FK-safe: WbOrder → User, not the other way).
  await (prisma as any).wbOrder.deleteMany({ where: { wbCode: { in: codeStrs } } });

  for (const { code, denomination } of targets) {
    await (prisma as any).wbCode.upsert({
      where:  { code },
      update: {
        denomination,
        status:             "AVAILABLE",
        isUsed:             false,
        isTest:             true,
        userId:             null,
        sessionId:          null,
        reservedUntil:      null,
        usedAt:             null,
        selectedGamepassId: null,
        robloxNick:         null,
        reviewBonusClaimed: false,
      },
      create: { code, denomination, status: "AVAILABLE", isTest: true },
    });
  }

  return codeStrs;
}
