import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { internalNoStore, readSignedJson } from "@/lib/codes/internal-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Очередь ручной выдачи: оплаченные заказы без кода + свежие выданные.
 * Без адресов и без кодов — только то, что нужно, чтобы выдать.
 */
export async function POST(req: NextRequest) {
  const signed = await readSignedJson(req);
  if (!signed.ok) return signed.response;
  const [waiting, recent] = await Promise.all([
    prisma.codeOrder.findMany({
      where: { status: "PAID" },
      orderBy: { paidAt: "asc" },
      take: 100,
      select: { publicId: true, denomination: true, finalAmountKopecks: true, paidAt: true, channel: true, deliveryMode: true, attentionReason: true, giftSendAt: true },
    }),
    prisma.codeOrder.findMany({
      where: { status: "ISSUED" },
      orderBy: { issuedAt: "desc" },
      take: 20,
      select: { publicId: true, denomination: true, issuedAt: true, channel: true, deliveryMode: true, emailSentAt: true, emailLastError: true, chatDeliveredAt: true, giftSendAt: true, giftSentAt: true },
    }),
  ]);
  return NextResponse.json({ waiting, recent }, { headers: internalNoStore });
}
