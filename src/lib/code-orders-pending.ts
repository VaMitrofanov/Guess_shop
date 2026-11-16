import { prisma } from "@/lib/prisma";

/**
 * 🎟 Коды, которые ждут нас (16.11.2026, редизайн главной v2).
 *
 * Владелец: «коды и прямые — всегда в приоритете и максимально на виду,
 * отдельно в красивых блоках, чтобы не спутать с обычными заказами». Пока склад
 * пуст (`CODES_BACKORDER`), оплаченный заказ кода (`PAID`) ждёт ручной выдачи —
 * это и есть задача. `PAYMENT_PENDING` — человек открыл банк, денег ещё нет:
 * число, не задача.
 */
export interface PendingCodeOrder {
  publicId: string;
  denomination: number;
  paidAt: string | null;
  channel: string;
  gift: boolean;
}

export interface PendingCodeOrders {
  toIssue: PendingCodeOrder[];
  toIssueTotal: number;
  awaitingPayment: number;
}

export async function loadPendingCodeOrders(): Promise<PendingCodeOrders> {
  const [rows, toIssueTotal, awaitingPayment] = await Promise.all([
    prisma.codeOrder.findMany({
      where: { status: "PAID", refundedAt: null },
      orderBy: { paidAt: "asc" },
      take: 5,
      select: { publicId: true, denomination: true, paidAt: true, channel: true, giftTo: true },
    }),
    prisma.codeOrder.count({ where: { status: "PAID", refundedAt: null } }),
    prisma.codeOrder.count({ where: { status: "PAYMENT_PENDING" } }),
  ]);
  return {
    toIssue: rows.map((row) => ({
      publicId: row.publicId,
      denomination: row.denomination,
      paidAt: row.paidAt?.toISOString() ?? null,
      channel: String(row.channel),
      gift: Boolean(row.giftTo),
    })),
    toIssueTotal,
    awaitingPayment,
  };
}
