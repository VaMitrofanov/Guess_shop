import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { PrismaClientWithWb } from "@/types/prisma-wb";

// Typed cast — WbCode delegate is added after `prisma generate` is run locally
const db = prisma as unknown as PrismaClientWithWb;

/**
 * Send a Telegram message to a single chat_id.
 * Returns true on success, false on failure (logs the error).
 */
async function sendTelegramMessage(token: string, chatId: string, text: string): Promise<boolean> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`[wb-code] TG error for chat_id=${chatId}: HTTP ${res.status} — ${body}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[wb-code] TG fetch exception for chat_id=${chatId}:`, err);
    return false;
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const rawCode: string = (body?.code ?? "").toString().trim().toUpperCase();

    if (!rawCode || rawCode.length < 7) {
      return NextResponse.json(
        { error: "Введите полный 7-значный код с карточки" },
        { status: 400 }
      );
    }

    // ── 1. Lookup code in DB ───────────────────────────────────────────────
    const wbCode = await db.wbCode.findUnique({
      where: { code: rawCode },
    });

    if (!wbCode) {
      return NextResponse.json(
        { error: "Код не найден. Проверьте правильность ввода." },
        { status: 404 }
      );
    }

    if (wbCode.isUsed) {
      return NextResponse.json(
        { error: "Этот код уже был активирован ранее." },
        { status: 409 }
      );
    }

    // ── 2. Mark as used (atomic update) ───────────────────────────────────
    await db.wbCode.update({
      where: { id: wbCode.id },
      data: {
        isUsed: true,
        usedAt: new Date(),
      },
    });

    // ── 3. Telegram notification ───────────────────────────────────────────
    // TG_CHAT_ID may contain multiple IDs separated by commas, e.g. "111,222,333"
    const token = process.env.TG_TOKEN;
    const chatIds = (process.env.TG_CHAT_ID ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);

    if (token && chatIds.length > 0) {
      const text =
        `✅ Код ${wbCode.code} (Номинал ${wbCode.denomination} R$) активирован, пользователь читает инструкцию`;

      // Await all sends — Vercel terminates the function after response is sent,
      // so fire-and-forget fetch calls are silently dropped.
      await Promise.all(chatIds.map((chatId) => sendTelegramMessage(token, chatId, text)));
    } else {
      console.warn("[wb-code] TG_TOKEN or TG_CHAT_ID not set — skipping notify");
    }

    // ── 4. Return denomination so the client can personalise the UI ────────
    return NextResponse.json({
      ok: true,
      denomination: wbCode.denomination,
    });
  } catch (err) {
    console.error("[wb-code] Unexpected error:", err);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}
