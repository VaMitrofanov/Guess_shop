import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { activationCodeHmac, encryptActivationCode, normalizeActivationCode } from "@/lib/codes/secrets";
import { deliverIssuedCode, sendGiftEmail, type CodeEmailResult } from "@/lib/codes/delivery";
import { sendCodeToChat, sendPayReminderToChat } from "@/lib/codes/chat-notify";
import { buildPayReminderEmail } from "@/lib/codes/delivery";
import { payUrlFor } from "@/lib/codes/orders";
import { codeComponents, formatRubKopecks } from "@/lib/codes-pricing";
import { sendMail } from "@/lib/mailer";

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
 *
 * Набор (20.11.2026, `codeComponents`): «2 000 R$» = два кода по 1 000 —
 * админ присылает оба одним сообщением (каждый с новой строки, через запятую
 * или пробел), выдаются оба разом или ни один. «199 R$» — код поставщика на 200.
 */

export type ManualIssueResult =
  | { ok: true; status: "issued"; publicId: string; email: CodeEmailResult; chat: boolean | null }
  | { ok: false; status: "not_found" | "not_paid" | "already" | "refunded" | "duplicate_code" | "bad_code" | "denomination_mismatch" | "count_mismatch"; expected?: number };

const CODE_SHAPE = /^[A-Z0-9]{6,40}$/;

/**
 * Коды из одного сообщения админа. Один код может быть с пробелами/дефисами
 * («ABCD 1234 EFGH»), поэтому для заказа из одного кода текст — целиком. Для
 * набора — сначала по строкам, запятым и «;», а если строка одна — по пробелам.
 */
export function splitIssuedCodes(raw: string, expected: number): string[] {
  const text = raw.trim();
  if (expected <= 1) return text ? [text] : [];
  let parts = text.split(/[\n,;]+/).map((part) => part.trim()).filter(Boolean);
  if (parts.length === 1) parts = text.split(/\s+/).filter(Boolean);
  return parts;
}

export async function issueCodeManually(input: { publicId: string; code: string; denomination?: number; label?: string }): Promise<ManualIssueResult> {
  const order = await prisma.codeOrder.findUnique({
    where: { publicId: input.publicId.trim().toUpperCase() },
    select: { id: true, publicId: true, status: true, paidAt: true, denomination: true, pricingVersion: true, activationCodeId: true },
  });
  if (!order) return { ok: false, status: "not_found" };
  if (order.status === "REFUNDED") return { ok: false, status: "refunded" };
  if (order.status === "ISSUED" || order.activationCodeId) return { ok: false, status: "already" };
  if (order.status !== "PAID" || !order.paidAt) return { ok: false, status: "not_paid" };
  const components = codeComponents(order.denomination, order.pricingVersion);
  const values = splitIssuedCodes(input.code, components.length);
  if (values.length !== components.length) return { ok: false, status: "count_mismatch", expected: components.length };
  if (values.some((value) => !CODE_SHAPE.test(normalizeActivationCode(value)))) return { ok: false, status: "bad_code" };
  if (new Set(values.map(normalizeActivationCode)).size !== values.length) return { ok: false, status: "duplicate_code" };
  // Сверка номинала: годится и номинал заказа («2 000»), и номинал кода поставщика («1 000», «200»).
  if (input.denomination !== undefined && input.denomination !== order.denomination && !components.includes(input.denomination)) {
    return { ok: false, status: "denomination_mismatch" };
  }

  const now = new Date();
  try {
    await prisma.$transaction(async (tx) => {
      // Резерв со склада, если он был (код не нашёлся целиком при оплате), — отпустить:
      // заказ закрывается присланными кодами, а не складскими.
      await tx.activationCode.updateMany({
        where: { reservedForOrderId: order.id, status: "RESERVED" },
        data: { status: "IN_STOCK", reservedForOrderId: null, reservedUntil: null },
      });
      const ids: string[] = [];
      for (const [index, value] of values.entries()) {
        const code = await tx.activationCode.create({
          data: {
            denomination: components[index],
            encryptedValue: encryptActivationCode(value),
            codeHmac: activationCodeHmac(value),
            status: "ISSUED",
            batchLabel: input.label?.slice(0, 60) || `manual-${now.toISOString().slice(0, 10)}`,
            reservedForOrderId: order.id,
            // Миллисекунда на код — порядок в письме совпадает с порядком в сообщении админа.
            issuedAt: new Date(now.getTime() + index),
          },
          select: { id: true },
        });
        ids.push(code.id);
      }
      const code = { id: ids[0] };
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
          payload: { codeId: code.id, codeIds: ids },
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
/**
 * Напоминание о неоплаченном заказе (15.11.2026): через час после создания,
 * один раз, пока предложение живо. Бот — сообщением с кнопкой, сайт — письмом
 * (гостю на его почту, клиенту — на подтверждённую почту аккаунта).
 */
export async function remindUnpaidCodeOrders(now = new Date()): Promise<number> {
  const orders = await prisma.codeOrder.findMany({
    where: {
      status: { in: ["AWAITING_PAYMENT", "PAYMENT_PENDING"] },
      paidAt: null,
      payReminderSentAt: null,
      createdAt: { lte: new Date(now.getTime() - 60 * 60 * 1000), gte: new Date(now.getTime() - 20 * 60 * 60 * 1000) },
      offerExpiresAt: { gt: new Date(now.getTime() + 60 * 60 * 1000) },
    },
    select: {
      id: true, denomination: true, finalAmountKopecks: true, channel: true, createdVia: true, deliveryMode: true, recipientEmail: true,
      creator: { select: { email: true, emailVerifiedAt: true } },
    },
    take: 20,
  });
  let sent = 0;
  for (const order of orders) {
    // Сначала отметка — второй тик не напомнит повторно, даже если отправка упадёт.
    const claimed = await prisma.codeOrder.updateMany({ where: { id: order.id, payReminderSentAt: null }, data: { payReminderSentAt: now } });
    if (claimed.count !== 1) continue;
    const payUrl = payUrlFor(order.id);
    const amountRub = formatRubKopecks(order.finalAmountKopecks).replace(/\u00a0/g, " ");
    let ok: boolean | null = null;
    if (order.channel === "TG" || order.channel === "VK") {
      ok = await sendPayReminderToChat(order.id, payUrl, amountRub).catch(() => false);
    } else {
      const to = order.deliveryMode === "EMAIL" ? order.recipientEmail : order.creator?.emailVerifiedAt ? order.creator.email : null;
      if (to) {
        const mail = buildPayReminderEmail({ denomination: order.denomination, amountRub, payUrl, share: order.createdVia === "SHARE" });
        ok = (await sendMail({ to, ...mail }).catch(() => ({ ok: false }))).ok;
      }
    }
    if (ok) sent += 1;
    await prisma.codeOrderEvent.create({
      data: { orderId: order.id, type: ok ? "PAY_REMINDER_SENT" : "PAY_REMINDER_SKIPPED", idempotencyKey: `code-pay-reminder:${order.id}`, payload: {} },
    }).catch(() => undefined);
  }
  return sent;
}

export async function runCodesTick(now = new Date()): Promise<{ gifts: number; chats: number; reminders: number }> {
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
  const reminders = await remindUnpaidCodeOrders(now).catch((error) => {
    console.warn("[codes] напоминания:", (error as Error)?.message);
    return 0;
  });
  return { gifts, chats, reminders };
}
