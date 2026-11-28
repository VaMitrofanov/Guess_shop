import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-access";
import { prisma } from "@/lib/prisma";

/**
 * Код гейта или номер заказа WB, по которым ещё нет заказа на выкуп (15.11.2026).
 *
 * Владелец искал в ⌘K код 3M7Z4UH и получил «Ничего не нашлось»: палитра ищет
 * только `WbOrder`, а он появляется, когда покупатель ввёл ник и пасс. До этого
 * есть лишь код (`WbCode`) и строка доставки DBS. Этот роут отдаёт их, чтобы
 * палитра сказала, на каком шаге покупатель, и открыла доставку.
 */
export async function GET(req: NextRequest) {
  if (!await requireAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  const code = q.toUpperCase();
  const digits = q.replace(/\D/g, "");
  const byCode = /^[A-Z0-9]{7}$/.test(code);
  const byWbNumber = /^\d{6,}$/.test(q.replace(/[\s#-]/g, ""));
  if (!byCode && !byWbNumber) return NextResponse.json({ items: [] });

  const [codes, deliveries] = await Promise.all([
    byCode
      ? prisma.wbCode.findMany({
          where: { code, isTest: false },
          take: 1,
          select: { code: true, denomination: true, status: true, reservedUntil: true, robloxNick: true, selectedGamepassId: true, createdAt: true },
        })
      : Promise.resolve([]),
    prisma.wbMarketplaceOrder.findMany({
      where: { isTest: false, ...(byCode ? { wbCode: { code } } : { wbOrderId: { contains: digits } }) },
      orderBy: { firstSeenAt: "desc" },
      take: 5,
      select: {
        id: true, wbOrderId: true, denominationSnapshot: true, completedAt: true, cancelledAt: true, firstSeenAt: true,
        wbCode: { select: { code: true, denomination: true, status: true, reservedUntil: true, robloxNick: true, selectedGamepassId: true, createdAt: true } },
      },
    }),
  ]);

  type Item = {
    code: string | null; denomination: number | null; codeStatus: string | null; reservedUntil: Date | null;
    nick: string | null; gamepassId: string | null; deliveryId: string | null; wbOrderId: string | null;
    deliveryClosedAt: Date | null; cancelledAt: Date | null; seenAt: Date;
  };
  const items: Item[] = deliveries.map((d) => ({
    code: d.wbCode?.code ?? null,
    denomination: d.wbCode?.denomination ?? d.denominationSnapshot ?? null,
    codeStatus: d.wbCode?.status ?? null,
    reservedUntil: d.wbCode?.reservedUntil ?? null,
    nick: d.wbCode?.robloxNick ?? null,
    gamepassId: d.wbCode?.selectedGamepassId ? String(d.wbCode.selectedGamepassId) : null,
    deliveryId: d.id, wbOrderId: d.wbOrderId, deliveryClosedAt: d.completedAt, cancelledAt: d.cancelledAt,
    seenAt: d.firstSeenAt,
  }));
  // Код не из DBS (карта, коридор) — строки доставки нет, но код есть.
  for (const c of codes) {
    if (items.some((i) => i.code === c.code)) continue;
    items.push({
      code: c.code, denomination: c.denomination, codeStatus: c.status, reservedUntil: c.reservedUntil,
      nick: c.robloxNick, gamepassId: c.selectedGamepassId ? String(c.selectedGamepassId) : null,
      deliveryId: null, wbOrderId: null, deliveryClosedAt: null, cancelledAt: null, seenAt: c.createdAt,
    });
  }

  // Заказ на выкуп по этим кодам — палитра уже показывает его своей строкой.
  const withCode = items.flatMap((i) => (i.code ? [i.code] : []));
  const ordered = withCode.length
    ? new Set((await prisma.wbOrder.findMany({ where: { wbCode: { in: withCode } }, select: { wbCode: true } })).map((o) => o.wbCode))
    : new Set<string>();

  return NextResponse.json({ items: items.map((i) => ({ ...i, hasOrder: i.code ? ordered.has(i.code) : false })) });
}

export const dynamic = "force-dynamic";
export const revalidate = 0;
