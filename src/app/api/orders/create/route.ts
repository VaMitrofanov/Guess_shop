import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { auth } from "@/auth";
import {
  createCanonicalWebOrder,
  validateCheckoutGamepass,
  validateCheckoutQuote,
  WebOrderError,
} from "@/lib/canonical-web-order";
import { prisma } from "@/lib/prisma";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { getCheckoutGamepassDetails, getRobloxUser } from "@/lib/roblox";
import { initCanonicalTinkoffPayment } from "@/lib/tinkoff";
import { siteAcquiringDecision } from "@/lib/site-acquiring";
import { revertWebOrderBenefits } from "@/lib/web-order-benefits";
import {
  createPaymentRetry,
  isLivePaymentAttempt,
  PaymentRetryError,
} from "@/lib/payment-init-retry";

export const dynamic = "force-dynamic";

const CreateOrderSchema = z.object({
  quoteId: z.string().cuid(),
  username: z.string().trim().min(3).max(20),
  gamepassId: z.string().regex(/^\d+$/),
  receiptEmail: z.email().max(254),
  agreedToTerms: z.literal(true),
  idempotencyKey: z.uuid(),
});

/**
 * U9: адрес согласия с офертой берётся тем же `clientIp()`, что и лимиты —
 * второй локальной реализации (доверявшей подделываемому левому hop'у) больше нет.
 */
function consentIp(req: NextRequest): string | null {
  const ip = clientIp(req);
  return ip === "unknown" ? null : ip;
}

async function initializePayment(input: {
  orderId: string;
  publicOrderId: string;
  providerOrderId: string;
  attemptId: string;
  amountKopecks: number;
  receiptEmail: string;
  statusToken: string;
}) {
  let payment: Awaited<ReturnType<typeof initCanonicalTinkoffPayment>>;
  try {
    payment = await initCanonicalTinkoffPayment({
      publicOrderId: input.publicOrderId,
      providerOrderId: input.providerOrderId,
      amountKopecks: input.amountKopecks,
      receiptEmail: input.receiptEmail,
      description: `Заказ ${input.publicOrderId}`,
      statusToken: input.statusToken,
    });
  } catch (providerError) {
    const errorHash = crypto.createHash("sha256").update(String(providerError)).digest("hex");
    await prisma.$transaction([
      prisma.paymentAttempt.update({
        where: { id: input.attemptId },
        data: { status: "FAILED", rawEventHash: errorHash, finalizedAt: new Date() },
      }),
      prisma.orderEvent.create({
        data: {
          orderId: input.orderId,
          type: "PAYMENT_INIT_FAILED",
          idempotencyKey: `payment-init-failed:${input.attemptId}`,
          payload: { paymentAttemptId: input.attemptId, errorHash },
        },
      }),
    ]);
    try {
      await revertWebOrderBenefits(input.orderId, "PAYMENT_INIT_FAILED");
    } catch (revertError) {
      console.error("[orders/create] benefits revert failed", { orderId: input.orderId, revertError });
    }
    console.error("[orders/create] T-Bank Init failed", { orderId: input.publicOrderId, errorHash });
    throw providerError;
  }

  // Persist the provider identifiers first. If the secondary order/audit write
  // fails, the payment link remains safely reusable instead of being marked
  // FAILED and allowing a duplicate provider attempt.
  await prisma.paymentAttempt.update({
    where: { id: input.attemptId },
    data: {
      paymentId: payment.paymentId,
      paymentUrl: payment.paymentUrl,
      status: "INITIATED",
      initiatedAt: new Date(),
    },
  });
  try {
    await prisma.$transaction([
      prisma.wbOrder.update({ where: { id: input.orderId }, data: { status: "PAYMENT_PENDING" } }),
      prisma.orderEvent.create({
        data: {
          orderId: input.orderId,
          type: "PAYMENT_INITIATED",
          idempotencyKey: `payment-initiated:${input.attemptId}`,
          payload: { paymentAttemptId: input.attemptId, provider: "TBANK", providerOrderId: input.providerOrderId },
        },
      }),
    ]);
  } catch (auditError) {
    console.error("[orders/create] payment durable, secondary audit update failed", {
      orderId: input.publicOrderId,
      attemptId: input.attemptId,
      auditError,
    });
  }
  return { paymentUrl: payment.paymentUrl };
}

