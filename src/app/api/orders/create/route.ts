import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { auth } from "@/auth";
import {
  createCanonicalWebOrder,
  validateCheckoutQuote,
  WebOrderError,
  type CheckoutPart,
} from "@/lib/canonical-web-order";
import { MAX_AUTO_PARTS } from "@/lib/gamepass-plan";
import { prisma } from "@/lib/prisma";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { getCheckoutGamepassDetails, getGamepassDetails, getRobloxUser, getRobloxUserById } from "@/lib/roblox";
import {
  acceptGamepasses,
  ownerSwitchNote,
  type AcceptanceResult,
} from "../../../../../bots/shared/gamepass-acceptance";
import { initCanonicalTinkoffPayment } from "@/lib/tinkoff";
import { siteAcquiringDecision } from "@/lib/site-acquiring";
import { revertWebOrderBenefits } from "@/lib/web-order-benefits";
import { findBlockingCorridorOrder } from "@/lib/active-order";
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
  /**
   * Набор из нескольких пассов — то же, что коридор ВБ шлёт в `select-gamepass`.
   * Первая часть обязана совпадать с `gamepassId`: он остаётся «головой» заказа
   * (по нему заказ ищется и он же едет в карточку админа).
   */
  // Одна часть допустима и значит «обычный одиночный заказ»: до 24.09.2026 здесь
  // стояло `.min(2)`, и план «хватит одного пасса» получал 400.
  parts: z
    .array(z.object({ gamepassId: z.string().regex(/^\d+$/), amount: z.number().int().positive() }))
    .min(1)
    .max(MAX_AUTO_PARTS)
    .optional(),
  receiptEmail: z.email().max(254),
  agreedToTerms: z.literal(true),
  idempotencyKey: z.uuid(),
});

/**
 * Приём пассов под заказ сайта — то же правило, что у гейта коридора ВБ
 * (`bots/shared/gamepass-acceptance.ts`): пасс продаётся, цена каждой части
 * сходится с её номиналом, весь набор — одного владельца, получатель — владелец
 * пасса. Отличие одно и намеренное: Roblox молчит — отказываем с просьбой
 * повторить, потому что деньги ещё не списаны.
 */
async function acceptForCheckout(input: {
  orderAmount: number;
  gamepassId: string;
  parts?: readonly { gamepassId: string; amount: number }[] | null;
  username: string;
}) {
  const robloxUser = await getRobloxUser(input.username).catch(() => null);
  const owner = robloxUser?.id
    ? { id: robloxUser.id, username: String(robloxUser.name ?? input.username) }
    : null;
  const accepted = await acceptGamepasses({
    orderAmount: input.orderAmount,
    gamepassId: input.gamepassId,
    parts: input.parts ?? null,
    claimedNick: owner?.username ?? input.username,
    getDetails: async (id) => {
      // Список пассов названного аккаунта — запасной источник, когда карточка
      // пасса у Roblox не отвечает (`getCheckoutGamepassDetails`).
      const d = owner ? await getCheckoutGamepassDetails(id, owner) : await getGamepassDetails(id);
      return d ? { price: d.price, isActive: d.isActive, creatorId: d.creatorId, creatorName: d.creatorName ?? null } : null;
    },
    resolveCreatorName: async (creatorId) => (await getRobloxUserById(creatorId))?.name ?? null,
    onUnreachable: "reject",
  });
  return accepted;
}

