import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getGamepassDetails, getRobloxUserById } from "@/lib/roblox";
import { sendWebOrderCard } from "@/lib/admin-card";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { buildSplitParts, type SplitPart } from "@/lib/order-gamepass-split";
import { MAX_AUTO_PARTS } from "@/lib/gamepass-plan";
import { PRICE_TOL, expectedGamepassPrice } from "@/lib/purchase-guard";
import { auditGamepassSubmitted, type OrderAuditClient } from "@/lib/order-audit";

const NICK_RE = /^[A-Za-z0-9_]{3,20}$/;

class HandoffError extends Error {
  constructor(public status: number, message: string, public code: string) {
    super(message);
  }
}

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
  const limited = rateLimit(`wb-select-gamepass:${clientIp(request)}`, 8, 1 / 15);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Слишком много попыток. Подождите и повторите." },
      { status: 429, headers: { "retry-after": String(limited.retryAfter) } },
    );
  }
  try {
    const body = await request.json();
    const rawCode: string = (body?.code ?? "").toString().trim().toUpperCase();
    const gamepassId: string = (body?.gamepassId ?? "").toString().trim();
    const rawNick: string = (body?.nick ?? "").toString().trim().replace(/^@/, "");
    // Ручной ввод ссылки: покупатель попал сюда, потому что поиск по нику ничего
    // не нашёл — ник он мог не вводить вовсе. Метка нужна и карточке админа.
    const manualLink: boolean = body?.manualLink === true;
    // Набор частей приходит, когда заказ закрывается несколькими пассами: пара
    // под номинал 2000 или размен по тому, что у покупателя уже выставлено.
    // Пустой/одиночный набор — это обычный заказ, ветка ниже его не трогает.
    const rawParts: unknown = body?.parts;

    if (!/^[A-Z0-9]{7}$/.test(rawCode)) {
      return NextResponse.json({ error: "Некорректный код" }, { status: 400 });
    }
    if (!/^\d{1,20}$/.test(gamepassId)) {
      return NextResponse.json({ error: "Некорректный gamepassId" }, { status: 400 });
    }
    if (rawNick && !NICK_RE.test(rawNick)) {
      return NextResponse.json({ error: "Некорректный ник Roblox" }, { status: 400 });
    }

    // ── 1. Lookup the code (need denomination for the price check + card) ──────
    const wbCode = await prisma.wbCode.findFirst({
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

    // ── 1b. Разбивка: сумма частей обязана точно совпасть с номиналом ─────────
    // Проверку делает `buildSplitParts` — тот же инвариант, что у админской
    // разбивки, и ослаблять его нельзя: разошедшаяся сумма означает, что
    // покупатель получит не то количество робуксов, за которое заплатил.
    let splitParts: SplitPart[] | null = null;
    if (Array.isArray(rawParts) && rawParts.length > 1) {
      if (rawParts.length > MAX_AUTO_PARTS) {
        return NextResponse.json(
          { error: `Заказ можно закрыть максимум ${MAX_AUTO_PARTS} геймпассами`, code: "TOO_MANY_PARTS" },
          { status: 422 },
        );
      }
      try {
        splitParts = buildSplitParts(rawParts, wbCode.denomination);
      } catch (splitErr) {
        return NextResponse.json(
          { error: splitErr instanceof Error ? splitErr.message : "Не разобрали разбивку", code: "BAD_SPLIT" },
          { status: 422 },
        );
      }
      if (splitParts[0].gamepassId !== gamepassId) {
        return NextResponse.json(
          { error: "Первая часть должна совпадать с выбранным геймпассом", code: "BAD_SPLIT" },
          { status: 422 },
        );
      }
      // Живая цена каждого пасса сверяется с номиналом ЕГО части, а не заказа:
      // на разбитом заказе прайс-гард заказа не применим по построению.
      const uniqueIds = [...new Set(splitParts.map((part) => part.gamepassId))];
      const live = new Map<string, Awaited<ReturnType<typeof getGamepassDetails>>>();
      for (const id of uniqueIds) live.set(id, await getGamepassDetails(id));
      for (const part of splitParts) {
        const info = live.get(part.gamepassId);
        if (!info) continue; // Roblox молчит — та же логика, что у одиночного пасса
        if (info.isActive === false) {
          return NextResponse.json(
            { error: `Геймпасс ${part.gamepassId} не выставлен на продажу`, code: "NOT_FOR_SALE" },
            { status: 422 },
          );
        }
        const want = expectedGamepassPrice(part.amount);
        if (Math.abs((info.price ?? 0) - want) > PRICE_TOL) {
          return NextResponse.json(
            { error: `Цена геймпасса ${part.gamepassId} должна быть ${want} R$`, code: "WRONG_PRICE", expectedPrice: want },
            { status: 422 },
          );
        }
      }
    }

    // ── 2. Server-side re-validation of the picked gamepass ───────────────────
    // null → Roblox unreachable → skip (parity with bot's validationSkipped).
    const details = await getGamepassDetails(gamepassId);
    if (details && !splitParts) {
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

    // Аудит: покупатель выбрал этот пасс на сайте. `details.creatorName` —
    // ответ Roblox о владельце, а не то, что человек набрал; робуксы уйдут
    // именно ему. Запись независима от того, чем закончится оформление ниже.
    void auditGamepassSubmitted(prisma as unknown as OrderAuditClient, {
      gamepassId,
      via: manualLink ? "site-manual-link" : "site-one-tap",
      wbCode: rawCode,
      creatorName: details?.creatorName ?? null,
      price: details?.price ?? null,
    });

    // ── 2b. Ник получателя ────────────────────────────────────────────────────
    // Робуксы уходят создателю геймпасса, поэтому владелец пасса по данным
    // Roblox точнее того, что напечатал покупатель. При ручном вводе ссылки ника
    // может не быть вовсе — тогда это единственный источник. Если и Roblox молчит
    // (details === null), остаётся напечатанный ник; без обоих оформлять нечего.
    let nick = rawNick;
    if (details) {
      // product-info отдаёт имя владельца вместе с пассом; отдельный запрос
      // нужен только фолбэк-веткам getGamepassDetails, где имени нет.
      let creatorName = (details.creatorName ?? "").trim();
      if (!creatorName && details.creatorId) {
        creatorName = ((await getRobloxUserById(String(details.creatorId)))?.name ?? "").trim();
      }
      if (NICK_RE.test(creatorName)) nick = creatorName;
    }
    if (!NICK_RE.test(nick)) {
      return NextResponse.json(
        { error: "Не удалось определить ник владельца геймпасса", code: "NO_NICK" },
        { status: 422 },
      );
    }

    const gamepassUrl = `https://www.roblox.com/game-pass/${gamepassId}`;

    // ── 3. Promote the provisional order (transactional, idempotent) ──────────
    const result = await prisma.$transaction(async (tx) => {
      const order = await tx.wbOrder.findFirst({
        where: { wbCode: { equals: rawCode, mode: "insensitive" } },
      });
      if (!order) {
        // Code claimed but no order row — let the bot handle it as fallback.
        throw new HandoffError(409, "Заказ не найден", "NO_BOT_ORDER");
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
          pendingAt: new Date(),
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
      if (splitParts) {
        // Перезаписываем набор целиком: повторное оформление того же кода не
        // должно оставлять хвост от прошлой попытки.
        await tx.wbOrderGamepass.deleteMany({ where: { orderId: order.id } });
        await tx.wbOrderGamepass.createMany({
          data: splitParts.map((part) => ({
            orderId: order.id,
            gamepassId: part.gamepassId,
            gamepassUrl: part.gamepassUrl,
            amount: part.amount,
            position: part.position,
          })),
        });
      }
      // amount/userId/platform are unchanged by the promote — reuse `order`.
      return { order, alreadyOrdered: false };
    });

    if (result.alreadyOrdered) {
      return NextResponse.json({ ok: true, alreadyOrdered: true });
    }

    // ── 4. Fire the admin card (non-blocking failure) ─────────────────────────
    try {
      const order = result.order;
      const [user, previousOrderCount] = await Promise.all([
        prisma.user.findUnique({
          where: { id: order.userId },
          select: { tgId: true, vkId: true, name: true, username: true },
        }),
        prisma.wbOrder.count({ where: { userId: order.userId, status: "COMPLETED" } }),
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
        createdAt: order.createdAt,
        manualLink,
        splitParts: splitParts?.map((part) => ({ gamepassId: part.gamepassId, amount: part.amount })),
      });
    } catch (cardErr) {
      console.error("[wb-code/select-gamepass] admin card failed:", cardErr);
    }

    return NextResponse.json({ ok: true, ordered: true });
  } catch (err: unknown) {
    if (err instanceof HandoffError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    console.error("[wb-code/select-gamepass] error:", err);
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}
