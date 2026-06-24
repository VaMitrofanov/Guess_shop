import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { PrismaClientWithWb } from "@/types/prisma-wb";

const db = prisma as unknown as PrismaClientWithWb;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const rawCode: string = (body?.code ?? "").toString().trim().toUpperCase();
    const sessionId: string = body?.sessionId ?? "";

    if (!rawCode || rawCode.length !== 7 || !/^[A-Z0-9]{7}$/.test(rawCode)) {
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

    // ── 1. Atomic lookup + reservation in a single transaction ────────
    const txResult = await (db as any).$transaction(async (tx: any) => {
      const wbCode = await tx.wbCode.findFirst({
        where: { code: { equals: rawCode, mode: "insensitive" } },
      });

      if (!wbCode) {
        throw { status: 404, message: "Код не найден. Проверьте правильность ввода." };
      }

      if (wbCode.isUsed && wbCode.userId) {
        throw { status: 409, message: "Этот код уже был активирован ранее." };
      }
      // Provisional state: bot claimed the code but user hasn't submitted the gamepass yet.
      // Direct them to the bot instead of showing a generic error.
      if (wbCode.status === "CLAIMED" && !wbCode.isUsed) {
        throw { status: 409, message: "Код уже активирован — продолжай в боте (Telegram или ВКонтакте). Если потерял сессию — напиши код напрямую в бот.", code: "BOT_CLAIMED" };
      }

      const reserveTime = new Date(now.getTime() + 60 * 60 * 1000); // +60 mins

      if (wbCode.status === "RESERVED") {
        if (wbCode.sessionId === sessionId) {
          // Same session, just extend reservation
          const updated = await tx.wbCode.update({
            where: { id: wbCode.id },
            data: { reservedUntil: reserveTime },
          });
          return { wbCode: updated };
        } else {
          // Different session — transfer the reservation regardless of expiry:
          // the user holds the physical card, so they win (active reservation
          // gets hijacked; expired one is simply re-claimed).
          const updated = await tx.wbCode.update({
            where: { id: wbCode.id },
            data: { sessionId: sessionId, reservedUntil: reserveTime },
          });
          return { wbCode: updated };
        }
      }

      // If AVAILABLE (or isUsed=false, status=AVAILABLE)
      const updated = await tx.wbCode.update({
        where: { id: wbCode.id },
        data: {
          status: "RESERVED",
          sessionId: sessionId,
          reservedUntil: reserveTime,
        },
      });
      return { wbCode: updated };
    });

    const wbCode = txResult.wbCode;

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

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code")?.trim().toUpperCase();
  if (!code || code.length !== 7) {
    return NextResponse.json({ error: "Invalid code" }, { status: 400 });
  }
  try {
    const wbCode = await (db as any).wbCode.findFirst({
      where: { code: { equals: code, mode: "insensitive" } },
      select: { status: true, userId: true, denomination: true },
    });
    if (!wbCode) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    // Code is "activated" if userId is set (by TG or VK) OR status is CLAIMED
    const claimed = !!(wbCode.userId || wbCode.status === "CLAIMED");

    // The provisional order tells us which channel the user picked (TG/VK) and
    // how far the order has progressed — the instruction page uses this to show
    // a single channel CTA and to reflect "order already placed".
    let platform: string | null = null;
    let orderStatus: string | null = null;
    let robloxUsername: string | null = null;
    try {
      const order = await (db as any).wbOrder.findFirst({
        where: { wbCode: { equals: code, mode: "insensitive" } },
        select: { platform: true, status: true, robloxUsername: true },
      });
      if (order) {
        platform = order.platform ?? null;
        orderStatus = order.status ?? null;
        robloxUsername = order.robloxUsername ?? null;
      }
    } catch {
      /* non-fatal — CTA falls back to showing both channels */
    }

    return NextResponse.json({ claimed, denomination: wbCode.denomination, platform, orderStatus, robloxUsername });
  } catch (err) {
    console.error("[wb-code GET] error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

