/**
 * /api/wb-link — "Corridor" endpoint.
 *
 * After VK OAuth completes, next-auth redirects here (callbackUrl).
 * We read the `wb_code` cookie that was set on the client before triggering
 * signIn, find the WbCode record, and attach the authenticated userId to it.
 * Then we clear the cookie and redirect back to the WB guide page.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { cookies } from "next/headers";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { prisma } from "@/lib/prisma";
import type { PrismaClientWithWb } from "@/types/prisma-wb";

const db = prisma as unknown as PrismaClientWithWb;

const GUIDE_URL = "/guide?source=wb";

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    // Not authenticated — redirect to guide without linking
    return NextResponse.redirect(new URL(GUIDE_URL, request.url));
  }

  const userId = (session.user as any).id as string | undefined;
  if (!userId) {
    return NextResponse.redirect(new URL(GUIDE_URL, request.url));
  }

  const cookieStore = await cookies();
  const wbCode = cookieStore.get("wb_code")?.value?.trim().toUpperCase();

  if (wbCode && wbCode.length === 7) {
    try {
      await db.wbCode.update({
        where: { code: wbCode },
        data: { userId },
      });
    } catch (err) {
      // Non-fatal: code may not exist or already have a userId
      console.error("[wb-link] Failed to link WbCode:", err);
    }
  }

  // Redirect to VK group messages with the reference code
  const targetUrl = wbCode 
    ? `https://vk.me/bankroblox?ref=${wbCode}`
    : "https://vk.me/bankroblox";

  const response = NextResponse.redirect(new URL(targetUrl));
  response.cookies.set("wb_code", "", { maxAge: 0, path: "/" });
  return response;
}
