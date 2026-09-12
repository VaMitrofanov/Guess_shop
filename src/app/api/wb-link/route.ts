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
import { vkBotHref } from "@/lib/bot-links";
import { publicAppOrigin } from "@/lib/email-account-lifecycle";

const db = prisma as unknown as PrismaClientWithWb;

const GUIDE_URL = "/guide?source=wb";

/**
 * Адрес инструкции строится от ПУБЛИЧНОГО origin, а не от `request.url`.
 *
 * Внутри контейнера `request.url` — это `http://0.0.0.0:3001/api/wb-link`, и
 * редирект уходил на `https://0.0.0.0:3001/guide?source=wb`: покупатель без
 * живой сессии (окно VK ID не вернулось, кука протухла) упирался в мёртвый
 * адрес вместо инструкции. Проверено на проде 08.09.2026.
 */
function guideRedirect() {
  return NextResponse.redirect(new URL(GUIDE_URL, publicAppOrigin()));
}

export async function GET(_request: NextRequest) {
  const session = await auth();

  if (!session?.user) {
    return guideRedirect();
  }

  const userId = (session.user as any).id as string | undefined;
  if (!userId) {
    return guideRedirect();
  }

  // wb_code comes from the JWT session (saved during authorize in auth.ts)
  const wbCode = ((session.user as any).wb_code as string | null)?.trim().toUpperCase();
  const isGuideMode = (session.user as any).is_guide_mode === true;

  if (wbCode && wbCode.length === 7) {
    try {
      await db.wbCode.update({
        /* `not: CLAIMED` пропустил бы и аннулированный код: условие отсекает
           только уже активированные, а не отменённые. Статус здесь называется
           явно — список короткий и закрытый. */
        where: { code: wbCode, status: { in: ["AVAILABLE", "RESERVED"] } },
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
  // Без кода — метка `WBHELP`, а не голый диалог: бот тогда ищет заказ самого
  // гостя и просит код, вместо велкома «купи напрямую» (`src/lib/bot-links.ts`).
  const targetUrl = vkBotHref(refCode);

  return NextResponse.redirect(new URL(targetUrl));
}