export async function POST(req: NextRequest) {
  const { ok, retryAfter } = rateLimit(`checkout:${clientIp(req)}`, 5, 1 / 30);
  if (!ok) {
    return NextResponse.json(
      { error: "Слишком много попыток оплаты. Попробуйте через минуту." },
      { status: 429, headers: { "retry-after": String(retryAfter) } },
    );
  }

  const parsed = CreateOrderSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const termsIssue = parsed.error.issues.some((issue) => issue.path.includes("agreedToTerms"));
    return NextResponse.json({
      error: termsIssue
        ? "Необходимо согласие с офертой и политикой конфиденциальности"
        : "Некорректные параметры заказа",
      details: parsed.error.issues,
    }, { status: 400 });
  }

  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) {
    return NextResponse.json(
      { error: "Войдите или зарегистрируйтесь, затем обновите цену." },
      { status: 401 },
    );
  }

  // Authorization and rollout eligibility are enforced here even if the UI is
  // bypassed. Webhook, refund and outbox processing deliberately do not depend
  // on this gate, so already accepted money keeps moving when the kill switch
  // is turned off.
  if (!siteAcquiringDecision({ userId }).eligible) {
    return NextResponse.json(
      { error: "Оплата на сайте пока закрыта или доступна ограниченной группе." },
      { status: 503, headers: { "retry-after": "3600" } },
    );
  }

  const input = parsed.data;
  try {
    // A 5xx response makes the browser rotate its request key. The consumed
    // quote still identifies the same canonical order, so a rotated key can
    // resume it instead of failing forever with QUOTE_UNAVAILABLE.
    const existing = await prisma.wbOrder.findFirst({
      where: {
        OR: [
          { webIdempotencyKey: input.idempotencyKey },
          { priceQuoteId: input.quoteId },
        ],
      },
      select: {
        id: true,
        userId: true,
        publicOrderId: true,
        robloxUsername: true,
        gamepassId: true,
        amount: true,
        paidAt: true,
        paymentAttempts: {
          orderBy: { createdAt: "desc" },
          select: { status: true, paymentUrl: true, createdAt: true },
        },
      },
    });
    if (existing) {
      if (existing.userId !== userId) return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
      const live = existing.paymentAttempts.find((attempt) => isLivePaymentAttempt(attempt.status, attempt.createdAt));
      if (live?.paymentUrl && (live.status === "INITIATED" || live.status === "AUTHORIZED")) {
        return NextResponse.json({
          success: true,
          orderId: existing.publicOrderId,
          paymentUrl: live.paymentUrl,
          alreadyExists: true,
        });
      }
      if (live || existing.paidAt) {
        return NextResponse.json({ error: "Платёж уже обрабатывается" }, { status: 409 });
      }
      if (
        existing.gamepassId !== input.gamepassId ||
        existing.robloxUsername?.toLowerCase() !== input.username.toLowerCase()
      ) {
        return NextResponse.json({ error: "Данные сохранённого заказа изменились. Создайте новый заказ." }, { status: 409 });
      }

      const robloxUser = await getRobloxUser(input.username);
      if (!robloxUser) return NextResponse.json({ error: "Roblox-пользователь не найден" }, { status: 404 });
      const gamepass = await getCheckoutGamepassDetails(input.gamepassId, {
        id: robloxUser.id,
        username: String(robloxUser.name ?? input.username),
      });
      if (!gamepass) return NextResponse.json({ error: "Геймпасс не найден" }, { status: 404 });
      validateCheckoutGamepass(
        { requestedRobux: existing.amount, bonusRobux: 0 },
        gamepass,
        Number(robloxUser.id),
      );

      const retry = await createPaymentRetry({
        orderId: existing.id,
        idempotencyKey: input.idempotencyKey,
        receiptEmail: input.receiptEmail.toLowerCase(),
      });
      try {
        const payment = await initializePayment({
          orderId: existing.id,
          publicOrderId: retry.publicOrderId,
          providerOrderId: retry.providerOrderId,
          attemptId: retry.attempt.id,
          amountKopecks: retry.attempt.amountKopecks,
          receiptEmail: input.receiptEmail.toLowerCase(),
          statusToken: retry.statusToken,
        });
        return NextResponse.json({
          success: true,
          orderId: retry.publicOrderId,
          statusToken: retry.statusToken,
          paymentUrl: payment.paymentUrl,
          retried: true,
          attemptNumber: retry.attemptNumber,
        }, { status: 201 });
      } catch {
        return NextResponse.json({
          error: "Банк временно не создал платёж. Нажмите «Оплатить» ещё раз — заказ сохранён.",
          retryable: true,
        }, { status: 502 });
      }
    }

    const quote = await prisma.priceQuote.findUnique({
      where: { id: input.quoteId },
      include: { policy: { select: { version: true } } },
    });
    const checkedQuote = validateCheckoutQuote(quote, userId);

    const robloxUser = await getRobloxUser(input.username);
    if (!robloxUser) return NextResponse.json({ error: "Roblox-пользователь не найден" }, { status: 404 });
    const gamepass = await getCheckoutGamepassDetails(input.gamepassId, {
      id: robloxUser.id,
      username: String(robloxUser.name ?? input.username),
    });
    if (!gamepass) return NextResponse.json({ error: "Геймпасс не найден" }, { status: 404 });
    validateCheckoutGamepass(checkedQuote, gamepass, Number(robloxUser.id));

    const created = await createCanonicalWebOrder({
      quote: checkedQuote,
      userId,
      username: String(robloxUser.name ?? input.username),
      gamepassId: input.gamepassId,
      receiptEmail: input.receiptEmail.toLowerCase(),
      idempotencyKey: input.idempotencyKey,
      termsIpAddress: consentIp(req),
      termsUserAgent: req.headers.get("user-agent"),
    });

    try {
      const payment = await initializePayment({
        orderId: created.order.id,
        publicOrderId: created.order.publicOrderId!,
        providerOrderId: created.attempt.publicOrderId,
        attemptId: created.attempt.id,
        amountKopecks: created.attempt.amountKopecks,
        receiptEmail: input.receiptEmail.toLowerCase(),
        statusToken: created.statusToken,
      });
      return NextResponse.json({
        success: true,
        orderId: created.order.publicOrderId,
        statusToken: created.statusToken,
        paymentUrl: payment.paymentUrl,
      }, { status: 201 });
    } catch {
      return NextResponse.json({
        error: "Банк временно не создал платёж. Нажмите «Оплатить» ещё раз — заказ сохранён.",
        retryable: true,
      }, { status: 502 });
    }
  } catch (error) {
    if (error instanceof WebOrderError) {
      const status = error.code.startsWith("GAMEPASS_") ? 409 : 400;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }
    if (error instanceof PaymentRetryError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "Этот запрос уже обрабатывается" }, { status: 409 });
    }
    console.error("[orders/create] canonical order failed", error);
    return NextResponse.json({ error: "Не удалось создать заказ" }, { status: 500 });
  }
}
