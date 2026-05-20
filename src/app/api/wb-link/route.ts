/**
 * /api/wb-link — "Corridor" endpoint.
 *
 * Reads wb_code from the JWT session (set during VK login in auth.ts authorize).
 * If not yet linked, attaches the userId to the WbCode record, then redirects
 * to the VK group messages page.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import type { PrismaClientWithWb } from "@/types/prisma-wb";

const db = prisma as unknown as PrismaClientWithWb;

const GUIDE_URL = "/guide?source=wb";

export async function GET(request: NextRequest) {
  const session = await auth();

  if (!session?.user) {
    return NextResponse.redirect(new URL(GUIDE_URL, request.url));
  }

  const userId = (session.user as any).id as string | undefined;
  if (!userId) {
    return NextResponse.redirect(new URL(GUIDE_URL, request.url));
  }

  // wb_code comes from the JWT session (saved during authorize in auth.ts)
  const wbCode = ((session.user as any).wb_code as string | null)?.trim().toUpperCase();
  const isGuideMode = (session.user as any).is_guide_mode === true;

  if (wbCode && wbCode.length === 7) {
    try {
      await db.wbCode.update({
        where: { code: wbCode },
        // isUsed: false puts the code into provisional CLAIMED state —
        // the bot's isUsed+userId guard will not block the user, and the
        // final transaction (gamepass submission) sets isUsed: true.
        data: { userId, status: "CLAIMED", isUsed: false },
      });
    } catch (err) {
      // Non-fatal: code may already be linked or not exist
      console.error("[wb-link] Failed to link WbCode:", err);
    }
  }

  // In guide mode, pass the GD prefix so the VK bot sends the guide welcome message.
  const refCode = wbCode ? (isGuideMode ? `GD${wbCode}` : wbCode) : null;
  const targetUrl = refCode
    ? `https://vk.me/bankroblox?ref=${refCode}`
    : "https://vk.me/bankroblox";

  return NextResponse.redirect(new URL(targetUrl));
}
