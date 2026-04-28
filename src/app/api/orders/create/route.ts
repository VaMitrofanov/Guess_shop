import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { initTinkoffPayment } from "@/lib/tinkoff";
import { getRobloxUser } from "@/lib/roblox";
import { getStorefrontPricing } from "@/lib/pricing";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

/**
 * Current public-offer version stamp.
 *
 * Update this string EVERY time the legal copy at /legal/offer changes
 * materially (not for typos). The value is persisted on every Order so we
 * can prove which exact revision the user accepted in case of a dispute.
 *
 * Format: ISO date — matches the `lastUpdated` line at the top of the
 * offer page, which is what the user actually sees.
 */
const TERMS_VERSION = "2026-04-28";

const CreateOrderSchema = z.object({
  username: z.string().min(1),
  amountRobux: z.number().int().min(100),
  productId: z.string().optional(),
  method: z.string().default("Gamepass"),
  gamepassId: z.string().optional(),
  /**
   * Mandatory acceptance of the public offer + privacy policy.
   *
   * `z.literal(true)` rejects anything that isn't exactly `true` — guards
   * against the front-end forgetting the field, sending `"true"` as a
   * string, or sending `false`. The check below short-circuits with 400
   * before any DB write or Tinkoff call happens.
   */
  agreedToTerms: z.literal(true, {
    error: "Необходимо согласие с офертой и политикой конфиденциальности",
  }),
  /**
   * Optional client-generated idempotency key (UUID v4 recommended).
   *
   * If provided, the server will return the existing order rather than
   * creating a duplicate. This prevents double charges from double-clicks
   * or network retries. The client should generate a fresh UUID per
   * user-initiated checkout attempt and reuse it on retries.
   *
   * Stored in the Order.externalId field (no schema migration required).
   */
  idempotencyKey: z.string().uuid().optional(),
});

/**
 * Resolve the originating client IP for audit logging.
 *
 * Order of precedence (matches what's typically configured in Vercel /
 * Coolify-Caddy / nginx-proxy):
 *   1. `x-forwarded-for` — comma-separated list, first entry is the real
 *      client. Trimmed defensively because some proxies emit whitespace.
 *   2. `x-real-ip`       — single value set by nginx/Caddy when XFF isn't
 *      present.
 *   3. `cf-connecting-ip` — Cloudflare-specific header, the only reliable
 *      source when traffic enters via the CF tunnel from the X280.
 *   4. `null`            — record explicitly that we couldn't determine
 *      the IP, rather than logging a misleading "127.0.0.1".
 *
 * Note: NextRequest.ip is null in Node runtime — it only resolves on the
 * Edge runtime, which we're not using here (Prisma needs Node). So we
 * read the headers ourselves.
 */
function resolveClientIp(req: NextRequest): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    const body = await req.json();
    const validated = CreateOrderSchema.safeParse(body);

    if (!validated.success) {
      // Surface the first error verbatim so the front-end can display the
      // exact reason — particularly for the consent guard, where the
      // distinction between "missing field" and "unchecked" matters.
      const firstIssue = validated.error.issues[0];
      const message =
        firstIssue?.path.includes("agreedToTerms")
          ? "Необходимо согласие с офертой и политикой конфиденциальности"
          : firstIssue?.message ?? "Некорректные параметры заказа";

      return NextResponse.json(
        { error: message, details: validated.error.issues },
        { status: 400 },
      );
    }

    const {
      username,
      amountRobux,
      productId,
      method,
      gamepassId,
      idempotencyKey,
    } = validated.data;

    // ── Idempotency guard ─────────────────────────────────────────────────────
    // If the client sent a key we've already processed, return the existing
    // order instead of creating a duplicate. Protects against double-clicks and
    // network-level retries that would otherwise trigger two Tinkoff charges.
    if (idempotencyKey) {
      const existing = await prisma.order.findFirst({
        where:  { externalId: idempotencyKey },
        select: { id: true, paymentUrl: true, status: true },
      });
      if (existing) {
        console.log(
          `[orders/create] Idempotency hit for key=${idempotencyKey}, ` +
          `returning existing order ${existing.id}`
        );
        return NextResponse.json({
          success:      true,
          orderId:      existing.id,
          paymentUrl:   existing.paymentUrl,
          alreadyExists: true,
        });
      }
    }

    // Acceptance evidence triple. Captured here, on the server, BEFORE any
    // external call — so even if the rest of the flow fails (Tinkoff down,
    // Roblox API rejects), we still know who accepted what and when, in
    // case the user later disputes the consent itself.
    const termsAcceptedAt = new Date();
    const termsIpAddress = resolveClientIp(req);

    // 1. Verify user exists on Roblox
    const robloxUser = await getRobloxUser(username);
    if (!robloxUser) {
      return NextResponse.json({ error: "Roblox user not found" }, { status: 404 });
    }

    // 2. Calculate price dynamically
    let amountRUB = 0;
    const finalProductId = productId || null;

    if (productId) {
      // Fixed-price product from catalog
      const product = await prisma.product.findUnique({ where: { id: productId } });
      if (!product || !product.isActive) {
        return NextResponse.json({ error: "Product not found or inactive" }, { status: 404 });
      }
      amountRUB = product.rubPrice;
    } else {
      // Dynamic pricing from market rates (includes Roblox 30% tax + margins)
      const pricing = await getStorefrontPricing();
      amountRUB = Math.round(amountRobux * pricing.finalRubPerRobux);
    }

    // 3. Create the order in DB. The terms-acceptance triple is written
    //    atomically with the rest of the row — there is no window in
    //    which an Order exists without its consent record.
    //    externalId is used as the idempotency key storage (nullable String,
    //    no schema migration required).
    const order = await prisma.order.create({
      data: {
        userId: (session?.user as { id?: string } | undefined)?.id ?? null,
        customerRobloxUser: username,
        amountRobux,
        amountRUB,
        status: "PENDING",
        method,
        gamepassId,
        productId: finalProductId || "default-calc",
        termsAcceptedAt,
        termsVersion: TERMS_VERSION,
        termsIpAddress,
        externalId: idempotencyKey ?? null,
      },
    });

    // 4. Initialize Tinkoff payment
    const payment = await initTinkoffPayment(order.id, amountRUB, "customer@example.com");

    if (!payment.Success) {
      await prisma.order.update({ where: { id: order.id }, data: { status: "FAILED" } });
      return NextResponse.json(
        { error: "Payment initialization failed", details: payment.Message },
        { status: 500 },
      );
    }

    // 5. Save payment details and return URL
    const updatedOrder = await prisma.order.update({
      where: { id: order.id },
      data: {
        tinkoffPaymentID: payment.PaymentId,
        paymentUrl: payment.PaymentURL,
      },
    });

    return NextResponse.json({
      success: true,
      orderId: updatedOrder.id,
      paymentUrl: payment.PaymentURL,
    });
  } catch (error) {
    console.error("Order Creation Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
