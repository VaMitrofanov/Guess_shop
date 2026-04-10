/**
 * VK Bot message handlers.
 *
 * Flow:
 *  1. User clicks vk.me/clubXXXX?ref=CODE → message arrives with ctx.ref = CODE
 *  2. Validate WB code, lazy-register user, enter AWAITING_LINK state
 *  3. User sends Roblox gamepass URL → create WbOrder, notify TG admins
 *  4. After admin marks order COMPLETED (via TG bot), TG bot notifies user via VK API
 *  5. User sends review screenshot → forward to TG admins with approve/reject buttons
 */

import type { MessageContext } from "vk-io";
import { db } from "../shared/db";
import { sendAdminOrderCard, sendAdminReviewCard } from "../shared/admin";
import { getState, setState, clearState } from "./session";

const GAMEPASS_RE = /^https?:\/\/(www\.)?roblox\.com\/game-pass\/\d+/i;

// ── Util ──────────────────────────────────────────────────────────────────────

/** Best available URL from a VK photo attachment. */
function photoUrl(attachment: unknown): string | undefined {
  const ph = attachment as any;
  // vk-io v4: largeSizeUrl getter
  if (typeof ph?.largeSizeUrl === "string") return ph.largeSizeUrl;
  // fallback: walk sizes array (sorted desc by width)
  const sizes: Array<{ width?: number; url?: string }> = ph?.sizes ?? [];
  return sizes.sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url;
}

function vkUserDisplay(vkUserId: number): string {
  return `<a href="https://vk.com/id${vkUserId}">VK #${vkUserId}</a>`;
}

// ── Entry point: called for every message_new event ───────────────────────────

export async function handleMessage(ctx: MessageContext): Promise<void> {
  if (ctx.isOutbox) return; // skip messages sent by the community itself

  const vkUserId = ctx.senderId;
  const text     = ctx.text?.trim() ?? "";

  // ── (A) VK ref parameter — user clicked vk.me/club?ref=CODE ──────────────
  const ref = (ctx as any).ref as string | undefined;
  if (ref) {
    await handleRefActivation(ctx, vkUserId, ref.trim().toUpperCase());
    return;
  }

  // ── (B) State machine dispatch ────────────────────────────────────────────
  const state = getState(vkUserId);

  if (state?.type === "AWAITING_LINK") {
    await handleGamepassLink(ctx, vkUserId, text, state.wbCode, state.denomination);
    return;
  }

  if (state?.type === "AWAITING_REVIEW" || ctx.hasAttachments("photo")) {
    await handleReviewScreenshot(ctx, vkUserId, state?.type === "AWAITING_REVIEW" ? state.orderId : undefined);
    return;
  }

  // ── (C) No active state — DB-derived status / help message ───────────────
  await handleIdleMessage(ctx, vkUserId, text);
}

// ─────────────────────────────────────────────────────────────────────────────
// A — Activation via ref link
// ─────────────────────────────────────────────────────────────────────────────

