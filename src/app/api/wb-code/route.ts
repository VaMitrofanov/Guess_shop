import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { PrismaClientWithWb } from "@/types/prisma-wb";
import { sendTelegramMessage } from "@/lib/telegram";

const db = prisma as unknown as PrismaClientWithWb;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const rawCode: string = (body?.code ?? "").toString().trim().toUpperCase();
    const sessionId: string = body?.sessionId ?? "";

    if (!rawCode || rawCode.length < 7) {
      return NextResponse.json(
        { error: "Введите полный 7-значный код с карточки" },
        { status: 400 }
      );
    }

    if (!sessionId) {
      return NextResponse.json(
        { error: "Отсутствует идентификатор сессии" },
        { status: 400 }
      );
    }

    const now = new Date();
    let isFirstActivation = false;

    // ── 1. Atomic lookup + reservation in a single transaction ────────
    const txResult = await (db as any).$transaction(async (tx: any) => {
      const wbCode = await tx.wbCode.findFirst({
        where: { code: { equals: rawCode, mode: "insensitive" } },
      });

      if (!wbCode) {
        throw { status: 404, message: "Код не найден. Проверьте правильность ввода." };
      }

      if (wbCode.status === "CLAIMED" || (wbCode.isUsed && wbCode.userId)) {
        throw { status: 409, message: "Этот код уже был активирован ранее." };
      }

      const reserveTime = new Date(now.getTime() + 60 * 60 * 1000); // +60 mins

      if (wbCode.status === "RESERVED") {
        if (wbCode.sessionId === sessionId) {
          // Same session, just extend reservation
          const updated = await tx.wbCode.update({
            where: { id: wbCode.id },
            data: { reservedUntil: reserveTime },
          });
          return { wbCode: updated, isFirstActivation: false };
        } else {
          // Different session.
          if (wbCode.reservedUntil && wbCode.reservedUntil > now) {
            // Hijack the session: since the user knows the physical code, we transfer the reservation.
            const updated = await tx.wbCode.update({
              where: { id: wbCode.id },
              data: { sessionId: sessionId, reservedUntil: reserveTime },
            });
            // We treat this as a session transfer, not necessarily a 'first' activation for TG notify
            return { wbCode: updated, isFirstActivation: false };
          } else {
            // Reservation expired, claim it
            const updated = await tx.wbCode.update({
              where: { id: wbCode.id },
              data: { sessionId: sessionId, reservedUntil: reserveTime },
            });
            return { wbCode: updated, isFirstActivation: true };
          }
        }
      }

      // If AVAILABLE (or isUsed=false, status=AVAILABLE)
      const updated = await tx.wbCode.update({
        where: { id: wbCode.id },
        data: {
          status: "RESERVED",
          sessionId: sessionId,
          reservedUntil: reserveTime,
          isUsed: true, // Legacy flag for backwards compat
        },
      });
      return { wbCode: updated, isFirstActivation: true };
    });

    const wbCode = txResult.wbCode;
    isFirstActivation = txResult.isFirstActivation;

    // ── 2. Telegram notification (first activation only) ──────────────────
    const token = process.env.TG_TOKEN;
    const chatIds = (process.env.TG_CHAT_ID ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);

    if (isFirstActivation) {
      if (token && chatIds.length > 0) {
        const text = `✅ Код ${wbCode.code} (Номинал ${wbCode.denomination} R$) забронирован, пользователь читает инструкцию`;
        const results = await Promise.all(
          chatIds.map((chatId) => sendTelegramMessage(token, chatId, text))
        );
        const sent = results.filter(Boolean).length;
        console.log(`[wb-code] TG notify: ${sent}/${chatIds.length} delivered for code ${wbCode.code}`);
      }
    }

    return NextResponse.json({
      ok: true,
      denomination: wbCode.denomination,
    });
  } catch (err: any) {
    if (err.status) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[wb-code] Unexpected error:", err);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}

