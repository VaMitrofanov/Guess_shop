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
import { db, getCustomerStatus } from "../shared/db";
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

/** Returns false only when the group ID is configured AND the API confirms non-membership. Fail-open. */
async function isVkSubscribed(ctx: MessageContext, vkUserId: number): Promise<boolean> {
  const groupId = process.env.VK_GROUP_ID;
  if (!groupId) return true;
  try {
    return !!(await (ctx as any).vk.api.groups.isMember({ group_id: groupId, user_id: vkUserId }));
  } catch {
    return true; // don't block users on API errors
  }
}

/** Sends the subscription prompt with benefits list and inline buttons. */
async function sendVkSubPrompt(ctx: MessageContext, refCode: string | null): Promise<void> {
  const groupId  = process.env.VK_GROUP_ID;
  const groupUrl = groupId ? `https://vk.com/club${groupId}` : "https://vk.com";
  await ctx.reply({
    message:
      `🚀 Чтобы активировать код и получить бонусные +5%, подпишись на наше сообщество!\n\n` +
      `Подписавшись, ты получишь доступ к:\n` +
      `1. 🏆 Приоритетной очереди выкупа.\n` +
      `2. 🎰 Розыгрышам робуксов каждый понедельник.\n` +
      `3. 💬 Моментальной поддержке 24/7.\n\n` +
      `Это поможет не пропустить новости о раздачах: ${groupUrl}`,
    keyboard: Keyboard.builder()
      .urlButton({ label: "🔔 Подписаться", url: groupUrl })
      .row()
      .textButton({
        label:   "✅ Я подписался",
        payload: refCode ? { command: "check_sub", ref: refCode } : { command: "check_sub" },
        color:   "positive",
      })
      .inline(),
  });
}

// ── Entry point: called for every message_new event ───────────────────────────

export async function handleMessage(ctx: MessageContext): Promise<void> {
  if (ctx.isOutbox) return; // skip messages sent by the community itself

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
      if (!(await isVkSubscribed(ctx, vkUserId))) {
        await ctx.reply("Ты всё ещё не подписан! 😢 Подпишись и нажми кнопку снова.");
        return;
      }
      const refToActivate = msgPayload?.ref;
      if (refToActivate) {
        // Came from the code-activation gate — continue activation
        await handleRefActivation(ctx, vkUserId, refToActivate);
        return;
      }
      // Came from the gamepass-submission gate — AWAITING_LINK state is still active
      const existingState = getState(vkUserId);
      if (existingState?.type === "AWAITING_LINK") {
        const passPrice = Math.ceil(existingState.denomination / 0.7);
        await ctx.reply(
          `✅ Подписка подтверждена! Теперь отправь ссылку на геймпасс.\n` +
          `Цена должна быть ровно ${passPrice} R$ 🪙`
        );
      } else {
        await ctx.reply("✅ Спасибо за подписку! Теперь ты можешь активировать свой код с карточки Wildberries.");
      }
      return;
    } catch (err) {
      console.error("[VK] check_sub handler failed:", err);
    }
  }

  // ── (B) State machine dispatch ────────────────────────────────────────────
  const state = getState(vkUserId);

  // Edge case: VK sends "Начать" without a parsed ref — user opened chat manually
  // or tapped the Start button without a ?ref= param.
  if (!ref && (text === "Начать" || text.toLowerCase() === "start")) {
    // 1. If already in AWAITING_LINK, remind user about pending code
    if (state?.type === "AWAITING_LINK") {
      const passPrice = Math.ceil(state.denomination / 0.7);
      const { isReturning } = await getCustomerStatus(String(vkUserId), "VK");
      const greetPrefix = isReturning ? "👋 С возвращением! " : "";
      await ctx.reply(
        `${greetPrefix}✅ Нашли твой активный код!\n` +
        `💎 Номинал: ${state.denomination} R$\n\n` +
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

    // 2. Try to recover a pending WB code from DB
    const restored = await tryRestoreState(vkUserId);
    if (restored) {
      const restoredState = getState(vkUserId) as { type: "AWAITING_LINK"; wbCode: string; denomination: number };
      const passPrice = Math.ceil(restoredState.denomination / 0.7);
      const { isReturning } = await getCustomerStatus(String(vkUserId), "VK");
      const greetPrefix = isReturning ? "👋 С возвращением! " : "";
      await ctx.reply(
        `${greetPrefix}✅ Нашли твой активный код!\n` +
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

    // 3. No pending code — recognize returning customers instead of showing an error
    const { isReturning } = await getCustomerStatus(String(vkUserId), "VK");
    console.log(`[VK] Начать command: vkUserId=${vkUserId}, isReturning=${isReturning}`);
    if (isReturning) {
      const firstName = await vkGetName(vkUserId);
      await ctx.reply(
        `👋 С возвращением, ${firstName}! Рады тебя видеть снова в RobloxBank.\n\n` +
        `Чтобы начать новый обмен, просто отправь код с карточки Wildberries ` +
        `или ссылку на геймпасс — и мы всё оформим!`
      );
      return;
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
  if (!(await isVkSubscribed(ctx, vkUserId))) {
    await sendVkSubPrompt(ctx, code);
    return;
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

  // ── Check returning status for personalized greeting ──────────────────
  const { isReturning } = await getCustomerStatus(String(vkUserId), "VK");
  const firstName = fullName.split(" ")[0] || "друг";

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

  // Prepend returning greeting if user has previous orders
  const greetLine = isReturning
    ? `👋 С возвращением, ${firstName}! Рады тебя видеть.\n`
    : "";

  await ctx.reply(
    greetLine +
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
  // Re-check subscription — state could have been set before the user subscribed.
  if (!(await isVkSubscribed(ctx, vkUserId))) {
    await sendVkSubPrompt(ctx, null); // no ref; AWAITING_LINK state preserved for retry
    return;
  }

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

  // Count BEFORE the transaction so the badge reflects orders prior to this one
  const previousOrderCount = await (db as any).wbOrder.count({ where: { userId: user.id } }).catch(() => 0);

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
    id:                  order.id,
    amount:              denomination,
    gamepassUrl:         cleanLink,
    platform:            "VK",
    wbCode,
    userDisplay:         vkUserDisplay(vkName, vkUserId),
    createdAt:           order.createdAt,
    bonusApplied:        user.balance || 0,
    previousOrderCount,
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

  // Try to restore a pending WB code before falling back to the greeting.
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

  // Single DB call — determines the response for ALL idle messages regardless of wording.
  // vkUserId is a number; DB field vkId is a string — always coerce with String().
  const { isReturning } = await getCustomerStatus(String(vkUserId), "VK");

  if (isReturning) {
    await ctx.reply(
      "👋 Рады видеть тебя снова в RobloxBank! Приятно работать с постоянными клиентами. " +
      "Ты знаешь, что делать — просто пришли свой новый код или ссылку на геймпасс, и мы всё оформим!"
    );
  } else {
    await ctx.reply(
      "👋 Привет! Я бот RobloxBank.\n\n" +
      "Чтобы активировать код с карточки Wildberries, перейди на сайт:\n" +
      "https://robloxbank.ru/guide?source=wb\n\n" +
      "Напиши \"статус\" — узнать статус последнего заказа.\n" +
      "Возникли трудности? Пиши менеджеру: https://t.me/RobloxBank_PA"
    );
  }
}
