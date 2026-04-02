import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyTinkoffSignature } from "@/lib/tinkoff";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    
    // 1. Verify Tinkoff signature for security
    const isValid = verifyTinkoffSignature(body);
    if (!isValid) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
    }

    const { OrderId, Status, PaymentId } = body;

    // 2. Map Tinkoff status to Order status
    // Tinkoff CONFIRMED means payment captured.
    if (Status === "CONFIRMED") {
      const order = await prisma.order.update({
        where: { id: OrderId },
        data: { status: "PAID" },
      });

      console.log(`[Webhook] Order ${OrderId} marked as PAID.`);

      // 3. Trigger fulfillment (automation)
      // Call internal automation endpoint
      await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/orders/webhook-to-automation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: order.id,
          customerRobloxUser: order.customerRobloxUser,
          amountRobux: order.amountRobux,
          method: order.method,
        }),
      });
    }

    // 4. Return success to Tinkoff (MUST be "OK")
    return new NextResponse("OK", { status: 200 });

  } catch (error) {
    console.error("Tinkoff Webhook Error:", error);
    return new NextResponse("Error", { status: 500 });
  }
}
