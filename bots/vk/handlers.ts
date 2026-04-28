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
import { Keyboard } from "vk-io";
import { getGamepassDetails } from "../shared/roblox";

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

    // Skip if a gamepass order was already submitted for this code and is still active
    const existingOrder = await (db as any).wbOrder.findFirst({
      where: { 
        wbCode: lastCode.code,
        status: { in: ["PENDING", "COMPLETED"] }
      },
    });
    if (existingOrder) return false;

    const user = await (db as any).user.findUnique({ where: { vkId: String(vkUserId) } });
    const totalAmount = lastCode.denomination + (user?.balance || 0);

    setState(vkUserId, {
      type:         "AWAITING_LINK",
      wbCode:       lastCode.code,
      denomination: totalAmount,
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
  // vk-io v4: computed largeSizeUrl getter
  if (typeof ph?.largeSizeUrl === "string") return ph.largeSizeUrl;
  // Walk sizes array — present on vk-io objects and raw VK API payloads.
  // ph.photo.sizes covers raw attachment objects where photo is nested.
  const sizes: Array<{ width?: number; height?: number; url?: string }> =
    ph?.sizes ?? ph?.photo?.sizes ?? [];
  if (sizes.length > 0) {
    return sizes
      .filter((s) => s.url)
      .sort((a, b) =>
        (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0)
      )[0]?.url;
  }
  // Last resort: bare url property
  return typeof ph?.url === "string" ? ph.url : undefined;
}

function vkUserDisplay(name: string, vkUserId: number): string {
  return `<a href="https://vk.com/id${vkUserId}">${name}</a>`;
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

  if (msgPayload?.command === "check_sub" || text === "✅ Я подписался") {
    try {
      const groupId = process.env.VK_GROUP_ID;
      const isMember = await (ctx as any).vk.api.groups.isMember({ group_id: groupId, user_id: vkUserId });
      if (!isMember) {
        await ctx.reply("Ты всё ещё не подписан! 😢 Подпишись и нажми кнопку снова.");
        return;
      }
      // If subscribed, check if there's a ref to activate
      const refToActivate = msgPayload?.ref;
      if (refToActivate) {
        await handleRefActivation(ctx, vkUserId, refToActivate);
        return;
      } else {
        await ctx.reply("✅ Спасибо за подписку! Теперь ты можешь активировать свой код с карточки Wildberries.");
        return;
      }
    } catch (err) {
      console.error("[VK] isMember check failed:", err);
    }
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
          `📋 Осталось сделать всего один шаг:\n` +
          `Пришли нам Asset ID, либо ссылку на твой геймпасс. Перед отправкой, пожалуйста, убедись, что цена в геймпассе установлена ровно на ${passPrice} R$ 🪙\n\n` +
          `💡 Пример ссылки:\n` +
          `https://www.roblox.com/game-pass/1234567/...\n\n` +
          `💡 Пример Asset ID:\n` +
          `1234567\n\n` +
          `Отправь её сюда 👇`
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
  const groupId = process.env.VK_GROUP_ID;
  if (groupId) {
    try {
      const isMember = await (ctx as any).vk.api.groups.isMember({ group_id: groupId, user_id: vkUserId });
      if (!isMember) {
        await ctx.reply({
          message: "❗️ Для активации кода, пожалуйста, подпишись на нашу группу!",
          keyboard: Keyboard.builder()
            .urlButton({ label: "Подписаться", url: `https://vk.com/club${groupId}` })
            .row()
            .textButton({ label: "✅ Я подписался", payload: { command: "check_sub", ref: code }, color: "positive" })
            .inline()
        });
        return;
      }
    } catch (err) {
      console.error("[VK] isMember check failed:", err);
    }
  }

  // Case-insensitive code lookup
  const wbCode = await (db as any).wbCode.findFirst({
    where: { code: { equals: code, mode: "insensitive" } },
  });
  if (!wbCode) {
    await ctx.reply("❌ Код не найден. Проверь правильность ввода на карточке.");
    return;
  }
  // Only hard-block when code is definitively claimed (isUsed + userId set).
  // isUsed=true with userId=null means the site pre-activated it — the bot
  // will link the user atomically at the gamepass-submission step.
  if (wbCode.isUsed && wbCode.userId != null) {
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

  const totalAmount = wbCode.denomination + (user.balance || 0);

  // ── Defer isUsed write to the gamepass step ────────────────────────────
  // The code is claimed atomically (userId:null → user.id) only after Roblox
  // validates the gamepass — see the $transaction in handleGamepassLink.
  setState(vkUserId, { type: "AWAITING_LINK", wbCode: wbCode.code, denomination: totalAmount });

  const passPrice = Math.ceil(totalAmount / 0.7);

  let bonusText = "";
  if (user.balance && user.balance > 0) {
    bonusText = `🎁 Использован бонус: ${user.balance} R$!\n` +
                `💎 Итого к выдаче: ${totalAmount} R$\n\n`;
  } else {
    bonusText = `💎 Номинал: ${wbCode.denomination} R$\n\n`;
  }

  await ctx.reply(
    `✅ Код ${code} активирован!\n` +
    bonusText +
    `📋 Осталось сделать всего один шаг:\n\n` +
    `Пришли нам Asset ID, либо ссылку на твой геймпасс. Перед отправкой, пожалуйста, убедись, что цена в геймпассе установлена ровно на ${passPrice} R$ 🪙\n\n` +
    `💡 Пример ссылки:\n` +
    `https://www.roblox.com/game-pass/1234567/...\n\n` +
    `💡 Пример Asset ID:\n` +
    `1234567\n\n` +
    `Отправь её сюда 👇`
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

  // ── Roblox API validation ─────────────────────────────────────────────
  const expectedPrice = Math.ceil(denomination / 0.7);
  const gamepassInfo  = await getGamepassDetails(passId);

  if (!gamepassInfo) {
    // Roblox is reachable but returned no data → gamepass likely doesn't exist
    await ctx.reply(
      "⚠️ Не удалось получить информацию о геймпассе от Roblox.\n\n" +
      "Проверь правильность ссылки/ID и попробуй ещё раз. " +
      "Если проблема повторяется — обратись в поддержку: https://t.me/RobloxBank_PA"
    );
    return;
  }

  if (!gamepassInfo.validationSkipped) {
    // Normal validation — only runs when Roblox API was reachable
    if (!gamepassInfo.isActive) {
      await ctx.reply(
        `⚠️ Геймпасс №${passId} не выставлен на продажу.\n\n` +
        `Убедись, что он активен и доступен для покупки, затем пришли ссылку снова.`
      );
      return;
    }

    if (Math.abs(gamepassInfo.price - expectedPrice) > 2) {
      await ctx.reply(
        `⚠️ Цена геймпасса не совпадает с ожидаемой.\n\n` +
        `Установлено: ${gamepassInfo.price} R$\n` +
        `Ожидается:   ${expectedPrice} R$\n\n` +
        `Измени цену геймпасса в настройках Roblox и пришли ссылку снова.`
      );
      return;
    }

    // Notify user that the gamepass was found and validated
    const creatorLine = gamepassInfo.creatorName
      ? `\n👤 Создатель: ${gamepassInfo.creatorName}`
      : "";
    await ctx.reply(
      `✅ Геймпасс найден!` +
      creatorLine +
      `\n💰 Цена: ${gamepassInfo.price} R$`
    );
  } else {
    // Network-down fallback — log for audit, proceed to order creation
    console.warn(
      `[VK] Roblox API unreachable — accepting passId=${passId} without validation. ` +
      `Admin must verify price manually.`
    );
  }
  // ── End Roblox validation ─────────────────────────────────────────────

  const cleanLink = `https://www.roblox.com/game-pass/${passId}`;

  const user = await (db as any).user.findUnique({ where: { vkId: String(vkUserId) } });
  if (!user) {
    await ctx.reply("Ошибка сессии. Напиши нам снова — начнём с начала.");
    clearState(vkUserId);
    return;
  }

  // ── Atomic claim + order creation ──────────────────────────────────────
  // Roblox validation passed above — now commit in a single transaction:
  //  1. Claim the code (userId:null covers both fresh and web-pre-activated codes)
  //  2. Create the order
  //  3. Clear bonus balance
  // If any step fails the whole transaction rolls back — code stays unclaimed.
  let order: any;
  try {
    order = await (db as any).$transaction(async (tx: any) => {
      const claimed = await tx.wbCode.updateMany({
        where: {
          code:   { equals: wbCode, mode: "insensitive" },
          userId: null, // matches fresh (isUsed=false) AND web-activated (isUsed=true,userId=null)
        },
        data: { userId: user.id, isUsed: true, usedAt: new Date() },
      });
      console.log(
        `[VK] $transaction: wbCode.updateMany count=${claimed.count} for code=${wbCode}`
      );
      if (claimed.count === 0) {
        // Check whether the code already belongs to this user (retry after a crash/resubmit)
        const existingCode = await tx.wbCode.findFirst({
          where: { code: { equals: wbCode, mode: "insensitive" } },
        });
        if (!existingCode || existingCode.userId !== user.id) {
          throw Object.assign(new Error("Code already claimed"), { isClaimed: true });
        }
        // Code already assigned to this user — allow retry (skip re-update, proceed to order)
      }

      const newOrder = await tx.wbOrder.create({
        data: {
          amount:      denomination,
          gamepassUrl: cleanLink,
          status:      "PENDING",
          platform:    "VK",
          userId:      user.id,
          wbCode,
        },
      });

      if (user.balance && user.balance > 0) {
        await tx.user.update({ where: { id: user.id }, data: { balance: 0 } });
      }

      return newOrder;
    });
  } catch (err: any) {
    if (err.isClaimed) {
      clearState(vkUserId);
      await ctx.reply("⚠️ Этот код уже был активирован другим пользователем. Обратитесь в поддержку.");
      return;
    }
    console.error("[VK] Order/transaction error:", err);
    await ctx.reply("❌ Ошибка при создании заявки. Попробуй позже или напишите в поддержку.");
    return;
  }

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
    createdAt:   order.createdAt,
    bonusApplied: user.balance || 0,
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
  // Try vk-io parsed attachments first, then walk raw message attachments
  // as a fallback (some VK clients deliver photos in a different structure).
  let url: string | undefined;

  if (ctx.hasAttachments("photo")) {
    url = photoUrl(ctx.getAttachments("photo")[0]);
  }
  if (!url) {
    const rawAttachments: any[] =
      (ctx as any).message?.attachments ??
      (ctx as any).attachments ??
      [];
    const rawPhoto = rawAttachments.find((a: any) => a.type === "photo")?.photo;
    if (rawPhoto) url = photoUrl(rawPhoto);
  }

  // If we still don't have a URL — stay silent (do not feedback user)
  if (!url) {
    if (knownOrderId) {
      // User is in AWAITING_REVIEW state but sent no photo — guide them
      await ctx.reply(
        "📸 Пришли скриншот отзыва в виде фотографии (не файлом).\n" +
        "После проверки администратором ты получишь +50 R$."
      );
    }
    return;
  }

  const user = await (db as any).user.findUnique({ where: { vkId: String(vkUserId) } });
  if (!user) return;

  // Resolve the order to attach this review to
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
    if (!order || !linked) return; // nothing to review — stay silent
    orderId = order.id as string;
  }

  clearState(vkUserId);

  await ctx.reply("✅ Отзыв получен! Менеджер проверит его в ближайшее время и начислит бонус.");

  // Forward to Telegram admins — silent fail so user never sees a broken state
  try {
    const reviewerName = user.name ?? await vkGetName(vkUserId);
    await sendAdminReviewCard({
      orderId,
      userId:      user.id as string,
      photoSource: url,
      userDisplay: vkUserDisplay(reviewerName, vkUserId),
    });
  } catch (err) {
    console.error("[VK] sendAdminReviewCard failed (silent):", err);
  }
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
      `📋 Осталось сделать всего один шаг:\n` +
      `Пришли нам Asset ID, либо ссылку на твой геймпасс. Перед отправкой, пожалуйста, убедись, что цена в геймпассе установлена ровно на ${passPrice} R$ 🪙\n\n` +
      `💡 Пример ссылки:\n` +
      `https://www.roblox.com/game-pass/1234567/...\n\n` +
      `💡 Пример Asset ID:\n` +
      `1234567\n\n` +
      `Отправь её сюда 👇`
    );
    return;
  }

  // Smart fallback: only show the activation guide to genuinely new/inactive users.
  // If the user has any order history, show a short status nudge instead —
  // dumping the "how to activate" guide at someone who already ordered is confusing.
  // Exception: explicit greetings always get the full guide.
  const isGreeting = /^(привет|hello|hi|приветик)$/i.test(lower.trim());

  if (!isGreeting) {
    try {
      const idleUser = await (db as any).user.findUnique({ where: { vkId: String(vkUserId) } });
      if (idleUser) {
        const recentOrder = await (db as any).wbOrder.findFirst({
          where:   { userId: idleUser.id },
          orderBy: { createdAt: "desc" },
        });
        if (recentOrder) {
          const label: Record<string, string> = {
            PENDING:   "⏳ В обработке",
            COMPLETED: "✅ Выполнен",
            REJECTED:  "❌ Отклонён",
          };
          const shortId = (recentOrder.id as string).slice(-6).toUpperCase();
          await ctx.reply(
            `📦 Последняя заявка #${shortId}: ${label[recentOrder.status] ?? recentOrder.status}\n\n` +
            `Напиши "статус" для подробностей.\n` +
            `Возникли трудности? Пиши менеджеру: https://t.me/RobloxBank_PA`
          );
          return;
        }
      }
    } catch {
      // non-fatal DB error — fall through to guide
    }
  }

  await ctx.reply(
    "👋 Привет! Я бот RobloxBank.\n\n" +
    "Чтобы активировать код с карточки Wildberries, перейди на сайт:\n" +
    "https://robloxbank.ru/guide?source=wb\n\n" +
    "Напиши \"статус\" — узнать статус последнего заказа.\n" +
    "Возникли трудности? Пиши менеджеру: https://t.me/RobloxBank_PA"
  );
}
