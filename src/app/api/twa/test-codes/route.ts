import { NextRequest, NextResponse } from "next/server";
import { extractTwaUser } from "@/lib/twa-auth";
import { prisma } from "@/lib/prisma";
import { TEST_CODES, testPassPrice, resetTestCodes } from "@/lib/test-codes";

/** GET — canonical test codes joined with their current DB status. */
export async function GET(req: NextRequest) {
  if (!await extractTwaUser(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await (prisma as any).wbCode.findMany({
    where:  { code: { in: TEST_CODES.map((c) => c.code) } },
    select: { code: true, status: true, isUsed: true, reservedUntil: true },
  });
  const byCode = new Map<string, any>(rows.map((r: any) => [r.code, r]));

  const codes = TEST_CODES.map(({ code, denomination }) => {
    const row = byCode.get(code);
    return {
      code,
      denomination,
      passPrice: testPassPrice(denomination),
      exists:    !!row,
      status:    row?.status ?? null,   // AVAILABLE | RESERVED | CLAIMED | null(не создан)
      isUsed:    row?.isUsed ?? false,
    };
  });

  return NextResponse.json({ codes });
}

/** POST { action: "reset", code? } — reset all test codes, or a single one. */
export async function POST(req: NextRequest) {
  if (!await extractTwaUser(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (body?.action !== "reset")
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });

  const one = typeof body.code === "string" ? body.code : null;
  if (one && !TEST_CODES.some((c) => c.code === one))
    return NextResponse.json({ error: "Unknown test code" }, { status: 400 });

  try {
    const reset = await resetTestCodes(one ? [one] : undefined);
    return NextResponse.json({ ok: true, reset });
  } catch (err) {
    console.error("[twa/test-codes] reset failed:", err);
    return NextResponse.json({ error: "Reset failed" }, { status: 500 });
  }
}
