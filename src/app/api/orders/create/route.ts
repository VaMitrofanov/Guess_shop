import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
import { initTinkoffPayment } from "@/lib/tinkoff";
import { getRobloxUser } from "@/lib/roblox";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";

const CreateOrderSchema = z.object({
  username: z.string().min(1),
  amountRobux: z.number().int().min(100),
  productId: z.string().optional(),
  method: z.string().default("Gamepass"),
  gamepassId: z.string().optional(), // If method is gamepass
});

const DEFAULT_RATE = 0.85; // 1 Robux = 0.85 RUB

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const body = await req.json();
    const validated = CreateOrderSchema.safeParse(body);

    if (!validated.success) {
      return NextResponse.json({ error: "Сумма должна быть не менее 100 Robux", details: validated.error.issues }, { status: 400 });
    }

    const { username, amountRobux, productId, method, gamepassId } = validated.data;

    // 1. Verify user exists on Roblox
    const robloxUser = await getRobloxUser(username);
    if (!robloxUser) {
      return NextResponse.json({ error: "Roblox user not found" }, { status: 404 });
    }

    // 2. Fetch product or calculate price
    let amountRUB = 0;
    let finalProductId = productId || null;

    if (productId) {
      const product = await prisma.product.findUnique({ where: { id: productId } });
      if (!product || !product.isActive) {
        return NextResponse.json({ error: "Product not found or inactive" }, { status: 404 });
      }
      amountRUB = product.rubPrice;
    } else {
      amountRUB = Math.round(amountRobux * DEFAULT_RATE);
    }

    // 3. Create the order in DB
    const order = await prisma.order.create({
      data: {
        userId: (session?.user as any)?.id || null,
        customerRobloxUser: username,
        amountRobux,
        amountRUB,
        status: "PENDING",
        method,
        gamepassId,
        productId: finalProductId || "default-calc", 
      },
    });

    // 4. Initialize Tinkoff payment
    const payment = await initTinkoffPayment(order.id, amountRUB, "customer@example.com");

    if (!payment.Success) {
      await prisma.order.update({ where: { id: order.id }, data: { status: "FAILED" } });
      return NextResponse.json({ error: "Payment initialization failed", details: payment.Message }, { status: 500 });
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
