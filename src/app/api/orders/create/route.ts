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
import { getGamepassDetails, getRobloxUser } from "@/lib/roblox";
import { initCanonicalTinkoffPayment } from "@/lib/tinkoff";
import { isSiteAcquiringEnabled } from "@/lib/site-acquiring";

export const dynamic = "force-dynamic";

const CreateOrderSchema = z.object({
  quoteId: z.string().cuid(),
  username: z.string().trim().min(3).max(20),
  gamepassId: z.string().regex(/^\d+$/),
  receiptEmail: z.email().max(254),
  agreedToTerms: z.literal(true),
  idempotencyKey: z.uuid(),
});

function resolveClientIp(req: NextRequest): string | null {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.headers.get("x-real-ip")?.trim() || req.headers.get("cf-connecting-ip")?.trim() || null;
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

  // Launch gate: the legacy checkout must never become a back door around
  // category/legal/KKT approval. Production stays fail-closed until every
  // external gate is explicitly completed and the flag is enabled.
  if (!isSiteAcquiringEnabled()) {
    return NextResponse.json(
      { error: "Оплата на сайте пока закрыта. Воспользуйтесь Telegram или VK." },
      { status: 503, headers: { "retry-after": "3600" } },
    );
  }

  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) {
    return NextResponse.json(
      { error: "Войдите через подтверждённый VK/TG-аккаунт и обновите цену." },
      { status: 401 },
    );
  }

  const input = parsed.data;
  try {
    const existing = await prisma.wbOrder.findUnique({
      where: { webIdempotencyKey: input.idempotencyKey },
      select: {
        userId: true,
        publicOrderId: true,
        paymentAttempts: { orderBy: { createdAt: "desc" }, take: 1, select: { paymentUrl: true } },
      },
    });
    if (existing) {
      if (existing.userId !== userId) return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
      return NextResponse.json({
        success: true,
        orderId: existing.publicOrderId,
        paymentUrl: existing.paymentAttempts[0]?.paymentUrl ?? null,
        alreadyExists: true,
      });
    }

    const quote = await prisma.priceQuote.findUnique({
      where: { id: input.quoteId },
      include: { policy: { select: { version: true } } },
    });
    const checkedQuote = validateCheckoutQuote(quote, userId);

    const [robloxUser, gamepass] = await Promise.all([
      getRobloxUser(input.username),
      getGamepassDetails(input.gamepassId),
    ]);
    if (!robloxUser) return NextResponse.json({ error: "Roblox-пользователь не найден" }, { status: 404 });
    if (!gamepass) return NextResponse.json({ error: "Геймпасс не найден" }, { status: 404 });
    validateCheckoutGamepass(checkedQuote, gamepass, Number(robloxUser.id));

    const created = await createCanonicalWebOrder({
      quote: checkedQuote,
      userId,
      username: String(robloxUser.name ?? input.username),
      gamepassId: input.gamepassId,
      receiptEmail: input.receiptEmail.toLowerCase(),
      idempotencyKey: input.idempotencyKey,
      termsIpAddress: resolveClientIp(req),
    });

    try {
      const payment = await initCanonicalTinkoffPayment({
        publicOrderId: created.order.publicOrderId!,
        amountKopecks: created.attempt.amountKopecks,
        receiptEmail: input.receiptEmail.toLowerCase(),
        description: `Заказ ${created.order.publicOrderId}`,
        statusToken: created.statusToken,
      });
      await prisma.$transaction([
        prisma.paymentAttempt.update({
          where: { id: created.attempt.id },
          data: {
            paymentId: payment.paymentId,
            paymentUrl: payment.paymentUrl,
            status: "INITIATED",
            initiatedAt: new Date(),
          },
        }),
        prisma.wbOrder.update({ where: { id: created.order.id }, data: { status: "PAYMENT_PENDING" } }),
        prisma.orderEvent.create({
          data: {
            orderId: created.order.id,
            type: "PAYMENT_INITIATED",
            idempotencyKey: `payment-initiated:${created.attempt.id}`,
            payload: { paymentAttemptId: created.attempt.id, provider: "TBANK" },
          },
        }),
      ]);
      return NextResponse.json({
        success: true,
        orderId: created.order.publicOrderId,
        statusToken: created.statusToken,
        paymentUrl: payment.paymentUrl,
      }, { status: 201 });
    } catch (providerError) {
      const errorHash = crypto.createHash("sha256").update(String(providerError)).digest("hex");
      await prisma.$transaction([
        prisma.paymentAttempt.update({
          where: { id: created.attempt.id },
          data: { status: "FAILED", rawEventHash: errorHash, finalizedAt: new Date() },
        }),
        prisma.orderEvent.create({
          data: {
            orderId: created.order.id,
            type: "PAYMENT_INIT_FAILED",
            idempotencyKey: `payment-init-failed:${created.attempt.id}`,
            payload: { paymentAttemptId: created.attempt.id, errorHash },
          },
        }),
      ]);
      console.error("[orders/create] T-Bank Init failed", { orderId: created.order.publicOrderId, errorHash });
      return NextResponse.json({ error: "Банк временно не создал платёж. Заказ сохранён для проверки." }, { status: 502 });
    }
  } catch (error) {
    if (error instanceof WebOrderError) {
      const status = error.code.startsWith("GAMEPASS_") ? 409 : 400;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "Этот запрос уже обрабатывается" }, { status: 409 });
    }
    console.error("[orders/create] canonical order failed", error);
    return NextResponse.json({ error: "Не удалось создать заказ" }, { status: 500 });
  }
}
