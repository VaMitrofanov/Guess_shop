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
import { vkGetName } from "../shared/notify";
import { getState, setState, clearState } from "./session";

/**
 * Extract a Roblox game-pass ID from user input.
 * Accepts:
 *   - Pure numeric ID:           "12345678"
 *   - Standard URL:              "https://www.roblox.com/game-pass/12345678/..."
 *   - Creator dashboard URL:     "https://create.roblox.com/dashboard/creations/passes/12345678/..."
 * Returns the ID string, or null if nothing was recognised.
 */
function extractPassId(input: string): string | null {
  const s = input.trim();
  if (/^\d+$/.test(s)) return s;
  const m = s.match(/(?:game-pass|passes)\/(\d+)/i);
  return m ? m[1] : null;
}

// ── DB-based state recovery ───────────────────────────────────────────────────

/**
 * When VK fails to deliver a ref, look up the user's most recently activated
 * WB code that doesn't yet have a WbOrder. If found, restore AWAITING_LINK.
 * Returns true if state was restored.
 */
async function tryRestoreState(vkUserId: number): Promise<boolean> {
  try {
    // Query wbCode directly via relation filter — avoids loading the full User
    // object with a deep include, which was causing ETIMEDOUT on Neon.
    const lastCode = await (db as any).wbCode.findFirst({
      where:   { user: { vkId: String(vkUserId) }, isUsed: true },
      orderBy: { usedAt: "desc" },
    });
    if (!lastCode) return false;

    // Skip if a gamepass order was already submitted for this code
    const existingOrder = await (db as any).wbOrder.findFirst({
      where: { wbCode: lastCode.code },
    });
    if (existingOrder) return false;

    setState(vkUserId, {
      type:         "AWAITING_LINK",
      wbCode:       lastCode.code,
      denomination: lastCode.denomination,
    });
    return true;
  } catch (err) {
    // Non-fatal: DB timeout or connectivity issue — bot continues without auto-restore
    console.error("[VK] tryRestoreState failed:", err);
    return false;
  }
}

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

function vkUserDisplay(name: string, vkUserId: number): string {
  return `${name} (<a href="https://vk.com/id${vkUserId}">ID: ${vkUserId}</a>)`;
}

// ── Entry point: called for every message_new event ───────────────────────────

