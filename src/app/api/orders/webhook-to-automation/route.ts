import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  try {
    const { orderId, customerRobloxUser, amountRobux, method } = await req.json();

    // 1. Verify that the order is actually PAID in our DB before sending to n8n
    const order = await prisma.order.findUnique({
      where: { id: orderId }
    });

    if (!order || order.status !== "PAID") {
      return NextResponse.json({ error: "Order not paid" }, { status: 403 });
    }

    // 2. Decide where to send: Bot or n8n
    const botUrl = process.env.LOCAL_BOT_URL;
    const n8nUrl = process.env.N8N_WEBHOOK_URL;
    
    if (!botUrl && !n8nUrl) {
      console.warn("No automation endpoint (BOT_URL or N8N_WEBHOOK_URL) found. Fulfillment skipped.");
      return NextResponse.json({ error: "Automation config missing" }, { status: 500 });
    }

    const payload = {
        orderId: order.id,
        customerRobloxUser: customerRobloxUser,
        amountRobux: amountRobux,
        method: method,
        gamepassId: order.gamepassId,
        timestamp: new Date().toISOString(),
    };

    try {
        const targetUrl = botUrl || n8nUrl;
        console.log(`[Automation] Routing order ${orderId} to ${targetUrl}`);
        
        await fetch(targetUrl as string, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });

        // Update botStatus to PROCESSING
        await prisma.order.update({
            where: { id: orderId },
            data: { botStatus: "PROCESSING" }
        });

        return NextResponse.json({ success: true, target: botUrl ? "BOT" : "N8N" });
    } catch (e) {
        console.error(`[Automation] Bridge failed:`, e);
        await prisma.order.update({
            where: { id: orderId },
            data: { botStatus: "BRIDGE_ERROR" }
        });
        return NextResponse.json({ error: "Bridge delivery failed" }, { status: 500 });
    }

  } catch (error) {
    console.error("Automation Webhook Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
