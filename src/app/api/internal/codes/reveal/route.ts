import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { issuedCodesForOrder } from "@/lib/codes/order-codes";
import { notifyCodeOpened } from "@/lib/codes/admin-notify";
import { internalNoStore, readSignedJson } from "@/lib/codes/internal-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Schema = z.object({
  platform: z.enum(["TG", "VK"]),
  subject: z.string().trim().regex(/^\d{1,20}$/),
  publicId: z.string().trim().regex(/^CODE-[A-Z0-9]{8}$/i),
});

/**
 * «👁 Показать код» в чате бота (21.11.2026). Бот присылает, КТО нажал; код
 * отдаётся только создателю заказа (его tgId/vkId), только выданный и не
 * переданный подарком. Первое открытие фиксируется (`revealedAt`) и уходит
 * админам уведом «покупатель открыл код».
 */
export async function POST(req: NextRequest) {
  const signed = await readSignedJson(req);
  if (!signed.ok) return signed.response;
  const parsed = Schema.safeParse(signed.body);
  if (!parsed.success) return NextResponse.json({ ok: false, status: "bad_request" }, { status: 400, headers: internalNoStore });
  const { platform, subject, publicId } = parsed.data;

  const order = await prisma.codeOrder.findFirst({
    where: {
      publicId: publicId.toUpperCase(),
      creator: platform === "TG" ? { tgId: subject } : { vkId: subject },
    },
    select: { id: true, status: true, denomination: true, publicId: true, revealedAt: true, deliveryMode: true, giftOpenTokenHash: true, activationCodeId: true },
  });
  if (!order) return NextResponse.json({ ok: false, status: "not_found" }, { status: 404, headers: internalNoStore });
  if (order.status === "REFUNDED") return NextResponse.json({ ok: false, status: "refunded" }, { status: 410, headers: internalNoStore });
  if (order.status !== "ISSUED" || !order.activationCodeId) return NextResponse.json({ ok: false, status: "not_issued" }, { status: 409, headers: internalNoStore });
  // Подаренный из кабинета код открывает получатель — как и в кабинете.
  if (order.deliveryMode !== "GIFT" && order.giftOpenTokenHash) {
    return NextResponse.json({ ok: false, status: "gifted" }, { status: 409, headers: internalNoStore });
  }
  let codes: string[];
  try {
    codes = await issuedCodesForOrder(order.id);
    if (!codes.length) throw new Error("no issued codes");
  } catch {
    console.error("[codes] chat reveal decrypt failed", { orderId: order.id });
    return NextResponse.json({ ok: false, status: "error" }, { status: 500, headers: internalNoStore });
  }
  if (!order.revealedAt) {
    const first = await prisma.codeOrder.updateMany({ where: { id: order.id, revealedAt: null }, data: { revealedAt: new Date() } });
    if (first.count === 1) void notifyCodeOpened(order.id, platform === "TG" ? "chat_tg" : "chat_vk");
  }
  return NextResponse.json({ ok: true, publicId: order.publicId, denomination: order.denomination, codes }, { headers: internalNoStore });
}