function acceptanceErrorResponse(accepted: Extract<AcceptanceResult, { ok: false }>) {
  const status = accepted.code === "ROBLOX_UNAVAILABLE" ? 503 : accepted.code === "BAD_SPLIT" || accepted.code === "TOO_MANY_PARTS" ? 400 : 409;
  return NextResponse.json(
    {
      error: accepted.message,
      code: accepted.code,
      expectedPrice: accepted.expectedPrice,
      gamepassId: accepted.gamepassId,
      retryable: accepted.code === "ROBLOX_UNAVAILABLE",
    },
    { status, headers: accepted.code === "ROBLOX_UNAVAILABLE" ? { "retry-after": "60" } : undefined },
  );
}

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
        splitGamepasses: { orderBy: { position: "asc" }, select: { gamepassId: true, amount: true } },
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
      // Сверяем пасс, а не ник: получатель заказа — владелец пасса, и он мог
      // отличаться от набранного ника с самого начала (пометка в заметке).
      if (existing.gamepassId !== input.gamepassId) {
        return NextResponse.json({ error: "Данные сохранённого заказа изменились. Создайте новый заказ." }, { status: 409 });
      }

      // Перепроверяем СОХРАНЁННЫЙ набор: до 24.09.2026 здесь головной пасс
      // набора сверялся с суммой всего заказа («цена должна быть 2858» на пассе
      // 2143), и повтор оплаты заказа-набора упирался в ложный отказ.
      const recheck = await acceptForCheckout({
        orderAmount: existing.amount,
        gamepassId: existing.gamepassId ?? input.gamepassId,
        parts: existing.splitGamepasses.length > 1 ? existing.splitGamepasses : null,
        username: existing.robloxUsername ?? input.username,
      });
      if (!recheck.ok) return acceptanceErrorResponse(recheck);

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

    // Коридор WB закрывает кассу. Покупатель с картой Wildberries УЖЕ заплатил:
    // пока его заказ ждёт геймпасс, вторая оплата — не выручка, а деньги,
    // которые придётся возвращать. Разбор 07.09.2026 по `JS6NQB9`: заказ на
    // 500 R$ ждал геймпасс, а покупатель из кабинета уехал в кассу и завёл
    // `WEB-07E4BC…` на те же 500 R$ с тем же ником и тем же геймпассом.
    //
    // Проверка стоит ЗДЕСЬ, после ветки «заказ уже создан»: повтор оплаты
    // существующего заказа блокировать нельзя — он уже заведён, и человеку
    // осталось только дойти до банка. Закрываем ровно создание НОВОГО.
    //
    // Отказ мягкий и с адресом: ответ несёт ссылку «продолжить». Как только
    // заказ собран (`PENDING`), запрет снимается сам — дальше свободное плавание.
    const blocking = await findBlockingCorridorOrder(userId).catch(() => null);
    if (blocking) {
      return NextResponse.json(
        {
          error: `Твой заказ ${blocking.ref} на ${blocking.amount} R$ уже оплачен на Wildberries — платить второй раз не нужно. Закончи его: осталось выбрать геймпасс.`,
          code: "CORRIDOR_ORDER_ACTIVE",
          continueHref: blocking.href,
          orderRef: blocking.ref,
          orderAmount: blocking.amount,
        },
        { status: 409 },
      );
    }

    const quote = await prisma.priceQuote.findUnique({
      where: { id: input.quoteId },
      include: { policy: { select: { version: true } } },
    });
    const checkedQuote = validateCheckoutQuote(quote, userId);

    // Сумма заказа — оплаченное ПЛЮС бонус: пассы закрывают всё, что придёт на
    // аккаунт. Набор из одной части — обычный одиночный заказ.
    const accepted = await acceptForCheckout({
      orderAmount: checkedQuote.requestedRobux + checkedQuote.bonusRobux,
      gamepassId: input.gamepassId,
      parts: input.parts,
      username: input.username,
    });
    if (!accepted.ok) return acceptanceErrorResponse(accepted);
    if (!accepted.recipient) {
      return NextResponse.json(
        { error: "Не удалось определить владельца геймпасса — проверь ник и ссылку.", code: "NO_NICK" },
        { status: 422 },
      );
    }
    const parts: CheckoutPart[] | undefined = accepted.split ? accepted.parts : undefined;

    const created = await createCanonicalWebOrder({
      quote: checkedQuote,
      userId,
      username: accepted.recipient,
      gamepassId: input.gamepassId,
      parts,
      receiptEmail: input.receiptEmail.toLowerCase(),
      idempotencyKey: input.idempotencyKey,
      termsIpAddress: consentIp(req),
      termsUserAgent: req.headers.get("user-agent"),
      adminNote: accepted.ownerSwitchedFrom
        ? ownerSwitchNote({ from: accepted.ownerSwitchedFrom, to: accepted.recipient, gamepassId: input.gamepassId })
        : null,
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
