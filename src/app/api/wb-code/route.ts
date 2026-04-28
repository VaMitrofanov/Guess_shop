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

    // ── 1 + 2. Atomic lookup + web-activation in a single transaction ────────
    //
    // findFirst with mode:"insensitive" handles any stored-case variations.
    // updateMany with isUsed:false is a single SQL UPDATE — only one concurrent
    // web request can flip isUsed to true; all others get count=0.
    //
    // NOTE: the bot flow defers its own isUsed write to the gamepass-submission
    // step (wrapped in a separate $transaction there). The WHERE clause in bot
    // handlers targets userId:null, so a web-activated code (isUsed=true,
    // userId=null) can still be claimed by the bot without conflict.
    let wbCode: any   = null;
    let isFirstActivation = false;

    try {
      const txResult = await (db as any).$transaction(async (tx: any) => {
        const found = await tx.wbCode.findFirst({
          where: { code: { equals: rawCode, mode: "insensitive" } },
        });
        if (!found) return { wbCode: null, count: 0 };

        const upd = await tx.wbCode.updateMany({
          where: { code: { equals: rawCode, mode: "insensitive" }, isUsed: false },
          data:  { isUsed: true, usedAt: new Date() },
        });
        console.log(`[wb-code] updateMany count=${upd.count} for code=${found.code}`);
        return { wbCode: found, count: upd.count };
      });

      wbCode            = txResult.wbCode;
      isFirstActivation = txResult.count > 0;
    } catch (txErr) {
      console.error("[wb-code] Transaction error:", txErr);
      return NextResponse.json(
        { error: "Внутренняя ошибка сервера" },
        { status: 500 }
      );
    }

    if (!wbCode) {
      return NextResponse.json(
        { error: "Код не найден. Проверьте правильность ввода." },
        { status: 404 }
      );
    }

    if (!isFirstActivation) {
      // Re-read to determine why updateMany returned 0
      const current = await (db as any).wbCode.findFirst({
        where: { code: { equals: rawCode, mode: "insensitive" } },
      });

      if (current?.userId) {
        // Code is fully claimed by a linked user — hard reject
        return NextResponse.json(
          { error: "Этот код уже был активирован ранее." },
          { status: 409 }
        );
      }

      // isUsed=true but userId=null: a previous web session already activated
      // this code and the bot hasn't linked a user yet. Allow idempotent
      // re-entry so the UI can still display the denomination.
    }

    // ── 3. Telegram notification (first activation only) ──────────────────
    // TG_CHAT_ID may contain multiple IDs separated by commas, e.g. "111,222,333"
    const token = process.env.TG_TOKEN;
    const chatIds = (process.env.TG_CHAT_ID ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);

    if (isFirstActivation) {
      if (token && chatIds.length > 0) {
        const text =
          `✅ Код ${wbCode.code} (Номинал ${wbCode.denomination} R$) активирован, пользователь читает инструкцию`;

        // Await all sends — Vercel terminates the function after response is sent,
        // so fire-and-forget fetch calls are silently dropped.
        const results = await Promise.all(
          chatIds.map((chatId) => sendTelegramMessage(token, chatId, text))
        );
        const sent = results.filter(Boolean).length;
        console.log(`[wb-code] TG notify: ${sent}/${chatIds.length} delivered for code ${wbCode.code}`);
      } else {
        console.error(
          `[wb-code] CANNOT NOTIFY: TG_TOKEN=${token ? "set" : "MISSING"}, ` +
          `TG_CHAT_ID parsed ids count=${chatIds.length}. ` +
          `Code ${wbCode.code} (${wbCode.denomination} R$) was activated but ` +
          `no message will reach Telegram. Set both env vars in Coolify and redeploy.`
        );
      }
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
