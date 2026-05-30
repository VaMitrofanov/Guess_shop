import { NextRequest, NextResponse } from "next/server";
import { extractTwaUser } from "@/lib/twa-auth";
import { prisma } from "@/lib/prisma";

/**
 * Search the WbCode table directly (not via orders).
 *
 * Query params:
 *   q       — substring of code (case-insensitive, uppercase normalised)
 *   status  — AVAILABLE | RESERVED | CLAIMED
 *   denom   — exact denomination filter (e.g. 500)
 *   page    — 1-based, default 1
 *   limit   — default 50, capped at 200
 *
 * The endpoint surfaces all DB fields the manager needs to track a code
 * across its lifecycle, including who claimed it, whether the linked order
 * exists, and the bonus-claim flag.
 */
export async function GET(req: NextRequest) {
  if (!await extractTwaUser(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url    = new URL(req.url);
  const q      = (url.searchParams.get("q") ?? "").trim().toUpperCase();
  const status = url.searchParams.get("status");
  const denomS = url.searchParams.get("denom");
  const page   = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
  const limit  = Math.min(200, Math.max(1, parseInt(url.searchParams.get("limit") ?? "50", 10)));

  const where: any = {};
  if (q) where.code = { contains: q, mode: "insensitive" };
  if (status && ["AVAILABLE", "RESERVED", "CLAIMED"].includes(status)) {
    where.status = status;
  }
  if (denomS) {
    const denom = parseInt(denomS, 10);
    if (!isNaN(denom) && denom > 0) where.denomination = denom;
  }

  const [codes, total] = await Promise.all([
    (prisma as any).wbCode.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
      include: {
        user: { select: { id: true, tgId: true, vkId: true, name: true, username: true } },
      },
    }),
    (prisma as any).wbCode.count({ where }),
  ]);

  // Attach order linkage (one query, batched by code values)
  const codeValues = codes.map((c: any) => c.code);
  const orders = codeValues.length
    ? await (prisma as any).wbOrder.findMany({
        where:  { wbCode: { in: codeValues } },
        select: { id: true, wbCode: true, status: true, createdAt: true, amount: true },
      })
    : [];
  const orderByCode = new Map<string, any>();
  for (const o of orders) orderByCode.set(o.wbCode, o);

  const result = codes.map((c: any) => ({
    id:                 c.id,
    code:               c.code,
    denomination:       c.denomination,
    status:             c.status,
    isUsed:             c.isUsed,
    reservedUntil:      c.reservedUntil,
    usedAt:             c.usedAt,
    batch:              c.batch,
    reviewBonusClaimed: c.reviewBonusClaimed,
    createdAt:          c.createdAt,
    updatedAt:          c.updatedAt,
    user:               c.user ?? null,
    order:              orderByCode.get(c.code) ?? null,
  }));

  return NextResponse.json({
    codes:  result,
    total,
    page,
    pages:  Math.max(1, Math.ceil(total / limit)),
    limit,
  });
}