async function handleRefActivation(
  ctx: MessageContext,
  vkUserId: number,
  code: string
): Promise<void> {
  // Validate code
  const wbCode = await (db as any).wbCode.findUnique({ where: { code } });
  if (!wbCode) {
    await ctx.reply("❌ Код не найден. Проверь правильность ввода на карточке.");
    return;
  }
  if (wbCode.isUsed && wbCode.userId) {
    await ctx.reply("⚠️ Этот код уже был активирован.");
    return;
  }

  // Lazy registration
  let user = await (db as any).user.findUnique({ where: { vkId: String(vkUserId) } });
  if (!user) {
    user = await (db as any).user.create({
      data: { vkId: String(vkUserId) },
    });
  }

  // Link code to user
  await (db as any).wbCode.update({
    where: { id: wbCode.id },
    data:  { userId: user.id, isUsed: true, usedAt: new Date() },
  });

  setState(vkUserId, { type: "AWAITING_LINK", wbCode: code, denomination: wbCode.denomination });

  const passPrice = Math.ceil(wbCode.denomination / 0.7);
  await ctx.reply(
    `✅ Код ${code} активирован!\n` +
    `💎 Номинал: ${wbCode.denomination} R$\n\n` +
    `📋 Что делать дальше:\n` +
    `1. Открой https://create.roblox.com\n` +
    `2. Создай геймпасс с ценой ${passPrice} R$\n` +
    `3. Скопируй ссылку на геймпасс и отправь сюда`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// B1 — Collect gamepass URL
// ─────────────────────────────────────────────────────────────────────────────

async function handleGamepassLink(
  ctx: MessageContext,
  vkUserId: number,
  url: string,
  wbCode: string,
  denomination: number
): Promise<void> {
  if (!GAMEPASS_RE.test(url)) {
    await ctx.reply(
      "⚠️ Некорректная ссылка.\n\n" +
      "Нужна ссылка вида:\nhttps://www.roblox.com/game-pass/1234567/название\n\n" +
      "Скопируй её из адресной строки браузера на странице своего геймпасса."
    );
    return;
  }

  const user = await (db as any).user.findUnique({ where: { vkId: String(vkUserId) } });
  if (!user) {
    await ctx.reply("Ошибка сессии. Напиши нам снова — начнём с начала.");
    clearState(vkUserId);
    return;
  }

  const order = await (db as any).wbOrder.create({
    data: {
      amount:      denomination,
      gamepassUrl: url,
      status:      "PENDING",
      platform:    "VK",
      userId:      user.id,
      wbCode,
    },
  });

  clearState(vkUserId);

  await ctx.reply(
    `✅ Заявка принята!\n\n` +
    `🆔 Номер: ${order.id.slice(-6).toUpperCase()}\n` +
    `Менеджер обработает её и пришлёт уведомление.\n\n` +
    `Чтобы узнать статус, напиши: статус`
  );

  // Notify Telegram admins
  await sendAdminOrderCard({
    id:          order.id,
    amount:      denomination,
    gamepassUrl: url,
    platform:    "VK",
    wbCode,
    userDisplay: vkUserDisplay(vkUserId),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// B2 — Collect review screenshot
// ─────────────────────────────────────────────────────────────────────────────

async function handleReviewScreenshot(
  ctx: MessageContext,
  vkUserId: number,
  knownOrderId?: string
): Promise<void> {
  if (!ctx.hasAttachments("photo")) {
    await ctx.reply(
      "📸 Пришли скриншот отзыва в виде фотографии (не файлом).\n" +
      "После проверки администратором ты получишь +50 R$."
    );
    return;
  }

  const photos = ctx.getAttachments("photo");
  const url    = photoUrl(photos[0]);
  if (!url) {
    await ctx.reply("Не удалось получить фото. Попробуй ещё раз.");
    return;
  }

  const user = await (db as any).user.findUnique({ where: { vkId: String(vkUserId) } });
  if (!user) return;

  // Determine the order to review
  let orderId = knownOrderId;
  if (!orderId) {
    const order = await (db as any).wbOrder.findFirst({
      where:   { userId: user.id, status: "COMPLETED" },
      orderBy: { updatedAt: "desc" },
    });
    const linked = order
      ? await (db as any).wbCode.findFirst({
          where: { userId: user.id, reviewBonusClaimed: false },
        })
      : null;
    if (!order || !linked) return; // nothing to review
    orderId = order.id as string;
  }

  clearState(vkUserId);

  await ctx.reply(
    "✅ Скриншот получен! Администратор рассмотрит его в течение 30 минут."
  );

  await sendAdminReviewCard({
    orderId,
    userId:      user.id as string,
    photoSource: url,
    userDisplay: vkUserDisplay(vkUserId),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// C — Idle: status check or help
// ─────────────────────────────────────────────────────────────────────────────

async function handleIdleMessage(
  ctx: MessageContext,
  vkUserId: number,
  text: string
): Promise<void> {
  const lower = text.toLowerCase();

  // "статус" keyword → show last order
  if (lower.includes("статус") || lower.includes("заказ")) {
    const user = await (db as any).user.findUnique({ where: { vkId: String(vkUserId) } });
    if (!user) {
      await ctx.reply("У тебя пока нет заказов. Активируй код с карточки Wildberries по ссылке на вкладыше.");
      return;
    }

    const order = await (db as any).wbOrder.findFirst({
      where:   { userId: user.id },
      orderBy: { createdAt: "desc" },
    });

    if (!order) {
      await ctx.reply("У тебя пока нет заявок.");
      return;
    }

    const label: Record<string, string> = {
      PENDING:   "⏳ В обработке",
      COMPLETED: "✅ Выполнен",
      REJECTED:  "❌ Отклонён",
    };

    const calm =
      order.status === "PENDING"
        ? "\n\nНе переживай — менеджер работает в порядке очереди, среднее время 15–30 мин. Напишем сами."
        : "";

    await ctx.reply(
      `📦 Заявка #${(order.id as string).slice(-6).toUpperCase()}\n` +
      `💎 Номинал: ${order.amount} R$\n` +
      `📊 Статус: ${label[order.status] ?? order.status}${calm}`
    );
    return;
  }

  // Default help message
  await ctx.reply(
    "👋 Привет! Активируй код с карточки Wildberries по ссылке на вкладыше.\n\n" +
    'Написать "статус" — узнать статус последнего заказа.'
  );
}
