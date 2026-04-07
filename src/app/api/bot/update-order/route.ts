import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import crypto from "crypto";

export const dynamic = "force-dynamic";

const UpdateSchema = z.object({
  orderId:    z.string().min(1),
  botStatus:  z.enum(["PENDING", "PROCESSING", "SUCCESS", "ERROR", "BRIDGE_ERROR"]),
  externalId: z.string().optional(),
  error:      z.string().max(1000).optional(),
});

/** Timing-safe token verification */
function verifyBotToken(req: NextRequest): boolean {
  const botToken = process.env.BOT_API_TOKEN;
  if (!botToken || botToken.length < 32) {
    console.error("[Bot API] BOT_API_TOKEN not set or too short (min 32 chars)");
    return false;
  }
  const authHeader = req.headers.get("Authorization");
  const provided   = authHeader?.replace("Bearer ", "") ?? "";

  try {
    const a = Buffer.from(crypto.createHash("sha256").update(provided).digest("hex"),  "hex");
    const b = Buffer.from(crypto.createHash("sha256").update(botToken).digest("hex"),  "hex");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!verifyBotToken(req)) {
      // Log failure for monitoring (without exposing token details)
      console.warn("[Bot API] Unauthorized access attempt from", req.headers.get("x-forwarded-for"));
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body  = await req.json();
    const parsed = UpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation error", details: parsed.error.flatten() }, { status: 400 });
    }

    const { orderId, botStatus, externalId } = parsed.data;

    const statusUpdate: Record<string, unknown> = {
      botStatus,
      externalId: externalId ?? undefined,
    };

    if (botStatus === "SUCCESS") statusUpdate.status = "FULFILLED";
    if (botStatus === "ERROR")   statusUpdate.status = "FAILED";

    const updatedOrder = await prisma.order.update({
      where: { id: orderId },
      data:  statusUpdate,
    });

    console.log(`[Bot API] Order ${orderId} → botStatus=${botStatus}`);
    return NextResponse.json({ success: true, order: updatedOrder });
  } catch (err) {
    console.error("[Bot API] Error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
