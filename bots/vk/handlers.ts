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
import { db, getCustomerStatus, getGreeting, getIdleGreeting } from "../shared/db";
import { sendAdminOrderCard, sendAdminReviewCard, sendAdminSupportAlert, ADMIN_IDS } from "../shared/admin";
import { vkGetName, tgSend } from "../shared/notify";
import { getState, setState, clearState } from "./session";
import { Keyboard } from "vk-io";
import { getGamepassDetails } from "../shared/roblox";

// VK API instance injected from bot.ts to avoid circular import.
let _vkApi: any = null;
export function initVkHandlers(vkInstance: any): void {
  _vkApi = vkInstance.api;
}

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
    const user = await (db as any).user.findUnique({ where: { vkId: String(vkUserId) } });
    if (!user) return false;

    // Look for AWAITING_GAMEPASS or REJECTED orders — mirrors TG DB recovery.
    // Limit to 30 days to avoid restoring stale orders from months ago where
    // the gamepass no longer exists.
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const recoverable = await (db as any).wbOrder.findFirst({
      where:   {
        userId: user.id,
        status: { in: ["AWAITING_GAMEPASS", "REJECTED"] },
        updatedAt: { gte: thirtyDaysAgo },
      },
      orderBy: { updatedAt: "desc" },
    });
    if (!recoverable) return false;

    setState(vkUserId, {
      type:         "AWAITING_LINK",
      wbCode:       recoverable.wbCode,
      denomination: recoverable.amount,
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
async function isVkSubscribed(_ctx: MessageContext, vkUserId: number): Promise<boolean> {
  const groupId = process.env.VK_GROUP_ID;
  if (!groupId) return true;
  if (!_vkApi) { console.error("[Gate] _vkApi not initialised — call initVkHandlers() in bot.ts"); return true; }
  try {
    const isMember = !!(await _vkApi.groups.isMember({ group_id: groupId, user_id: vkUserId }));
    console.log(isMember ? `[Gate] User ${vkUserId} passed sub check` : `[Gate] User ${vkUserId} failed sub check`);
    return isMember;
  } catch (err) {
    console.error(`[Gate] isMember error for user ${vkUserId}:`, err);
    return true; // fail-open: don't block users on API errors
  }
}

/** Inline keyboard with a single "Нужна помощь?" button that sends a support alert. */
function vkSupportKb(ctxKey: string) {
  return Keyboard.builder()
    .textButton({ label: "💬 Нужна помощь?", payload: { command: "support", context: ctxKey }, color: "secondary" })
    .inline();
}

/** Sends the subscription prompt and inline buttons. */
async function sendVkSubPrompt(ctx: MessageContext, refCode: string | null): Promise<void> {
  const groupId  = process.env.VK_GROUP_ID;
  const groupUrl = groupId ? `https://vk.com/club${groupId}` : "https://vk.com";
  await ctx.reply({
    message:
      `⭐ Ты в одном шаге! У наших клиентов есть закрытое сообщество — там анонсы акций, розыгрыши и бонусы для постоянных клиентов.\n\n` +
      `Загляни — это бесплатно:\n${groupUrl}\n\n` +
      `После подписки нажми кнопку «✅ Я вступил» ниже.`,
    keyboard: Keyboard.builder()
      .urlButton({ label: "🔔 Подписаться", url: groupUrl })
      .row()
      .textButton({
        label:   "✅ Я вступил",
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

  // ── 🆘 Support button payload ────────────────────────────────────────────
  if (msgPayload?.command === "support") {
    const ctxKey    = String(msgPayload.context ?? "general");
    const firstName = await vkGetName(vkUserId);
    const state     = getState(vkUserId);
    let wbCode  = state?.type === "AWAITING_LINK" ? state.wbCode       : undefined;
    let denom   = state?.type === "AWAITING_LINK" ? state.denomination : undefined;
    if (!wbCode) {
      try {
        const u = await (db as any).user.findUnique({ where: { vkId: String(vkUserId) }, select: { id: true } });
        if (u) {
          const o = await (db as any).wbOrder.findFirst({
            where: { userId: u.id },
            orderBy: { updatedAt: "desc" },
            select: { wbCode: true, amount: true },
          });
          if (o) { wbCode = o.wbCode; denom = o.amount; }
        }
      } catch {}
    }
    await sendAdminSupportAlert({
      platform:    "VK",
      userDisplay: `vk.com/id${vkUserId} (${firstName})`,
      contextKey:  ctxKey,
      wbCode,
      denomination: denom,
    });
    await ctx.reply("Соединяем с менеджером — напиши нам: https://t.me/RobloxBank_PA\n\nМы уже знаем о твоей ситуации 👍");
    return;
  }

  // Accept "✅ Я подписался" as text only when the user is in AWAITING_LINK state
  // (old VK desktop clients that don't send inline-keyboard payloads). Without
  // the context guard any user sending that phrase would trigger a spurious sub-check.
  const lower = text.toLowerCase();
  const isSubConfirmText =
    (lower.includes("вступил") || lower.includes("подписал")) && getState(vkUserId)?.type === "AWAITING_LINK";
  // "resubmit" button from /status REJECTED keyboard
  if (msgPayload?.command === "resubmit" && msgPayload?.code) {
    const resubCode = String(msgPayload.code).toUpperCase();
    const user = await (db as any).user.findUnique({ where: { vkId: String(vkUserId) } });
    if (user) {
      const order = await (db as any).wbOrder.findFirst({ where: { wbCode: resubCode, userId: user.id } });
      if (order && (order.status === "REJECTED" || order.status === "AWAITING_GAMEPASS")) {
        setState(vkUserId, { type: "AWAITING_LINK", wbCode: resubCode, denomination: order.amount });
        const passPrice = Math.ceil(order.amount / 0.7);
        await ctx.reply(`🔄 Исправление ссылки\n\n💎 Номинал: ${order.amount} R$\nПришли новую ссылку на геймпасс с ценой ${passPrice} R$.\n\nЕсли нужна помощь — https://t.me/RobloxBank_PA`);
        return;
      }
    }
    await ctx.reply("Заявка не найдена или уже не требует исправления.\n\nЕсть вопросы? https://t.me/RobloxBank_PA");
    return;
  }

  if (msgPayload?.command === "check_sub" || isSubConfirmText) {
    try {
      if (!(await isVkSubscribed(ctx, vkUserId))) {
        await ctx.reply("Похоже, подписка ещё не прошла 🙈 Подпишись на сообщество и нажми кнопку снова.");
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
      await ctx.reply("Не удалось проверить подписку — попробуй ещё раз через минуту.\n\nЕсли проблема повторяется — напиши нам: https://t.me/RobloxBank_PA");
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
      const custStatus = await getCustomerStatus(String(vkUserId), "VK");
      const firstName = await vkGetName(vkUserId);
      await ctx.reply({
        message:
          `${getGreeting(custStatus, firstName)}\n` +
          `✅ У тебя есть активный код!\n` +
          `💎 Номинал: ${state.denomination} R$\n\n` +
          `Осталось совсем чуть-чуть — пришли ссылку на геймпасс.\n` +
          `📌 Цена геймпасса должна быть ровно ${passPrice} R$\n\n` +
          `Жду ссылку 👇`,
        keyboard: vkSupportKb("general"),
      });
      return;
    }

    // 2. Try to recover a pending WB code from DB
    const restored = await tryRestoreState(vkUserId);
    if (restored) {
      const restoredState = getState(vkUserId) as { type: "AWAITING_LINK"; wbCode: string; denomination: number };
      const passPrice = Math.ceil(restoredState.denomination / 0.7);
      const custStatus = await getCustomerStatus(String(vkUserId), "VK");
      const firstName = await vkGetName(vkUserId);
      await ctx.reply({
        message:
          `${getGreeting(custStatus, firstName)}\n` +
          `✅ У тебя есть активный код!\n` +
          `💎 Номинал: ${restoredState.denomination} R$\n\n` +
          `Осталось совсем чуть-чуть — пришли ссылку на геймпасс.\n` +
          `📌 Цена геймпасса должна быть ровно ${passPrice} R$\n\n` +
          `Жду ссылку 👇`,
        keyboard: vkSupportKb("general"),
      });
      return;
    }

    // 3. No pending code — greet based on loyalty status
    const custStatus = await getCustomerStatus(String(vkUserId), "VK");
    console.log(`[VK] Начать command: vkUserId=${vkUserId}, isReturning=${custStatus.isReturning}`);
    if (custStatus.isReturning) {
      const firstName = await vkGetName(vkUserId);
      await ctx.reply({
        message: getIdleGreeting(custStatus, firstName) + "\n\nНужна помощь? https://t.me/RobloxBank_PA",
        keyboard: Keyboard.builder()
          .textButton({ label: "📊 Статус заявки", payload: { command: "status" }, color: "primary" })
          .row()
          .textButton({ label: "💬 Нужна помощь?", payload: { command: "support", context: "general" }, color: "secondary" })
          .inline(),
      });
      return;
    }

    await ctx.reply(
      "👋 Привет! Здесь ты можешь обменять Wildberries-карту на робуксы.\n\n" +
      "Есть код с WB-карты? Напиши его прямо сюда — сайт не нужен.\n\n" +
      "Или открой инструкцию: https://robloxbank.ru/guide?source=wb\n\n" +
      "Нужна помощь? Пиши: https://t.me/RobloxBank_PA"
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
  // "status" button payload routes to the same handler as the "статус" keyword.
  const effectiveText = msgPayload?.command === "status" ? "статус" : text;
  await handleIdleMessage(ctx, vkUserId, effectiveText);
}

// ─────────────────────────────────────────────────────────────────────────────
// A — Activation via ref link
// ─────────────────────────────────────────────────────────────────────────────

async function handleRefActivation(
  ctx: MessageContext,
  vkUserId: number,
  rawCode: string
): Promise<void> {
  const isGuideMode = rawCode.startsWith("GD") && rawCode.length === 9;
  const code = isGuideMode ? rawCode.substring(2) : rawCode;

  // Case-insensitive code lookup
  const wbCode = await (db as any).wbCode.findFirst({
    where: { code: { equals: code, mode: "insensitive" } },
  });
  if (!wbCode) {
    await ctx.reply("❌ Код не найден. Проверь правильность ввода на карточке.\n\nНужна помощь? https://t.me/RobloxBank_PA");
    return;
  }
  // Block only when code was truly completed (isUsed=true + userId set).
  // isUsed=false + userId set = TG provisional claim — don't block VK activation.
  if (wbCode.isUsed && wbCode.userId) {
    await ctx.reply("⚠️ Этот код уже был активирован.\n\nЕсли карточка твоя — напиши нам: https://t.me/RobloxBank_PA");
    return;
  }

  // Fetch real name from VK API
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
    user = await (db as any).user.update({
      where: { vkId: String(vkUserId) },
      data:  { name: fullName },
    });
  }

  // If code is CLAIMED by a different user, block
  if (wbCode.status === "CLAIMED" && wbCode.userId && wbCode.userId !== user.id) {
    await ctx.reply("⚠️ Этот код уже был активирован другим пользователем.\nНапиши нам: https://t.me/RobloxBank_PA");
    return;
  }

  const totalAmount = wbCode.denomination + (user.balance || 0);
  const passPrice = Math.ceil(totalAmount / 0.7);
  const custStatus = await getCustomerStatus(String(vkUserId), "VK");
  const firstName = fullName.split(" ")[0] || "друг";
  const greetLine = getGreeting(custStatus, firstName);

  setState(vkUserId, { type: "AWAITING_LINK", wbCode: wbCode.code, denomination: totalAmount });

  let bonusText = "";
  if (user.balance && user.balance > 0) {
    bonusText = `🎁 Использован бонус: ${user.balance} R$!\n` +
                `💎 Итого к выдаче: ${totalAmount} R$\n\n`;
  } else {
    bonusText = `💎 Номинал: ${wbCode.denomination} R$\n\n`;
  }

  // ── Provisional order: claim code + notify admins BEFORE subscription gate ──
  // Mirrors TG flow — user identity is captured even if they skip the sub check.
  let provisionalCreated = false;
  try {
    await (db as any).$transaction(async (tx: any) => {
      const existingOrder = await tx.wbOrder.findUnique({ where: { wbCode: wbCode.code } });
      if (existingOrder) return;
      await tx.wbCode.update({
        where: { code: wbCode.code },
        data: { userId: user.id, status: "CLAIMED", isUsed: false },
      });
      await tx.wbOrder.create({
        data: {
          amount: totalAmount,
          gamepassUrl: null,
          status: "AWAITING_GAMEPASS",
          platform: "VK",
          userId: user.id,
          wbCode: wbCode.code,
        },
      });
      provisionalCreated = true;
    });
  } catch (err) {
    console.error("[VK] Provisional order creation failed:", err);
  }

  if (provisionalCreated) {
    try {
      const dateStr = new Date().toLocaleString("ru-RU", {
        timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit",
        year: "numeric", hour: "2-digit", minute: "2-digit",
      }) + " МСК";
      const notifyText =
        `📥 <b>НОВЫЙ КЛИЕНТ</b>\n` +
        `━━━━━━━━━━━━━━━━\n` +
        (isGuideMode ? `📖 Режим: <b>Инструкция</b>\n` : ``) +
        `📅 Время: <b>${dateStr}</b>\n` +
        `👤 Юзер: <a href="https://vk.com/id${vkUserId}">${fullName}</a> (VK ID: ${vkUserId})\n` +
        `💎 Сумма: <b>${totalAmount} R$</b> (Геймпасс: ${passPrice} R$)\n` +
        `🔑 Код ВБ: <code>${code}</code>\n` +
        `📊 Статус: ⌛ Ожидаем ссылку на геймпасс`;

      const chatIds = [
        ...ADMIN_IDS,
        ...((process.env.TG_CHAT_ID ?? "").split(",").map((s) => s.trim()).filter((s) => s && !ADMIN_IDS.includes(s))),
      ];
      await Promise.allSettled(chatIds.map((id) => tgSend(id, notifyText)));
    } catch (err) {
      console.error("[VK] Admin provisional notify error:", err);
    }
  }

  // ── Subscription gate (after order is created so admin always gets the lead) ──
  if (!(await isVkSubscribed(ctx, vkUserId))) {
    await sendVkSubPrompt(ctx, rawCode);
    return;
  }

  if (isGuideMode) {
    await ctx.reply(
      greetLine + `\n` +
      `✅ Код ${code} активирован! Номинал: ${totalAmount} R$\n\n` +
      `Теперь создай геймпасс в Roblox:\n` +
      `1️⃣ Creator Hub → твоя игра → Monetization → Passes → Create a Pass\n` +
      `2️⃣ Установи цену ровно ${passPrice} R$\n` +
      `3️⃣ Включи «On Sale» и сохрани\n` +
      `4️⃣ Пришли ссылку на геймпасс сюда 👇\n\n` +
      `Подробная инструкция: https://robloxbank.ru/guide?source=wb&skip=1&code=${code}`
    );
  } else {
    await ctx.reply(
    {
      message:
        greetLine + `\n` +
        `✅ Код ${code} активирован!\n` +
        bonusText +
        `Теперь создай геймпасс в Roblox и пришли на него ссылку сюда.\n` +
        `📌 Цена геймпасса должна быть ровно ${passPrice} R$\n` +
        `(это номинал ÷ 0.7 — Roblox удерживает 30% комиссии)\n\n` +
        `❓ Что такое геймпасс и как его создать — в инструкции:\n` +
        `👉 https://www.robloxbank.ru/guide?source=wb&skip=1&code=${code}\n\n` +
        `Пришли ссылку на геймпасс 👇`,
      keyboard: vkSupportKb("general"),
    });
  }
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
    await ctx.reply({
      message:
        "⚠️ Не удалось распознать геймпасс.\n\n" +
        "Пришли одно из:\n" +
        "• Ссылку: https://www.roblox.com/game-pass/1234567/...\n" +
        "• Ссылку из конструктора: https://create.roblox.com/...\n" +
        "• Просто ID (только цифры): 1234567",
      keyboard: vkSupportKb("pass_format"),
    });
    return;
  }

  // ── Roblox API validation ─────────────────────────────────────────────
  // Warn the user — validation can take 10–30 s via bridge/retries.
  await ctx.reply("⏳ Проверяем геймпасс…");
  const expectedPrice = Math.ceil(denomination / 0.7);
  const gamepassInfo  = await getGamepassDetails(passId);

  if (!gamepassInfo) {
    // Roblox returned HTTP responses but no usable data → gamepass doesn't exist
    await ctx.reply(
      "❌ Геймпасс не найден на Roblox.\n\n" +
      "Убедись, что:\n" +
      "• Геймпасс опубликован (не в черновиках)\n" +
      "• Ссылка ведёт именно на Game Pass, а не на саму игру\n" +
      "• Ты скопировал ссылку прямо из браузера Roblox\n\n" +
      "Если геймпасс точно существует — напиши в поддержку: https://t.me/RobloxBank_PA"
    );
    return;
  }

  let validatedCreator: string | null = null;
  let validatedPrice: number | null = null;
  if (!gamepassInfo.validationSkipped) {
    // Normal validation — only runs when Roblox API was reachable
    if (!gamepassInfo.isActive) {
      await ctx.reply({
        message:
          `⚠️ Геймпасс №${passId} не выставлен на продажу.\n\n` +
          `Убедись, что он активен и доступен для покупки, затем пришли ссылку снова.`,
        keyboard: vkSupportKb("pass_inactive"),
      });
      return;
    }

    if (Math.abs(gamepassInfo.price - expectedPrice) > 2) {
      await ctx.reply({
        message:
          `⚠️ Цена геймпасса не совпадает с ожидаемой.\n\n` +
          `Установлено: ${gamepassInfo.price} R$\n` +
          `Ожидается:   ${expectedPrice} R$\n\n` +
          `Измени цену геймпасса в настройках Roblox и пришли ссылку снова.`,
        keyboard: vkSupportKb("pass_price"),
      });
      return;
    }

    // Store validated info for the merged confirmation message below
    validatedCreator = gamepassInfo.creatorName ?? null;
    validatedPrice = gamepassInfo.price;
  } else {
    // Network-down fallback — Roblox API unreachable
    console.warn(
      `[VK] Roblox API unreachable — accepting passId=${passId} without validation. ` +
      `Admin must verify price manually.`
    );
    await ctx.reply(
      `⚠️ Не удалось автоматически проверить геймпасс — серверы Roblox временно недоступны.\n\n` +
      `Убедись, что цена геймпасса установлена ровно ${Math.ceil(denomination / 0.7)} R$. ` +
      `Мы проверим вручную — просто жди уведомления.`
    );
    // Alert admins
    const alertText =
      `⚠️ РУЧНАЯ ПРОВЕРКА (VK)\n` +
      `Roblox API недоступен — геймпасс принят без проверки цены.\n` +
      `Pass ID: ${passId} · Ожидаемая цена: ${Math.ceil(denomination / 0.7)} R$`;
    const { tgSend } = await import("../shared/notify");
    const chatIds = [
      ...ADMIN_IDS,
      ...((process.env.TG_CHAT_ID ?? "").split(",").map((s: string) => s.trim()).filter((s: string) => s && !ADMIN_IDS.includes(s))),
    ];
    await Promise.allSettled(chatIds.map((id: string) => tgSend(id, alertText)));
  }
  // ── End Roblox validation ─────────────────────────────────────────────

  const cleanLink = `https://www.roblox.com/game-pass/${passId}`;

  const user = await (db as any).user.findUnique({ where: { vkId: String(vkUserId) } });
  if (!user) {
    await ctx.reply("Ошибка сессии. Напиши нам: https://t.me/RobloxBank_PA — разберёмся вместе.");
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
          code: { equals: wbCode, mode: "insensitive" },
          OR: [
            { userId: null },
            { status: "CLAIMED", isUsed: false, userId: user.id }, // provisional from handleRefActivation
          ],
        },
        data: { userId: user.id, isUsed: true, status: "CLAIMED", usedAt: new Date() },
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

      // Check if an order already exists for this WB code.
      // Since wbCode is @unique, we can only have one record per code.
      const existingOrder = await tx.wbOrder.findUnique({
        where: { wbCode: wbCode }
      });

      let newOrder;
      if (existingOrder) {
        if (existingOrder.status === "AWAITING_GAMEPASS" || existingOrder.status === "REJECTED") {
          // Promote provisional/rejected order to PENDING with the gamepass link
          newOrder = await tx.wbOrder.update({
            where: { id: existingOrder.id },
            data: {
              gamepassUrl: cleanLink,
              status: "PENDING",
              rejectionReason: null,
              adminId: null,
            },
          });
        } else {
          // Already processing or completed
          throw Object.assign(new Error("Order already exists"), { code: "P2002" });
        }
      } else {
        // Fresh order
        newOrder = await tx.wbOrder.create({
          data: {
            amount:      denomination,
            gamepassUrl: cleanLink,
            status:      "PENDING",
            platform:    "VK",
            userId:      user.id,
            wbCode,
          },
        });
      }

      if (user.balance && user.balance > 0) {
        await tx.user.update({ where: { id: user.id }, data: { balance: 0 } });
      }

      return newOrder;
    });
  } catch (err: any) {
    if (err.isClaimed) {
      clearState(vkUserId);
      await ctx.reply("⚠️ Этот код уже был активирован другим пользователем. Обратись в поддержку.\nhttps://t.me/RobloxBank_PA");
      return;
    }
    if (err.code === "P2002") {
      clearState(vkUserId);
      await ctx.reply("⚠️ Заявка по этому коду уже создана и сейчас обрабатывается. Напиши «статус» чтобы проверить.\n\nНужна помощь? https://t.me/RobloxBank_PA");
      return;
    }
    console.error("[VK] Order/transaction error:", err);
    await ctx.reply("❌ Ошибка при создании заявки. Попробуй позже или напиши нам: https://t.me/RobloxBank_PA");
    return;
  }

  clearState(vkUserId);

  const creatorLine = validatedCreator ? `\n👤 Создатель: ${validatedCreator}` : "";
  const priceLine = validatedPrice != null ? `\n💰 Цена: ${validatedPrice} R$` : "";
  await ctx.reply({
    message:
      `🎉 Отлично, заявка принята!` +
      creatorLine +
      priceLine +
      `\n\n🆔 Номер заявки: ${order.id.slice(-6).toUpperCase()}\n\n` +
      `⏳ Выкупим в течение нескольких часов — обычно быстрее. Напишем как будет готово.`,
    keyboard: Keyboard.builder()
      .textButton({ label: "📊 Статус заявки", payload: { command: "status" }, color: "positive" })
      .inline(),
  });

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
        "После проверки администратором ты получишь +100 R$."
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
    if (!order || !linked) {
      await ctx.reply(
        "📸 У тебя сейчас нет выполненных заявок, ожидающих отзыва.\n\n" +
        "Если у тебя возникла проблема или вопрос — напиши в поддержку: https://t.me/RobloxBank_PA"
      );
      return;
    }
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

  // ── PRIORITY 0: Subscription gate for idle messages ────────────────────
  // Runs before loyalty/state logic. Fail-open: if the VK API is down,
  // isVkSubscribed returns true and the user is not blocked.
  if (process.env.VK_GROUP_ID) {
    const subbed = await isVkSubscribed(ctx, vkUserId);
    if (!subbed) {
      await sendVkSubPrompt(ctx, null);
      return;
    }
  }

  // ── PRIORITY 1: Direct WB code entry (7 alphanumeric chars, at least one letter) ──
  if (/^[A-Za-z0-9]{7}$/.test(text.trim()) && /[A-Za-z]/.test(text.trim())) {
    await handleRefActivation(ctx, vkUserId, text.trim().toUpperCase());
    return;
  }

  // ── PRIORITY 2: Loyalty check FIRST for every idle message ─────────────
  const status = await getCustomerStatus(String(vkUserId), "VK");
  console.log(`[VK] User ${vkUserId} isReturning: ${status.isReturning}, orderCount: ${status.orderCount}`);

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
      "⚠️ Сначала активируй код с WB-карты — напиши его прямо сюда или на сайте:\n" +
      "🔗 https://robloxbank.ru/guide?source=wb\n\n" +
      "После активации пришли ссылку на геймпасс.\n" +
      "Нужна помощь? https://t.me/RobloxBank_PA"
    );
    return;
  }

  // "статус" keyword (also triggered via payload routing in handleMessage) → show last order in rich format
  if (lower.includes("статус") || lower.includes("заявк")) {
    const user = await (db as any).user.findUnique({ where: { vkId: String(vkUserId) } });
    if (!user) {
      await ctx.reply(
        "У тебя пока нет заявок.\n\n" +
        "Есть код с WB-карты? Напиши его прямо сюда — и мы всё оформим.\n" +
        "Нужна помощь? https://t.me/RobloxBank_PA"
      );
      return;
    }

    const order = await (db as any).wbOrder.findFirst({
      where:   { userId: user.id },
      orderBy: { createdAt: "desc" },
    });

    if (!order) {
      await ctx.reply("У тебя пока нет заявок.\n\nЕсть код с WB-карты? Напиши его прямо сюда.\nНужна помощь? https://t.me/RobloxBank_PA");
      return;
    }

    const label: Record<string, string> = {
      AWAITING_GAMEPASS: "⌛ Ожидаем геймпасс",
      PENDING:           "⏳ В обработке",
      IN_PROGRESS:       "🔧 В работе",
      COMPLETED:         "✅ Выполнен",
      REJECTED:          "❌ Отклонён",
    };

    const passPrice = Math.ceil((order.amount as number) / 0.7);
    const shortId   = (order.id as string).slice(-6).toUpperCase();
    const statusStr = label[order.status] ?? order.status;

    // For COMPLETED: check if review bonus was already claimed
    let reviewClaimed = true;
    if (order.status === "COMPLETED") {
      try {
        const wbCodeRec = await (db as any).wbCode.findFirst({ where: { code: order.wbCode } });
        reviewClaimed = wbCodeRec?.reviewBonusClaimed ?? true;
      } catch {}
    }

    const hint =
      order.status === "AWAITING_GAMEPASS"
        ? `\n\nПришли ссылку на геймпасс с ценой ${passPrice} R$ — и мы возьмём в работу!`
        : order.status === "PENDING"
        ? "\n\nНе переживай — менеджер работает в порядке очереди, обычно выкупаем в течение нескольких часов, максимум сутки. Напишем сами."
        : order.status === "IN_PROGRESS"
        ? "\n\n🔧 Менеджер уже работает над твоей заявкой. Скоро всё будет готово!"
        : order.status === "COMPLETED"
        ? (reviewClaimed
            ? "\n\n🚀 Хочешь заказать ещё? Постоянным клиентам — прямое обслуживание без очереди по лучшему курсу! Пиши: https://t.me/RobloxBank_PA"
            : "\n\n🎁 Оставь отзыв на Wildberries и получи +100 R$ бонусом!\nСделай скриншот отзыва и пришли его сюда фотографией.")
        : order.status === "REJECTED"
        ? `\n\n${order.rejectionReason ? `Причина: ${order.rejectionReason}\n\n` : ""}Исправь геймпасс и нажми кнопку ниже — отправим на проверку заново.`
        : "";

    const gamepassLine = order.gamepassUrl ? `🔗 ${order.gamepassUrl}\n` : "";

    const keyboard =
      order.status === "REJECTED"
        ? Keyboard.builder()
            .textButton({ label: "🔄 Исправить ссылку", payload: { command: "resubmit", code: order.wbCode }, color: "primary" })
            .inline()
        : order.status === "COMPLETED" && reviewClaimed
        ? Keyboard.builder()
            .textButton({ label: "💬 Заказать ещё", payload: { command: "support", context: "general" }, color: "positive" })
            .inline()
        : undefined;

    await ctx.reply({
      message:
        `📦 Заявка #${shortId}\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `💎 Сумма: ${order.amount} R$ (Геймпасс: ${passPrice} R$)\n` +
        `🔑 Код ВБ: ${order.wbCode}\n` +
        gamepassLine +
        `📊 Статус: ${statusStr}` +
        hint,
      ...(keyboard ? { keyboard } : {}),
    });
    return;
  }

  // Try to restore a pending WB code before falling back to the greeting.
  const restored = await tryRestoreState(vkUserId);
  if (restored) {
    const restoredState = getState(vkUserId) as { type: "AWAITING_LINK"; wbCode: string; denomination: number };
    const passPrice = Math.ceil(restoredState.denomination / 0.7);
    const firstName = await vkGetName(vkUserId);
    await ctx.reply({
      message:
        `${getGreeting(status, firstName)}\n` +
        `✅ У тебя есть активный код ${restoredState.wbCode}!\n` +
        `💎 Номинал: ${restoredState.denomination} R$\n\n` +
        `Осталось совсем чуть-чуть — пришли ссылку на геймпасс.\n` +
        `📌 Цена геймпасса должна быть ровно ${passPrice} R$\n\n` +
        `Жду ссылку 👇`,
      keyboard: vkSupportKb("general"),
    });
    return;
  }

  // ── PRIORITY 2: IDLE greeting ──────────────────────────────────────────
  const firstName = await vkGetName(vkUserId);

  if (status.isReturning) {
    // IDLE state: upsell to direct sales, no gamepass instructions
    await ctx.reply({
      message: getIdleGreeting(status, firstName) + "\n\nНужна помощь? https://t.me/RobloxBank_PA",
      keyboard: Keyboard.builder()
        .textButton({ label: "📊 Статус заявки", payload: { command: "status" }, color: "primary" })
        .row()
        .textButton({ label: "💬 Нужна помощь?", payload: { command: "support", context: "general" }, color: "secondary" })
        .inline(),
    });
  } else {
    const greeting = getGreeting(status, firstName);
    await ctx.reply(
      `${greeting}Я помогаю обменять карты Wildberries на робуксы в Roblox.\n\n` +
      `Вот что я умею:\n` +
      `• Напиши 7-значный код с карты WB — оформлю заявку\n` +
      `• Напиши «статус» — покажу статус твоей заявки\n` +
      `• Пришли ссылку на геймпасс — приму в работу\n\n` +
      `Инструкция по активации: https://robloxbank.ru/guide?source=wb\n` +
      `Нужна живая помощь? https://t.me/RobloxBank_PA`
    );
  }
}
