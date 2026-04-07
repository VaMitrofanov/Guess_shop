import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import crypto from "crypto";

export const dynamic = "force-dynamic";

/** Internal-only endpoint: must be called with INTERNAL_WEBHOOK_SECRET */
function verifyInternalToken(req: NextRequest): boolean {
  const secret = process.env.INTERNAL_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[Automation] INTERNAL_WEBHOOK_SECRET not set");
    return false;
  }
  const authHeader = req.headers.get("Authorization");
  const token      = authHeader?.replace("Bearer ", "") ?? "";

  // Timing-safe comparison
  try {
    const a = Buffer.from(crypto.createHash("sha256").update(token).digest("hex"),  "hex");
    const b = Buffer.from(crypto.createHash("sha256").update(secret).digest("hex"), "hex");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  try {
    // Auth: only Tinkoff webhook (same process) or internal services may call this
    if (!verifyInternalToken(req)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { orderId, customerRobloxUser, amountRobux, method } = await req.json();
    if (!orderId || typeof orderId !== "string") {
      return NextResponse.json({ error: "Missing orderId" }, { status: 400 });
    }

    // Double-check: order must be PAID in DB
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.status !== "PAID") {
      return NextResponse.json({ error: "Order not paid or not found" }, { status: 403 });
    }

    const botUrl = process.env.LOCAL_BOT_URL;
    const n8nUrl = process.env.N8N_WEBHOOK_URL;

    if (!botUrl && !n8nUrl) {
      console.warn("[Automation] No automation endpoint configured. Fulfillment skipped.");
      return NextResponse.json({ error: "Automation config missing" }, { status: 500 });
    }

    const payload = {
      orderId:             order.id,
      customerRobloxUser:  customerRobloxUser ?? order.customerRobloxUser,
      amountRobux:         amountRobux        ?? order.amountRobux,
      method:              method             ?? order.method,
      gamepassId:          order.gamepassId,
      timestamp:           new Date().toISOString(),
    };

    const targetUrl = botUrl ?? n8nUrl!;
    console.log(`[Automation] Routing order ${orderId} to ${targetUrl}`);

    try {
      await fetch(targetUrl, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload),
        signal:  AbortSignal.timeout(10_000),
      });

      await prisma.order.update({ where: { id: orderId }, data: { botStatus: "PROCESSING" } });
      return NextResponse.json({ success: true, target: botUrl ? "BOT" : "N8N" });
    } catch (e) {
      console.error("[Automation] Bridge failed:", e);
      await prisma.order.update({ where: { id: orderId }, data: { botStatus: "BRIDGE_ERROR" } });
      return NextResponse.json({ error: "Bridge delivery failed" }, { status: 500 });
    }
  } catch (error) {
    console.error("[Automation] Unexpected error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
