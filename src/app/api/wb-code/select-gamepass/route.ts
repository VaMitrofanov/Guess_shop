import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { PrismaClientWithWb } from "@/types/prisma-wb";
import { getGamepassDetails } from "@/lib/roblox";
import { sendWebOrderCard } from "@/lib/admin-card";

const db = prisma as unknown as PrismaClientWithWb;

const NICK_RE = /^[A-Za-z0-9_]{3,20}$/;

/**
 * Website Step-9 handoff → ORDER MATERIALISER.
 *
 * The user picked their gamepass in the on-page nick search. We don't wait for
 * them to bounce back into the bot anymore — we promote their provisional order
 * (AWAITING_GAMEPASS → PENDING) right here and fire the admin card immediately,
 * marked 🌐 ONE-TAP С САЙТА.
 *
 * Validation parity with the bot:
 *   - The on-site search only ever surfaces gamepasses from PUBLIC places
 *     (getUserGamepasses uses accessFilter=Public) and price-matched/for-sale
 *     items, so the place-public + on-sale checks are already satisfied.
 *   - We additionally re-validate the picked id server-side (price + on-sale)
 *     so a hand-crafted POST can't push a bad order. If Roblox is unreachable we
 *     proceed (validationSkipped), exactly like the bot.
 *
 * Idempotent: if the order is already PENDING/processing/completed we return ok
 * without sending a duplicate card. We still persist selectedGamepassId/robloxNick
 * so the bot's one-tap remains a clean fallback if the promotion somehow fails.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const rawCode: string = (body?.code ?? "").toString().trim().toUpperCase();
    const gamepassId: string = (body?.gamepassId ?? "").toString().trim();
    const nick: string = (body?.nick ?? "").toString().trim().replace(/^@/, "");

    if (!/^[A-Z0-9]{7}$/.test(rawCode)) {
      return NextResponse.json({ error: "Некорректный код" }, { status: 400 });
    }
    if (!/^\d{1,20}$/.test(gamepassId)) {
      return NextResponse.json({ error: "Некорректный gamepassId" }, { status: 400 });
    }
    if (!NICK_RE.test(nick)) {
      return NextResponse.json({ error: "Некорректный ник Roblox" }, { status: 400 });
    }

    // ── 1. Lookup the code (need denomination for the price check + card) ──────
    const wbCode = await (db as any).wbCode.findFirst({
      where: { code: { equals: rawCode, mode: "insensitive" } },
      select: { id: true, isUsed: true, userId: true, denomination: true },
    });
    if (!wbCode) {
      return NextResponse.json({ error: "Код не найден" }, { status: 404 });
    }
    // No bot activation yet → no provisional order to attach to. Tell the site to
    // route the user into the bot first.
    if (!wbCode.userId) {
      return NextResponse.json(
        { error: "Код ещё не активирован в боте", code: "NO_BOT_ORDER" },
        { status: 409 },
      );
    }

    const expectedPrice = wbCode.denomination > 0 ? Math.ceil(wbCode.denomination / 0.7) : 0;

    // ── 2. Server-side re-validation of the picked gamepass ───────────────────
    // null → Roblox unreachable → skip (parity with bot's validationSkipped).
    const details = await getGamepassDetails(gamepassId);
    if (details) {
      if (details.isActive === false) {
        return NextResponse.json(
          { error: "Геймпасс не выставлен на продажу", code: "NOT_FOR_SALE" },
          { status: 422 },
        );
      }
      if (expectedPrice > 0 && Math.abs((details.price ?? 0) - expectedPrice) > 2) {
        return NextResponse.json(
          { error: `Цена геймпасса должна быть ${expectedPrice} R$`, code: "WRONG_PRICE", expectedPrice },
          { status: 422 },
        );
      }
    }

    const gamepassUrl = `https://www.roblox.com/game-pass/${gamepassId}`;

    // ── 3. Promote the provisional order (transactional, idempotent) ──────────
    const result = await (db as any).$transaction(async (tx: any) => {
      const order = await tx.wbOrder.findFirst({
        where: { wbCode: { equals: rawCode, mode: "insensitive" } },
      });
      if (!order) {
        // Code claimed but no order row — let the bot handle it as fallback.
        throw { status: 409, message: "Заказ не найден", code: "NO_BOT_ORDER" };
      }

      // Always persist the hint so the bot one-tap stays consistent.
      await tx.wbCode.update({
        where: { id: wbCode.id },
        data: { selectedGamepassId: gamepassId, robloxNick: nick },
      });

      // Already past the awaiting stage → don't duplicate the card.
      if (order.status !== "AWAITING_GAMEPASS" && order.status !== "REJECTED") {
        return { order, alreadyOrdered: true };
      }

      // Atomic promote: the status guard means a concurrent double-tap (or the
      // bot promoting first) can only win once — the loser matches 0 rows and is
      // treated as alreadyOrdered, so the admin card fires exactly once.
      const promoted = await tx.wbOrder.updateMany({
        where: { id: order.id, status: { in: ["AWAITING_GAMEPASS", "REJECTED"] } },
        data: {
          gamepassUrl,
          status: "PENDING",
          rejectionReason: null,
          adminId: null,
          robloxUsername: nick,
        },
      });
      if (promoted.count === 0) {
        return { order, alreadyOrdered: true };
      }
      await tx.wbCode.update({
        where: { id: wbCode.id },
        data: { isUsed: true, usedAt: new Date() },
      });
      // amount/userId/platform are unchanged by the promote — reuse `order`.
      return { order, alreadyOrdered: false };
    });

    if (result.alreadyOrdered) {
      return NextResponse.json({ ok: true, alreadyOrdered: true });
    }

    try { await (db as any).user.update({ where: { id: wbCode.userId }, data: { robloxUsername: nick } }); } catch {}


    // ── 4. Fire the admin card (non-blocking failure) ─────────────────────────
    try {
      const order = result.order;
      const [user, previousOrderCount] = await Promise.all([
        (db as any).user.findUnique({
          where: { id: order.userId },
          select: { tgId: true, vkId: true, name: true, username: true },
        }),
        (db as any).wbOrder.count({ where: { userId: order.userId, status: "COMPLETED" } }),
      ]);

      const safeName = (user?.name ?? "Пользователь")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      let userDisplay: string;
      if (order.platform === "VK" && user?.vkId) {
        userDisplay = `<a href="https://vk.com/id${user.vkId}">${safeName}</a>`;
      } else if (user?.username) {
        userDisplay = `@${user.username}`;
      } else if (user?.tgId) {
        userDisplay = `<a href="tg://user?id=${user.tgId}">${safeName}</a>`;
      } else {
        userDisplay = safeName;
      }

      await sendWebOrderCard({
        id: order.id,
        amount: order.amount,
        gamepassUrl,
        platform: order.platform === "VK" ? "VK" : "TG",
        wbCode: rawCode,
        userDisplay,
        creatorName: nick,
        previousOrderCount,
      });
    } catch (cardErr) {
      console.error("[wb-code/select-gamepass] admin card failed:", cardErr);
    }

    return NextResponse.json({ ok: true, ordered: true });
  } catch (err: any) {
    if (err?.status) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    console.error("[wb-code/select-gamepass] error:", err);
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}
