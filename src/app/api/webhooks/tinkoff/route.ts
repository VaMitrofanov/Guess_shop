import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyTinkoffSignature } from "@/lib/tinkoff";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // 1. Verify Tinkoff SHA-256 signature
    const isValid = verifyTinkoffSignature(body);
    if (!isValid) {
      console.warn("[Tinkoff] Invalid webhook signature from", req.headers.get("x-forwarded-for"));
      return new NextResponse("OK", { status: 200 }); // Always return OK to Tinkoff
    }

    const { OrderId, Status } = body;

    if (Status === "CONFIRMED") {
      // Mark as PAID and record that fulfillment has not yet been triggered.
      // botStatus="AWAITING_FULFILLMENT" is the durable signal that lets an
      // admin (or a future retry job) identify orders where payment succeeded
      // but the automation call failed. Without this, a failed fetch() leaves
      // the order stuck in PAID with no indication that fulfillment is missing.
      const order = await prisma.order.update({
        where: { id: OrderId },
        data:  { status: "PAID", botStatus: "AWAITING_FULFILLMENT" },
      });

      console.log(
        `[Tinkoff Webhook] Order ${OrderId} marked as PAID/AWAITING_FULFILLMENT.`,
        {
          orderId:   order.id,
          paymentId: body.PaymentId,
          amount:    body.Amount,
          ip:        req.headers.get("x-forwarded-for"),
          timestamp: new Date().toISOString(),
        }
      );

      // Trigger fulfillment — separated from the status update so that a
      // failure here does NOT prevent Tinkoff from receiving "OK" (which would
      // cause Tinkoff to retry the whole webhook, potentially double-updating).
      const internalSecret = process.env.INTERNAL_WEBHOOK_SECRET;
      const appUrl         = process.env.NEXT_PUBLIC_APP_URL ?? "https://robloxbank.ru";

      if (internalSecret) {
        try {
          const fulfillRes = await fetch(
            `${appUrl}/api/orders/webhook-to-automation`,
            {
              method:  "POST",
              headers: {
                "Content-Type":  "application/json",
                "Authorization": `Bearer ${internalSecret}`,
              },
              body: JSON.stringify({
                orderId:            order.id,
                customerRobloxUser: order.customerRobloxUser,
                amountRobux:        order.amountRobux,
                method:             order.method,
              }),
              signal: AbortSignal.timeout(10_000),
            }
          );

          if (fulfillRes.ok) {
            // Fulfillment service accepted the job — update botStatus so we
            // know the handoff happened. The service itself is responsible for
            // transitioning status → FULFILLED when done.
            await prisma.order.update({
              where: { id: order.id },
              data:  { botStatus: "FULFILLMENT_TRIGGERED" },
            });
            console.log(`[Tinkoff Webhook] Fulfillment triggered for order ${OrderId}.`);
          } else {
            const errBody = await fulfillRes.text().catch(() => "(unreadable)");
            console.error(
              `[Tinkoff Webhook] Fulfillment returned HTTP ${fulfillRes.status} for order ${OrderId}: ${errBody}. ` +
              `Order stays in PAID/AWAITING_FULFILLMENT — manual retry required.`
            );
            // botStatus intentionally left as "AWAITING_FULFILLMENT"
          }
        } catch (fulfillErr) {
          console.error(
            `[Tinkoff Webhook] Fulfillment fetch threw for order ${OrderId}:`,
            fulfillErr,
            `— Order is PAID but fulfillment was NOT triggered. ` +
            `Search botStatus=AWAITING_FULFILLMENT to find retryable orders.`
          );
          // botStatus intentionally left as "AWAITING_FULFILLMENT"
        }
      }
    }

    // Tinkoff requires "OK" response
    return new NextResponse("OK", { status: 200 });
  } catch (error) {
    console.error("[Tinkoff Webhook] Error:", error);
    return new NextResponse("OK", { status: 200 }); // Still return OK to avoid Tinkoff retries
  }
}
