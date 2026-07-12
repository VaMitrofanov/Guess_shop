import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { extractTwaUser } from "@/lib/twa-auth";
import { cancelCanonicalTinkoffPayment } from "@/lib/tinkoff";

export const dynamic = "force-dynamic";

const RefundSchema = z.object({
  orderId: z.string().min(1),
  amountKopecks: z.number().int().positive().optional(),
  idempotencyKey: z.uuid(),
  reason: z.string().trim().max(500).optional(),
});

export async function POST(req: NextRequest) {
  const operator = await extractTwaUser(req);
  if (!operator) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = RefundSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Некорректный запрос возврата" }, { status: 400 });

  const input = parsed.data;
  const prepared = await prisma.$transaction(async (tx) => {
    const existing = await tx.paymentRefund.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) return { kind: "existing", existing } as const;
    const order = await tx.wbOrder.findUnique({
      where: { id: input.orderId },
      select: { id: true, receiptEmail: true, paymentAttempts: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
    const attempt = order?.paymentAttempts[0];
    if (!order || !attempt || !attempt.paymentId || !order.receiptEmail) throw new Error("PAYMENT_NOT_FOUND");
    const paymentId = attempt.paymentId;
    const receiptEmail = order.receiptEmail;
    if (attempt.status !== "CONFIRMED" && attempt.status !== "PARTIALLY_REFUNDED") throw new Error("PAYMENT_STATUS");
    // PENDING/SUBMITTED/UNKNOWN rows reserve their amount. This closes the
    // different-UUID/two-manager race, not only the repeated-same-UUID case.
    const reserved = await tx.paymentRefund.aggregate({
      where: { paymentAttemptId: attempt.id, status: { in: ["PENDING", "SUBMITTED", "SUBMIT_UNKNOWN"] } },
      _sum: { amountKopecks: true },
    });
    const remaining = attempt.amountKopecks - attempt.refundedAmountKopecks - (reserved._sum.amountKopecks ?? 0);
    const amountKopecks = input.amountKopecks ?? remaining;
    if (amountKopecks <= 0 || amountKopecks > remaining) throw new Error("REFUND_EXCEEDS_REMAINING");
    const refund = await tx.paymentRefund.create({
      data: { paymentAttemptId: attempt.id, idempotencyKey: input.idempotencyKey, amountKopecks, reason: input.reason, requestedBy: String(operator.userId) },
    });
    return {
      kind: "prepared",
      orderId: order.id,
      receiptEmail,
      attempt: { ...attempt, paymentId },
      refund, amountKopecks, remaining,
    } as const;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).catch((error: unknown) => ({ kind: "error", preparationError: error } as const));

  if (prepared.kind === "error") {
    const code = prepared.preparationError instanceof Error ? prepared.preparationError.message : "";
    if (code === "PAYMENT_NOT_FOUND") return NextResponse.json({ error: "Платёж для возврата не найден" }, { status: 404 });
    if (code === "PAYMENT_STATUS") return NextResponse.json({ error: "Текущий статус платежа не допускает возврат" }, { status: 409 });
    if (code === "REFUND_EXCEEDS_REMAINING") return NextResponse.json({ error: "Сумма превышает доступный остаток с учётом уже отправленных возвратов" }, { status: 409 });
    console.error("[refund] preparation failed", prepared.preparationError);
    return NextResponse.json({ error: "Не удалось зарезервировать сумму возврата" }, { status: 409 });
  }
  if (prepared.kind === "existing") {
    const existing = prepared.existing;
    return NextResponse.json({ success: existing.status === "SUBMITTED" || existing.status === "CONFIRMED", refund: existing, alreadyExists: true });
  }
  const { orderId, receiptEmail, attempt, refund, amountKopecks, remaining } = prepared;

  try {
    const provider = await cancelCanonicalTinkoffPayment({
      paymentId: attempt.paymentId,
      amountKopecks,
      totalAmountKopecks: remaining,
      receiptEmail,
    });
    const responseHash = crypto.createHash("sha256").update(JSON.stringify(provider.raw)).digest("hex");
    await prisma.paymentRefund.updateMany({
      where: { id: refund.id, status: "PENDING" },
      data: { status: "SUBMITTED", providerStatus: provider.status, responseHash },
    });
    await prisma.orderEvent.create({
      data: {
        orderId,
        type: "PAYMENT_REFUND_REQUESTED",
        idempotencyKey: `refund-request:${refund.id}`,
        payload: { paymentAttemptId: attempt.id, refundId: refund.id, amountKopecks, responseHash },
      },
    });
    const updated = await prisma.paymentRefund.findUniqueOrThrow({ where: { id: refund.id } });
    return NextResponse.json({ success: true, refund: updated }, { status: 202 });
  } catch (error) {
    // A timeout can happen after the provider accepted the operation. Do not
    // auto-repeat: mark it for reconciliation and wait for webhook/GetState.
    const errorHash = crypto.createHash("sha256").update(String(error)).digest("hex");
    await prisma.paymentRefund.updateMany({ where: { id: refund.id, status: "PENDING" }, data: { status: "SUBMIT_UNKNOWN", responseHash: errorHash } });
    console.error("[refund] provider outcome unknown", { refundId: refund.id, errorHash });
    return NextResponse.json({ error: "Исход запроса неизвестен; повтор запрещён до сверки с банком", refundId: refund.id }, { status: 502 });
  }
}