export async function handleMessage(ctx: MessageContext): Promise<void> {
  if (ctx.isOutbox) return; // skip messages sent by the community itself

  console.log(">>> [VK DEBUG] Message Received! Context:", JSON.stringify(ctx));

  const vkUserId = ctx.senderId;
  const text     = ctx.text?.trim() ?? "";

  // ── (A) VK ref parameter — user clicked vk.me/club?ref=CODE ──────────────
  // VK can deliver the ref in several different fields depending on client/SDK version.
  const msgPayload = (ctx as any).messagePayload;
  const ref = (
    (ctx as any).ref ||
    msgPayload?.ref ||
    (ctx as any).startPayload ||
    (msgPayload?.command === "start" ? msgPayload?.ref : null)
  ) as string | undefined;

  if (ref) {
    await handleRefActivation(ctx, vkUserId, ref.trim().toUpperCase());
    return;
  }

  // ── (B) State machine dispatch ────────────────────────────────────────────
  const state = getState(vkUserId);

  // Edge case: VK sends "Начать" without a parsed ref — happens when the user
  // opens the chat for the first time or navigates back without a ?ref= param.
  // Try to recover: look up a pending wb_code from DB before giving up.
  if (!ref && (text === "Начать" || text.toLowerCase() === "start")) {
    if (!state) {
      const restored = await tryRestoreState(vkUserId);
      if (restored) {
        const restoredState = getState(vkUserId) as { type: "AWAITING_LINK"; wbCode: string; denomination: number };
        const passPrice = Math.ceil(restoredState.denomination / 0.7);
        await ctx.reply(
          `✅ Нашли твой активный код!\n` +
          `💎 Номинал: ${restoredState.denomination} R$\n\n` +
          `📋 Осталось:\n` +
          `1. Скопируй ссылку на геймпасс (убедись, что цена ${passPrice} R$)\n` +
          `2. Отправь её сюда 👇`
        );
        return;
      }
    }
    await ctx.reply(
      "❌ Код активации не найден.\n\n" +
      "Пожалуйста, перейдите по ссылке из инструкции ещё раз — ссылка должна содержать ваш уникальный код."
    );
    return;
  }

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

  // Fetch real name from VK API (ctx.vk is the VK instance attached to the context)
  let fullName = "VK User";
  try {
    const [userData] = await (ctx as any).vk.api.users.get({ user_ids: [vkUserId] });
    if (userData?.first_name) {
      fullName = [userData.first_name, userData.last_name].filter(Boolean).join(" ");
    }
  } catch (nameErr) {
    console.error("[VK] users.get failed, using fallback name:", nameErr);
  }

  // Lazy registration — always persist the real name
  let user = await (db as any).user.findUnique({ where: { vkId: String(vkUserId) } });
  if (!user) {
    user = await (db as any).user.create({
      data: { vkId: String(vkUserId), name: fullName },
    });
  } else if (!user.name || user.name.startsWith("VK #")) {
    // Update only if name is missing or was a fallback placeholder
    user = await (db as any).user.update({
      where: { vkId: String(vkUserId) },
      data:  { name: fullName },
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
    `1. Скопируй ссылку на геймпасс (убедись, что цена в нём ${passPrice} R$)\n` +
    `2. Отправь её сюда 👇`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// B1 — Collect gamepass URL
// ─────────────────────────────────────────────────────────────────────────────

async function handleGamepassLink(
  ctx: MessageContext,
  vkUserId: number,
  input: string,
  wbCode: string,
  denomination: number
): Promise<void> {
  const passId = extractPassId(input);

  if (!passId) {
    await ctx.reply(
      "⚠️ Не удалось распознать геймпасс.\n\n" +
      "Пришли одно из:\n" +
      "• Ссылку: https://www.roblox.com/game-pass/1234567/...\n" +
      "• Ссылку из конструктора: https://create.roblox.com/...\n" +
      "• Просто ID (только цифры): 1234567"
    );
    return;
  }

  const cleanLink = `https://www.roblox.com/game-pass/${passId}`;

  const user = await (db as any).user.findUnique({ where: { vkId: String(vkUserId) } });
  if (!user) {
    await ctx.reply("Ошибка сессии. Напиши нам снова — начнём с начала.");
    clearState(vkUserId);
    return;
  }

  const order = await (db as any).wbOrder.create({
    data: {
      amount:      denomination,
      gamepassUrl: cleanLink,
      status:      "PENDING",
      platform:    "VK",
      userId:      user.id,
      wbCode,
    },
  });

  clearState(vkUserId);

  await ctx.reply(
    `✅ Принял геймпасс №${passId}! Ожидайте выкупа.\n\n` +
    `🆔 Номер заявки: ${order.id.slice(-6).toUpperCase()}\n` +
    `Напиши "статус" чтобы узнать статус обработки.`
  );

  // Fetch real name for admin card (non-blocking — fallback is "VK #id")
  const vkName = user.name ?? await vkGetName(vkUserId);

  // Notify Telegram admins
  await sendAdminOrderCard({
    id:          order.id,
    amount:      denomination,
    gamepassUrl: cleanLink,
    platform:    "VK",
    wbCode,
    userDisplay: vkUserDisplay(vkName, vkUserId),
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

  const reviewerName = user.name ?? await vkGetName(vkUserId);

  await sendAdminReviewCard({
    orderId,
    userId:      user.id as string,
    photoSource: url,
    userDisplay: vkUserDisplay(reviewerName, vkUserId),
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

  // Guard: user sent a gamepass URL/ID but state machine has no active code.
  // Try DB auto-pickup first — they may have activated the code on the site.
  if (extractPassId(text) !== null) {
    const restored = await tryRestoreState(vkUserId);
    if (restored) {
      // State is now AWAITING_LINK — re-dispatch to gamepass handler
      const restoredState = getState(vkUserId) as { type: "AWAITING_LINK"; wbCode: string; denomination: number };
      await handleGamepassLink(ctx, vkUserId, text, restoredState.wbCode, restoredState.denomination);
      return;
    }
    await ctx.reply(
      "⚠️ Сначала активируй код с карточки Wildberries — перейди по ссылке на вкладыше.\n\n" +
      "После активации кода пришли ссылку на геймпасс сюда."
    );
    return;
  }

  // "статус" keyword → show last order in rich format
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

    const passPrice = Math.ceil((order.amount as number) / 0.7);
    const shortId   = (order.id as string).slice(-6).toUpperCase();
    const statusStr = label[order.status] ?? order.status;

    const calm =
      order.status === "PENDING"
        ? "\n\nНе переживай — менеджер работает в порядке очереди, среднее время 15–30 мин. Напишем сами."
        : "";

    await ctx.reply(
      `📦 Заявка #${shortId}\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `💎 Сумма: ${order.amount} R$ (Геймпасс: ${passPrice} R$)\n` +
      `🔑 Код ВБ: ${order.wbCode}\n` +
      `🔗 ${order.gamepassUrl}\n` +
      `📊 Статус: ${statusStr}` +
      calm
    );
    return;
  }

  // Default help message — try one last DB lookup before giving up.
  // If the user has any used-but-unlinked wb code attached to them (via
  // VK ID auth on the site), restore the AWAITING_LINK state automatically.
  const restored = await tryRestoreState(vkUserId);
  if (restored) {
    const restoredState = getState(vkUserId) as { type: "AWAITING_LINK"; wbCode: string; denomination: number };
    const passPrice = Math.ceil(restoredState.denomination / 0.7);
    await ctx.reply(
      `✅ Нашли твой активный код ${restoredState.wbCode}!\n` +
      `💎 Номинал: ${restoredState.denomination} R$\n\n` +
      `📋 Осталось:\n` +
      `1. Скопируй ссылку на геймпасс (цена должна быть ${passPrice} R$)\n` +
      `2. Отправь её сюда 👇`
    );
    return;
  }

  await ctx.reply(
    "👋 Привет! Я бот RobloxBank.\n\n" +
    "Чтобы активировать код с карточки Wildberries, перейди на сайт:\n" +
    "https://robloxbank.ru/guide?source=wb\n\n" +
    "Напиши \"статус\" — узнать статус последнего заказа.\n" +
    "Возникли трудности? Пиши менеджеру: https://t.me/RobloxBank_PA"
  );
}
