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
      const order = await prisma.order.update({
        where: { id: OrderId },
        data:  { status: "PAID" },
      });

      console.log(`[Tinkoff Webhook] Order ${OrderId} marked as PAID.`);

      // Trigger fulfillment via internal endpoint with secret token
      const internalSecret = process.env.INTERNAL_WEBHOOK_SECRET;
      const appUrl         = process.env.NEXT_PUBLIC_APP_URL ?? "https://robloxbank.ru";

      if (internalSecret) {
        await fetch(`${appUrl}/api/orders/webhook-to-automation`, {
          method:  "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${internalSecret}`,
          },
          body: JSON.stringify({
            orderId:            order.id,
            customerRobloxUser: order.customerRobloxUser,
            amountRobux:        order.amountRobux,
            method:             order.method,
          }),
          signal: AbortSignal.timeout(10_000),
        }).catch((e) => console.error("[Tinkoff Webhook] Failed to trigger automation:", e));
      }
    }

    // Tinkoff requires "OK" response
    return new NextResponse("OK", { status: 200 });
  } catch (error) {
    console.error("[Tinkoff Webhook] Error:", error);
    return new NextResponse("OK", { status: 200 }); // Still return OK to avoid Tinkoff retries
  }
}
