import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { activationCodeHmac, encryptActivationCode, normalizeActivationCode } from "@/lib/codes/secrets";
import { deliverIssuedCode, sendGiftEmail, type CodeEmailResult } from "@/lib/codes/delivery";
import { sendCodeToChat } from "@/lib/codes/chat-notify";

/**
 * Ручная выдача кода по оплаченному заказу (15.11.2026, `CODES_BACKORDER`).
 *
 * Код приходит от поставщика уже ПОСЛЕ оплаты. Выдача — одна транзакция:
 * код ложится в склад сразу выданным (AES-256-GCM, дубль ловит HMAC), заказ
 * получает его и статус ISSUED. Дальше — те же письмо/кабинет/чат, что при
 * выдаче со склада. Значение кода не попадает ни в лог, ни в ответ.
 *
 * Повторный вызов по уже выданному заказу ничего не меняет (`already`):
 * второй код за одни деньги не выдаём никогда.
 */

export type ManualIssueResult =
  | { ok: true; status: "issued"; publicId: string; email: CodeEmailResult; chat: boolean | null }
  | { ok: false; status: "not_found" | "not_paid" | "already" | "refunded" | "duplicate_code" | "bad_code" | "denomination_mismatch" };

const CODE_SHAPE = /^[A-Z0-9]{6,40}$/;

export async function issueCodeManually(input: { publicId: string; code: string; denomination?: number; label?: string }): Promise<ManualIssueResult> {
  const value = input.code.trim();
  if (!CODE_SHAPE.test(normalizeActivationCode(value))) return { ok: false, status: "bad_code" };
  const order = await prisma.codeOrder.findUnique({
    where: { publicId: input.publicId.trim().toUpperCase() },
    select: { id: true, publicId: true, status: true, paidAt: true, denomination: true, activationCodeId: true },
  });
  if (!order) return { ok: false, status: "not_found" };
  if (order.status === "REFUNDED") return { ok: false, status: "refunded" };
  if (order.status === "ISSUED" || order.activationCodeId) return { ok: false, status: "already" };
  if (order.status !== "PAID" || !order.paidAt) return { ok: false, status: "not_paid" };
  if (input.denomination !== undefined && input.denomination !== order.denomination) {
    return { ok: false, status: "denomination_mismatch" };
  }

  const now = new Date();
  try {
    await prisma.$transaction(async (tx) => {
      const code = await tx.activationCode.create({
        data: {
          denomination: order.denomination,
          encryptedValue: encryptActivationCode(value),
          codeHmac: activationCodeHmac(value),
          status: "ISSUED",
          batchLabel: input.label?.slice(0, 60) || `manual-${now.toISOString().slice(0, 10)}`,
          reservedForOrderId: order.id,
          issuedAt: now,
        },
        select: { id: true },
      });
      const moved = await tx.codeOrder.updateMany({
        where: { id: order.id, status: "PAID", activationCodeId: null },
        data: { status: "ISSUED", issuedAt: now, activationCodeId: code.id, attentionReason: null },
      });
      if (moved.count !== 1) throw new ConcurrentIssue();
      await tx.codeOrderEvent.create({
        data: {
          orderId: order.id,
          type: "MANUAL_ISSUED",
          idempotencyKey: `code-manual-issue:${order.id}`,
          payload: { codeId: code.id },
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof ConcurrentIssue) return { ok: false, status: "already" };
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const target = String((error.meta as { target?: unknown } | undefined)?.target ?? "");
      return { ok: false, status: target.includes("codeHmac") ? "duplicate_code" : "already" };
    }
    throw error;
  }

  const delivered = await deliverIssuedCode(order.id, "manual");
  return { ok: true, status: "issued", publicId: order.publicId, email: delivered.email, chat: delivered.chat };
}

class ConcurrentIssue extends Error {}

/**
 * Тик раз в минуту (зовёт TG-бот): отложенные подарки, у которых подошло
 * время, и сообщения в чат, которые не ушли с первого раза.
 */
export async function runCodesTick(now = new Date()): Promise<{ gifts: number; chats: number }> {
  const dueGifts = await prisma.codeOrder.findMany({
    where: {
      status: "ISSUED",
      deliveryMode: "GIFT",
      giftSentAt: null,
      emailAttempts: { lt: 8 },
      OR: [{ giftSendAt: null }, { giftSendAt: { lte: now } }],
    },
    select: { id: true },
    take: 20,
  });
  let gifts = 0;
  for (const order of dueGifts) {
    const result = await sendGiftEmail(order.id, "scheduled").catch(() => "failed" as const);
    if (result === "sent") gifts += 1;
  }

  const since = new Date(now.getTime() - 6 * 60 * 60 * 1000);
  const pendingChats = await prisma.codeOrder.findMany({
    where: { status: "ISSUED", channel: { in: ["TG", "VK"] }, chatDeliveredAt: null, issuedAt: { gte: since } },
    select: { id: true },
    take: 20,
  });
  let chats = 0;
  for (const order of pendingChats) {
    if (await sendCodeToChat(order.id).catch(() => false)) chats += 1;
  }
  return { gifts, chats };
}
