import { NextRequest, NextResponse } from "next/server";
import { extractTwaUser } from "@/lib/twa-auth";
import { prisma } from "@/lib/prisma";

const VALID_STATUSES = ["AWAITING_GAMEPASS", "PENDING", "IN_PROGRESS", "COMPLETED", "REJECTED"] as const;
type OrderStatus = typeof VALID_STATUSES[number];

export async function GET(req: NextRequest) {
  if (!await extractTwaUser(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const status  = searchParams.get("status") as OrderStatus | "ALL" | null;
  const page    = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const limit   = Math.min(50, Math.max(5, parseInt(searchParams.get("limit") ?? "20", 10)));
  const skip    = (page - 1) * limit;

  const where = (status && status !== "ALL" && VALID_STATUSES.includes(status as OrderStatus))
    ? { status: status as OrderStatus }
    : {};

  const [orders, total, counts] = await Promise.all([
    (prisma as any).wbOrder.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: {
        user: { select: { tgId: true, vkId: true, name: true } },
      },
    }),
    (prisma as any).wbOrder.count({ where }),
    Promise.all(
      [...VALID_STATUSES, "ALL"].map(async s => {
        const w = s === "ALL" ? {} : { status: s };
        const count = await (prisma as any).wbOrder.count({ where: w });
        return [s, count] as [string, number];
      })
    ).then(entries => Object.fromEntries(entries)),
  ]);

  return NextResponse.json({ orders, total, counts, page, pages: Math.ceil(total / limit) });
}
