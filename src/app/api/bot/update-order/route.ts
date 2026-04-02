import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get("Authorization");
    const botToken = process.env.BOT_API_TOKEN;

    if (!botToken || authHeader !== `Bearer ${botToken}`) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const { orderId, botStatus, externalId, error } = await req.json();

    if (!orderId) {
        return NextResponse.json({ error: "Missing orderId" }, { status: 400 });
    }

    // Map botStatus to OrderStatus if needed
    // Example: If botStatus is 'SUCCESS', we might mark order as 'FULFILLED'
    const statusUpdate: any = {
        botStatus,
        externalId: externalId || undefined,
    };

    if (botStatus === "SUCCESS") {
        statusUpdate.status = "FULFILLED";
    } else if (botStatus === "ERROR") {
        statusUpdate.status = "FAILED";
    }

    const updatedOrder = await prisma.order.update({
        where: { id: orderId },
        data: statusUpdate,
    });

    console.log(`[Bot API] Order ${orderId} updated to ${botStatus}`);

    return NextResponse.json({ success: true, order: updatedOrder });
  } catch (err) {
    console.error("Bot Callback Error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
