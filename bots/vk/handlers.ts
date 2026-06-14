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
import { sendAdminOrderCard, sendAdminReviewCard, sendAdminDirectOrderCard, sendAdminPaymentCard, notifySupportShown, ADMIN_IDS, DIRECT_RATE, DIRECT_PACKS } from "../shared/admin";
import { vkGetName, tgSend, vkSend, escapeHtml } from "../shared/notify";
import { getState, setState, clearState } from "./session";
import { Keyboard } from "vk-io";
import { getGamepassDetails } from "../shared/roblox";
import { searchGamepassesByNick, type GamepassSearchOutcome } from "../shared/gamepass-search";

// VK API instance injected from bot.ts to avoid circular import.
let _vkApi: any = null;

// ── Live-support pause ──────────────────────────────────────────────────────
// When a user taps support, the manager joins THIS VK dialog and chats directly.
// While that conversation is active the bot must stay silent on free text — else
// the user's replies to the manager get parsed as gamepass links and the bot
// spams "не принял ссылку" on top of the human chat. Keyed by VK user id → expiry.
const SUPPORT_PAUSE_MS = 30 * 60 * 1000;
const RESUME_KEYWORDS  = ["+бот", "+bot", "бот+"];
const supportPause = new Map<number, number>();

function pauseSupport(vkUserId: number): void {
  supportPause.set(vkUserId, Date.now() + SUPPORT_PAUSE_MS);
}
function isSupportPaused(vkUserId: number): boolean {
  const exp = supportPause.get(vkUserId);
  if (!exp) return false;
  if (Date.now() < exp) return true;
  supportPause.delete(vkUserId); // expired
  return false;
}
function refreshSupportPause(vkUserId: number): void {
  if (supportPause.has(vkUserId)) supportPause.set(vkUserId, Date.now() + SUPPORT_PAUSE_MS);
}
function resumeSupport(vkUserId: number): void {
  supportPause.delete(vkUserId);
}

/** After the manager hands control back, nudge the user to continue the bot flow. */
async function rePromptAfterSupport(vkUserId: number): Promise<void> {
  try {
    if (!_vkApi) return;
    let state = getState(vkUserId);
    if (state?.type !== "AWAITING_LINK") {
      // No ctx here — orphan recovery falls back to setState (no full activation flow).
      await tryRestoreState(vkUserId);
      state = getState(vkUserId);
    }
    let msg = "🤖 Бот снова на связи!";
    if (state?.type === "AWAITING_LINK") {
      const passPrice = Math.ceil(state.denomination / 0.7);
      msg = `🤖 Бот снова на связи! Пришли свой ник в Roblox — найду геймпасс сам 🔎\n📌 Цена геймпасса: ${passPrice} R$\n\nТакже можно прислать ссылку или Asset ID.`;
    }
    await _vkApi.messages.send({ peer_id: vkUserId, message: msg, random_id: Date.now() + Math.floor(Math.random() * 1000) });
  } catch (e) {
    console.error("[VK] rePromptAfterSupport failed:", e);
  }
}

// Natural-language ways a user might ask for a human — so support is reachable by
// simply writing, not only via the button. Substring match (stems cover endings).
const SUPPORT_WORDS = ["оператор", "поддержк", "менеджер", "помощь", "помоги", "саппорт", "support", "живой человек", "живого человека", "жалоб"];

/** Single entry point for "user wants a manager": alert admins, pause the bot,
 *  and reply with a clear explanation of what happens next. */
async function triggerSupport(ctx: any, vkUserId: number, ctxKey: string): Promise<void> {
  const firstName = await vkGetName(vkUserId);
  const state     = getState(vkUserId);
  let wbCode = state?.type === "AWAITING_LINK" ? state.wbCode       : undefined;
  let denom  = state?.type === "AWAITING_LINK" ? state.denomination : undefined;
  if (!wbCode) {
    try {
      const u = await (db as any).user.findUnique({ where: { vkId: String(vkUserId) }, select: { id: true } });
      if (u) {
        const o = await (db as any).wbOrder.findFirst({
          where: { userId: u.id }, orderBy: { updatedAt: "desc" }, select: { wbCode: true, amount: true },
        });
        if (o) { wbCode = o.wbCode; denom = o.amount; }
      }
    } catch {}
  }
  // Deduped — double-tap inside 30 min won't spam admins. VK button already
  // fires on real tap (via payload callback), so this is a true SOS.
  await notifySupportShown({
    platform: "VK", userDisplay: `vk.com/id${vkUserId} (${escapeHtml(firstName)})`,
    contextKey: ctxKey, wbCode, denomination: denom,
  });
  pauseSupport(vkUserId); // bot goes quiet so it won't interrupt the live chat
  await ctx.reply(
    "✅ Готово! Передал твоё обращение менеджеру — он скоро ответит прямо здесь, в этом чате.\n\n" +
    "Опиши, пожалуйста, что случилось, одним сообщением 👇\n" +
    "Пока идёт диалог с менеджером, бот не вмешивается. Вернуть бота можно командой «+бот».\n\n" +
    "Если удобнее в Telegram — поддержка там: https://t.me/RobloxBank_PA"
  );
}

/** Format roubles with thousands separator, e.g. 3500 → "3 500 ₽". */
function fmtRub(n: number): string {
  if (n >= 1000) return `${Math.floor(n / 1000)} ${String(n % 1000).padStart(3, "0")} ₽`;
  return `${n} ₽`;
}

/** Build VK inline keyboard with predefined Robux packs and their ruble prices. */
function buildVkPackKb(userBonus = 0) {
  const kb = Keyboard.builder();
  const rows: (readonly number[])[] = [
    DIRECT_PACKS.slice(0, 3) as unknown as readonly number[],  // 100, 200, 300
    DIRECT_PACKS.slice(3, 6) as unknown as readonly number[],  // 500, 800, 1000
    DIRECT_PACKS.slice(6, 8) as unknown as readonly number[],  // 2000, 5000
    DIRECT_PACKS.slice(8)    as unknown as readonly number[],  // 10000
  ];
  for (const row of rows) {
    for (const amt of row) {
      const tag = userBonus > 0 && amt >= 1000 ? ` +${userBonus}🎁` : "";
      kb.textButton({
        label: `${amt}${tag} R$ — ${fmtRub(Math.round(amt * DIRECT_RATE))}`,
        payload: { command: "direct_pack", amount: amt },
        color: amt >= 1000 && userBonus > 0 ? "positive" : "primary",
      });
    }
    kb.row();
  }
  kb.textButton({ label: "❌ Отмена", payload: { command: "direct_cancel" }, color: "negative" });
  return kb.inline();
}
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
 * WB code that doesn't yet have a WbOrder. Three possible outcomes:
 *  - "none":      no recoverable state — caller shows the idle greeting
 *  - "restored":  existing AWAITING_GAMEPASS/REJECTED order found, in-memory
 *                 state set to AWAITING_LINK — caller shows the "active code" recap
 *  - "handled":   orphan WB code (linked by auth.ts but ref never reached the bot)
 *                 was promoted via handleRefActivation — it has already sent the
 *                 full welcome with the instruction link and created the provisional
 *                 WbOrder + admin notification, so the caller must return immediately
 *
 * `ctx` is optional: when omitted (e.g. rePromptAfterSupport, which has no message
 * context), orphan recovery degrades to the legacy setState behaviour.
 */
type RestoreOutcome = "none" | "restored" | "handled";

async function tryRestoreState(vkUserId: number, ctx?: MessageContext): Promise<RestoreOutcome> {
  try {
    const user = await (db as any).user.findUnique({ where: { vkId: String(vkUserId) } });
    if (!user) return "none";

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
    if (recoverable) {
      setState(vkUserId, {
        type:         "AWAITING_LINK",
        wbCode:       recoverable.wbCode,
        denomination: recoverable.amount,
      });
      return "restored";
    }

    // Orphan-code fallback: the site (auth.ts) can link a code (CLAIMED + userId)
    // before the user reaches the bot, but the provisional WbOrder is only created
    // inside handleRefActivation. If VK never delivered the `ref`, that handler
    // never ran → the code is CLAIMED to this user with NO order, and the order
    // lookup above finds nothing. Run handleRefActivation now to catch the user up:
    // they get the full welcome with the gamepass-instruction link, and the manager
    // gets the provisional-order admin card they would have missed.
    const orphanCandidates = await (db as any).wbCode.findMany({
      where: {
        userId:    user.id,
        status:    "CLAIMED",
        isUsed:    false,
        updatedAt: { gte: thirtyDaysAgo },
      },
      orderBy: { updatedAt: "desc" },
      take: 5,
    });
    for (const code of orphanCandidates) {
      const order = await (db as any).wbOrder.findUnique({ where: { wbCode: code.code } });
      if (!order) {
        if (ctx) {
          await handleRefActivation(ctx, vkUserId, code.code);
          return "handled";
        }
        setState(vkUserId, {
          type:         "AWAITING_LINK",
          wbCode:       code.code,
          denomination: code.denomination,
        });
        return "restored";
      }
    }
    return "none";
  } catch (err) {
    // Non-fatal: DB timeout or connectivity issue — bot continues without auto-restore
    console.error("[VK] tryRestoreState failed:", err);
    return "none";
  }
}

// ── Util ──────────────────────────────────────────────────────────────────────

/** Best available URL from a VK photo attachment. */
function photoUrl(attachment: unknown): string | undefined {
  const ph = attachment as any;
  // vk-io v4: computed getter works when $filled=true
  if (typeof ph?.largeSizeUrl === "string") return ph.largeSizeUrl;
  // Walk sizes — check all possible locations in vk-io objects and raw VK API payloads.
  // ph.sizes        → vk-io getter (this.payload.sizes)
  // ph.payload.sizes → direct payload access when getter is unreliable
  // ph.photo.sizes  → raw attachment { type:"photo", photo:{ sizes:[...] } }
  const sizes: Array<{ width?: number; height?: number; url?: string }> =
    ph?.sizes ?? ph?.payload?.sizes ?? ph?.photo?.sizes ?? [];
  if (sizes.length > 0) {
    const withUrl = sizes.filter((s: any) => typeof s.url === "string");
    if (withUrl.length > 0) {
      return withUrl.sort((a: any, b: any) =>
        (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0)
      )[0].url;
    }
  }
  return typeof ph?.url === "string" ? ph.url : undefined;
}

/**
 * Attempts every known path to extract a VK photo URL:
 * 1. Direct vk-io attachment (parsed by library)
 * 2. Raw message.attachments array
 * 3. Forwarded messages (fwd_messages) — user may forward a screenshot
 * 4. VK API photos.getById — last-resort when payload has no sizes
 */
async function extractPhotoUrl(ctx: MessageContext): Promise<string | undefined> {
  // 1. vk-io parsed attachment
  if (ctx.hasAttachments("photo")) {
    const url = photoUrl(ctx.getAttachments("photo")[0]);
    if (url) return url;
  }

  // 2. Raw message.attachments
  const rawAttachments: any[] = (ctx as any).message?.attachments ?? (ctx as any).attachments ?? [];
  const rawPhoto = rawAttachments.find((a: any) => a.type === "photo")?.photo;
  if (rawPhoto) {
    const url = photoUrl(rawPhoto);
    if (url) return url;
  }

  // 3. Photos inside forwarded/replied messages
  const fwdMsgs: any[] = (ctx as any).message?.fwd_messages ?? [];
  const replyMsg: any = (ctx as any).message?.reply_message;
  const allFwd = replyMsg ? [replyMsg, ...fwdMsgs] : fwdMsgs;
  for (const fwd of allFwd) {
    const fwdPhoto = (fwd?.attachments ?? []).find((a: any) => a.type === "photo")?.photo;
    if (fwdPhoto) {
      const url = photoUrl(fwdPhoto);
      if (url) return url;
    }
  }

  // 4. VK API photos.getById — fetch full payload with sizes
  if (_vkApi) {
    // Collect all candidate photo refs (id + owner_id pairs)
    const candidates: Array<{ id: number; ownerId: number; accessKey?: string }> = [];

    if (ctx.hasAttachments("photo")) {
      const att = ctx.getAttachments("photo")[0] as any;
      if (att?.id && att?.ownerId) candidates.push({ id: att.id, ownerId: att.ownerId, accessKey: att.accessKey });
    }
    const allRawAtts = [
      ...rawAttachments,
      ...allFwd.flatMap((m: any) => m?.attachments ?? []),
    ];
    for (const a of allRawAtts) {
      const p = a?.photo;
      if (p?.id && p?.owner_id) candidates.push({ id: p.id, ownerId: p.owner_id, accessKey: p.access_key });
    }

    for (const c of candidates) {
      try {
        const key = `${c.ownerId}_${c.id}${c.accessKey ? "_" + c.accessKey : ""}`;
        const result: any[] = await _vkApi.photos.getById({ photos: key });
        if (Array.isArray(result) && result[0]) {
          const url = photoUrl(result[0]);
          if (url) return url;
        }
      } catch (err) {
        console.warn("[VK] photos.getById fallback failed:", (err as any)?.message ?? err);
      }
    }
  }

  return undefined;
}

function vkUserDisplay(name: string, vkUserId: number): string {
  // Names go into HTML admin cards — escape so "<Имя>" can't break the message.
  return `<a href="https://vk.com/id${vkUserId}">${escapeHtml(name)}</a>`;
}

/** Generate a unique synthetic WB code for direct orders (never matches a real 7-char code). */
function generateDirectCode(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "DIR-";
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
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
  if (ctx.isOutbox) {
    // Manager replied from the community. Keep the bot paused while the live
    // conversation is active; let the manager hand control back with a keyword.
    const peer = typeof (ctx as any).peerId === "number" ? (ctx as any).peerId : undefined;
    if (peer !== undefined) {
      const t = (ctx.text ?? "").trim().toLowerCase();
      if (RESUME_KEYWORDS.includes(t)) {
        resumeSupport(peer);
        void rePromptAfterSupport(peer);
      } else {
        refreshSupportPause(peer);
      }
    }
    return; // never process community's own messages as user input
  }

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
    await triggerSupport(ctx, vkUserId, String(msgPayload.context ?? "general"));
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
        await ctx.reply({
          message:
            `🔄 Исправление ссылки\n\n💎 Номинал: ${order.amount} R$\n` +
            `📌 Цена геймпасса: ${passPrice} R$\n\n` +
            `Пришли свой ник в Roblox — найду геймпасс сам 🔎\nИли отправь ссылку / Asset ID.\n\n` +
            `Если нужна помощь — https://t.me/RobloxBank_PA`,
          keyboard: Keyboard.builder()
            .textButton({ label: "🔎 Найти по моему нику Roblox", payload: { command: "find_gp_start" }, color: "primary" })
            .row()
            .textButton({ label: "💬 Нужна помощь?", payload: { command: "support", context: "general" }, color: "secondary" })
            .inline(),
        });
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
          `✅ Подписка подтверждена!\n\n` +
          `Пришли свой ник в Roblox — найду геймпасс сам 🔎\n` +
          `📌 Цена геймпасса: ${passPrice} R$\n\n` +
          `Также можно прислать ссылку или Asset ID.`
        );
      } else {
        await ctx.reply("✅ Спасибо за подписку! Теперь ты можешь активировать свой код с карточки Wildberries.");
      }
      return;
    } catch (err) {
      console.error("[VK] check_sub handler failed:", err);
      await ctx.reply("Не удалось проверить подписку — попробуй ещё раз через минуту.\n\nЕсли проблема повторяется — напиши нам: https://t.me/RobloxBank_PA");
      return; // don't fall through to the idle pipeline — avoids a second reply
    }
  }

  // ── Natural-language support request — user can reach a manager by simply
  // writing ("оператор", "поддержка", "помощь"…), not only via the button.
  // Skip when the message carries a recognisable gamepass link/ID — «помоги,
  // вот ссылка …» must reach the flow, not freeze the bot for 30 minutes. ──
  if (text.length > 0 && extractPassId(text) === null && SUPPORT_WORDS.some((w) => lower.includes(w))) {
    if (isSupportPaused(vkUserId)) {
      await ctx.reply("Менеджер уже подключается и ответит прямо здесь 👇 Опиши, пожалуйста, свой вопрос одним сообщением.");
    } else {
      await triggerSupport(ctx, vkUserId, "general");
    }
    return;
  }

  // ── Live-support pause: stay silent on free text while a manager is handling
  // this chat, so the user's replies to the manager aren't parsed as links.
  // (Button payloads above — support/resubmit/check_sub — still work.)
  // The user can hand control back to the bot themselves with «+бот».
  if (isSupportPaused(vkUserId)) {
    if (RESUME_KEYWORDS.includes(lower)) {
      resumeSupport(vkUserId);
      void rePromptAfterSupport(vkUserId);
    }
    return;
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
      const isDirect = state.wbCode.startsWith("DIR-");
      await ctx.reply({
        message:
          `${getGreeting(custStatus, firstName)}\n` +
          (isDirect
            ? `✅ У тебя есть активный прямой заказ на ${state.denomination} R$!\n\n`
            : `✅ У тебя есть активный код!\n` +
              `💎 Номинал: ${state.denomination} R$\n\n`) +
          `Осталось совсем чуть-чуть — пришли свой ник в Roblox, и я найду геймпасс сам 🔎\n` +
          `📌 Цена геймпасса: ${passPrice} R$\n\n` +
          `Также можно прислать ссылку или Asset ID.\n\n` +
          `❓ Не помнишь как создать геймпасс? Инструкция со скриншотами:\n` +
          (isDirect
            ? `👉 https://robloxbank.ru/guide?source=direct`
            : `👉 https://www.robloxbank.ru/guide?source=wb&skip=1&code=${state.wbCode}`),
        keyboard: Keyboard.builder()
          .textButton({ label: "🔎 Найти по моему нику Roblox", payload: { command: "find_gp_start" }, color: "primary" })
          .row()
          .textButton({ label: "💬 Нужна помощь?", payload: { command: "support", context: "general" }, color: "secondary" })
          .inline(),
      });
      return;
    }

    // 2. Try to recover a pending WB code from DB. Orphan codes (CLAIMED by
    // site auth.ts but no order yet) are caught up via handleRefActivation —
    // it sends the full welcome with the instruction link and creates the
    // provisional order, so we return immediately on "handled".
    const outcome = await tryRestoreState(vkUserId, ctx);
    if (outcome === "handled") return;
    if (outcome === "restored") {
      const restoredState = getState(vkUserId) as { type: "AWAITING_LINK"; wbCode: string; denomination: number };
      const passPrice = Math.ceil(restoredState.denomination / 0.7);
      const custStatus = await getCustomerStatus(String(vkUserId), "VK");
      const firstName = await vkGetName(vkUserId);
      const isDirect = restoredState.wbCode.startsWith("DIR-");
      await ctx.reply({
        message:
          `${getGreeting(custStatus, firstName)}\n` +
          (isDirect
            ? `✅ У тебя есть активный прямой заказ на ${restoredState.denomination} R$!\n\n`
            : `✅ У тебя есть активный код!\n` +
              `💎 Номинал: ${restoredState.denomination} R$\n\n`) +
          `Осталось совсем чуть-чуть — пришли свой ник в Roblox, и я найду геймпасс сам 🔎\n` +
          `📌 Цена геймпасса: ${passPrice} R$\n\n` +
          `Также можно прислать ссылку или Asset ID.\n\n` +
          `❓ Не помнишь как создать геймпасс? Инструкция со скриншотами:\n` +
          (isDirect
            ? `👉 https://robloxbank.ru/guide?source=direct`
            : `👉 https://www.robloxbank.ru/guide?source=wb&skip=1&code=${restoredState.wbCode}`),
        keyboard: Keyboard.builder()
          .textButton({ label: "🔎 Найти по моему нику Roblox", payload: { command: "find_gp_start" }, color: "primary" })
          .row()
          .textButton({ label: "💬 Нужна помощь?", payload: { command: "support", context: "general" }, color: "secondary" })
          .inline(),
      });
      return;
    }

    // 3. No pending code — greet based on loyalty status
    const custStatus = await getCustomerStatus(String(vkUserId), "VK");
    console.log(`[VK] Начать command: vkUserId=${vkUserId}, isReturning=${custStatus.isReturning}`);
    if (custStatus.isReturning) {
      const firstName = await vkGetName(vkUserId);
      await ctx.reply({
        message: getIdleGreeting(custStatus, firstName) + "\n\nНужна помощь? Напиши прямо сюда — ответим здесь 👇 Если удобнее в Telegram: https://t.me/RobloxBank_PA",
        keyboard: Keyboard.builder()
          .textButton({ label: "📊 Статус заявки",   payload: { command: "status" },       color: "primary"   })
          .row()
          .textButton({ label: "💎 Купить напрямую", payload: { command: "start_direct" },  color: "positive"  })
          .row()
          .textButton({ label: "💬 Нужна помощь?",   payload: { command: "support", context: "general" }, color: "secondary" })
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

  // ── Direct order payload commands ─────────────────────────────────────────
  if (msgPayload?.command === "start_direct") {
    await handleStartDirect(ctx, vkUserId);
    return;
  }
  if (msgPayload?.command === "direct_pack") {
    const packAmt = typeof msgPayload.amount === "number" ? msgPayload.amount : NaN;
    if (!isNaN(packAmt) && (DIRECT_PACKS as readonly number[]).includes(packAmt)) {
      await handleDirectPackSelect(ctx, vkUserId, packAmt);
    }
    return;
  }
  if (msgPayload?.command === "direct_confirm") {
    await handleDirectConfirm(ctx, vkUserId);
    return;
  }
  if (msgPayload?.command === "direct_cancel") {
    clearState(vkUserId);
    await ctx.reply("Отменено.");
    return;
  }

  // ── 🔎 Find gamepass by Roblox nick (item 7) ───────────────────────────────
  if (msgPayload?.command === "find_gp_start") {
    await handleFindGpStart(ctx, vkUserId);
    return;
  }
  if (msgPayload?.command === "gp_pick" && typeof msgPayload.passId === "string") {
    await handleGpPick(ctx, vkUserId, msgPayload.passId);
    return;
  }
  if (state?.type === "AWAITING_ROBLOX_NICK") {
    await handleRobloxNickInput(ctx, vkUserId, text, state.wbCode, state.denomination);
    return;
  }

  if (state?.type === "AWAITING_LINK") {
    await handleGamepassLink(ctx, vkUserId, text, state.wbCode, state.denomination);
    return;
  }

  // ── Direct order amount input ──────────────────────────────────────────────
  if (state?.type === "AWAITING_DIRECT_AMOUNT") {
    await handleDirectAmountInput(ctx, vkUserId, text);
    return;
  }
  // AWAITING_DIRECT_CONFIRM: user should use buttons; if they type text, do nothing
  if (state?.type === "AWAITING_DIRECT_CONFIRM") {
    await ctx.reply({
      message: "Используй кнопки выше для подтверждения или отмены.",
      keyboard: Keyboard.builder()
        .textButton({ label: "✅ Подтвердить", payload: { command: "direct_confirm" }, color: "positive" })
        .textButton({ label: "❌ Отмена",      payload: { command: "direct_cancel"  }, color: "negative" })
        .inline(),
    });
    return;
  }

  // ── Direct order payment screenshot (BEFORE review routing) ───────────────
  if (ctx.hasAttachments("photo") || state?.type === "AWAITING_DIRECT_PAYMENT") {
    const photoUser = await (db as any).user.findUnique({ where: { vkId: String(vkUserId) } });
    if (photoUser) {
      const payOrder = state?.type === "AWAITING_DIRECT_PAYMENT"
        ? await (db as any).wbOrder.findUnique({ where: { id: state.orderId } })
        : await (db as any).wbOrder.findFirst({
            where: { userId: photoUser.id, status: "PAYMENT_PENDING", isDirectOrder: true },
            orderBy: { createdAt: "desc" },
          });
      if (payOrder?.status === "PAYMENT_PENDING") {
        console.log(`[VK] payment screenshot routing: vkUserId=${vkUserId} orderId=${payOrder.id}`);
        await handleDirectPaymentScreenshot(ctx, vkUserId, photoUser, payOrder.id);
        return;
      }
    }
  }

  if (state?.type === "AWAITING_REVIEW" || ctx.hasAttachments("photo")) {
    console.log(`[VK] photo routing: vkUserId=${vkUserId} hasPhoto=${ctx.hasAttachments("photo")} state=${state?.type ?? "none"}`);
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
    await ctx.reply("❌ Код не найден. Проверь правильность ввода на карточке.\n💡 Часто путают букву «О» и цифру «0» — проверь эти символы в коде.\n\nНужна помощь? Напиши прямо сюда — ответим здесь 👇 Если удобнее в Telegram: https://t.me/RobloxBank_PA");
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

  // Bonus balance is NOT applied to WB-code orders — strictly for direct bot orders only.
  const totalAmount = wbCode.denomination;
  const passPrice = Math.ceil(totalAmount / 0.7);
  const custStatus = await getCustomerStatus(String(vkUserId), "VK");
  const firstName = fullName.split(" ")[0] || "друг";
  const greetLine = getGreeting(custStatus, firstName);

  setState(vkUserId, { type: "AWAITING_LINK", wbCode: wbCode.code, denomination: totalAmount });

  let bonusText = `💎 Номинал: ${wbCode.denomination} R$\n\n`;
  if (user.balance && user.balance > 0) {
    bonusText += `💡 У тебя есть бонус ${user.balance} R$ — он применится к прямому заказу от 1000 R$ через бота (без карточки WB).\n\n`;
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
        `👤 Юзер: <a href="https://vk.com/id${vkUserId}">${escapeHtml(fullName)}</a> (VK ID: ${vkUserId})\n` +
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
      `4️⃣ Пришли свой ник в Roblox — я найду геймпасс сам 🔎\n\n` +
      `Также можно прислать ссылку или Asset ID.\n\n` +
      `Подробная инструкция: https://robloxbank.ru/guide?source=wb&skip=1&code=${code}`
    );
  } else {
    await ctx.reply(
    {
      message:
        greetLine + `\n` +
        `✅ Код ${code} активирован!\n` +
        bonusText +
        `Создай геймпасс в Roblox за ${passPrice} R$ — затем нажми кнопку «🔎 Найти по моему нику Roblox» 👇 (быстрый путь, без ссылок).\n` +
        `(${passPrice} R$ — это номинал ÷ 0.7, Roblox удерживает 30%)\n\n` +
        `Если удобнее — пришли ссылку на геймпасс сюда вручную.\n\n` +
        `❓ Что такое геймпасс и как его создать:\n` +
        `👉 https://www.robloxbank.ru/guide?source=wb&skip=1&code=${code}`,
      keyboard: Keyboard.builder()
        .textButton({ label: "🔎 Найти по моему нику Roblox", payload: { command: "find_gp_start" }, color: "primary" })
        .row()
        .textButton({ label: "💬 Нужна помощь?", payload: { command: "support", context: "general" }, color: "secondary" })
        .inline(),
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
    // The bot's own prompts promise «пришли свой ник — найду геймпасс сам».
    // Honor that: nick-looking text routes into the nick search instead of
    // a format error.
    if (ROBLOX_NICK_RE.test(input.trim().replace(/^@/, ""))) {
      await handleRobloxNickInput(ctx, vkUserId, input, wbCode, denomination);
      return;
    }
    await ctx.reply({
      message:
        "⚠️ Не удалось распознать.\n\n" +
        "Пришли одно из:\n" +
        "• Ник в Roblox (латиница, 3–20 символов)\n" +
        "• Ссылку: https://www.roblox.com/game-pass/1234567/...\n" +
        "• Просто ID (только цифры): 1234567",
      keyboard: Keyboard.builder()
        .textButton({ label: "🔎 Найти по моему нику Roblox", payload: { command: "find_gp_start" }, color: "primary" })
        .row()
        .textButton({ label: "💬 Нужна помощь?", payload: { command: "support", context: "pass_format" }, color: "secondary" })
        .inline(),
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
      "Если геймпасс точно существует — напиши сюда, ответим здесь. Или в Telegram: https://t.me/RobloxBank_PA"
    );
    return;
  }

  let validatedCreator: string | null = null;
  let validatedPrice: number | null = null;
  if (!gamepassInfo.validationSkipped) {
    // Normal validation — only runs when Roblox API was reachable
    if (!gamepassInfo.isActive) {
      if (gamepassInfo.isNotInCatalog) {
        await ctx.reply({
          message:
            `❌ Геймпасс недоступен — скорее всего, игра, в которой он создан, закрыта (Private).\n\n` +
            `Два варианта:\n` +
            `1. Открой игру: Creator Hub → Experience → Settings → Permissions → Public → сохрани. Затем пришли ссылку снова.\n` +
            `2. Создай геймпасс в любой публичной игре (цена: ${expectedPrice} R$) и пришли новую ссылку.\n\n` +
            `Не удаляй геймпасс до получения оплаты.`,
          keyboard: vkSupportKb("pass_deleted"),
        });
      } else if (gamepassInfo.isGamePrivate) {
        await ctx.reply({
          message:
            `❌ Геймпасс в закрытой игре — выкупить невозможно.\n\n` +
            `Как открыть игру:\n` +
            `1. Нажми на плейс → Configure → Settings\n` +
            `2. Найди Audience → выбери Public → сохрани\n\n` +
            `Не помогло? Configure → Questionnaire → Restart\n` +
            `Ответь «No» на все 10 вопросов → Continue\n\n` +
            `Или создай геймпасс в другой публичной игре (цена: ${expectedPrice} R$)\n\n` +
            `📖 Полная инструкция со скринами:\nhttps://robloxbank.ru/guide?source=wb&skip=1&code=${wbCode}`,
          keyboard: Keyboard.builder()
            .textButton({ label: "💬 Нужна помощь?", payload: { command: "support", context: "pass_private" }, color: "secondary" })
            .inline(),
        });
      } else {
        await ctx.reply({
          message:
            `⚠️ Геймпасс №${passId} не выставлен на продажу.\n\n` +
            `Убедись, что он активен и доступен для покупки, затем пришли ссылку снова.`,
          keyboard: vkSupportKb("pass_inactive"),
        });
      }
      return;
    }

    if (Math.abs(gamepassInfo.price - expectedPrice) > 2) {
      await ctx.reply({
        message:
          `⚠️ Цена геймпасса не совпадает с ожидаемой.\n\n` +
          `Установлено: ${gamepassInfo.price} R$\n` +
          `Ожидается:   ${expectedPrice} R$\n\n` +
          `Измени цену геймпасса в настройках Roblox и пришли ссылку снова.\n\n` +
          `💡 Если у тебя включён Regional Pricing — обязательно выключи его (Passes → Edit → Pricing → убрать галочку Enable Regional Pricing), иначе цена будет неверной.`,
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

  // Count completed/pending/rejected orders only — exclude the current provisional
  // AWAITING_GAMEPASS order so a first-time user doesn't get the "returning" badge.
  const previousOrderCount = await (db as any).wbOrder.count({
    where: { userId: user.id, status: { notIn: ["AWAITING_GAMEPASS"] } },
  }).catch(() => 0);

  // ── Atomic claim + order creation ──────────────────────────────────────
  // Roblox validation passed above — now commit in a single transaction:
  //  1. Claim the code (userId:null covers both fresh and web-pre-activated codes)
  //  2. Create the order
  // Bonus balance is preserved — only spent on direct bot orders.
  // If any step fails the whole transaction rolls back — code stays unclaimed.
  let order: any;
  try {
    order = await (db as any).$transaction(async (tx: any) => {
      const claimed = await tx.wbCode.updateMany({
        where: {
          code: { equals: wbCode, mode: "insensitive" },
          OR: [
            { status: "RESERVED" }, // site reservation — parity with the TG claim
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
              ...(validatedCreator ? { robloxUsername: validatedCreator } : {}),
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
            ...(validatedCreator ? { robloxUsername: validatedCreator } : {}),
          },
        });
      }

      // Bonus balance is preserved — only spent on direct bot orders, not WB-code orders.

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
      await ctx.reply("⚠️ Заявка по этому коду уже создана и сейчас обрабатывается. Напиши «статус» чтобы проверить.\n\nНужна помощь? Напиши прямо сюда — ответим здесь 👇 Если удобнее в Telegram: https://t.me/RobloxBank_PA");
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
    // Bonus balance is never spent on WB-code orders — passing user.balance
    // here used to falsely render «🎁 Использован бонус» on the admin card.
    previousOrderCount,
    creatorName:         validatedCreator ?? undefined,
    isAgeRestricted:     gamepassInfo.isAgeRestricted ?? false,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// B2 — Gamepass search by Roblox nick (item 7)
// ─────────────────────────────────────────────────────────────────────────────

/** Allowed Roblox username regex. */
const ROBLOX_NICK_RE = /^[A-Za-z0-9_]{3,20}$/;
/** Max gamepass matches we show as inline buttons. */
const MAX_PICK_BUTTONS = 5;

/** "🔎 Найти по моему нику" tap — set state and ask for the nick. */
async function handleFindGpStart(ctx: MessageContext, vkUserId: number): Promise<void> {
  const user = await (db as any).user.findUnique({
    where: { vkId: String(vkUserId) },
    select: { id: true },
  });
  if (!user) {
    await ctx.reply("Сессия истекла — напиши «Начать», чтобы продолжить.");
    return;
  }
  const order = await (db as any).wbOrder.findFirst({
    where: { userId: user.id, status: "AWAITING_GAMEPASS" },
    orderBy: { createdAt: "desc" },
  });
  if (!order) {
    await ctx.reply("У тебя сейчас нет активной заявки. Введи код WB чтобы начать.");
    return;
  }
  setState(vkUserId, {
    type: "AWAITING_ROBLOX_NICK",
    wbCode: order.wbCode,
    denomination: order.amount,
  });
  const passPrice = Math.ceil(order.amount / 0.7);
  await ctx.reply(
    `🔎 Введи свой ник в Roblox (то, как ты заходишь в игру).\n\n` +
    `Я найду все твои геймпассы за ${passPrice} R$ — и предложу выбрать нужный.\n` +
    `Если передумал — пришли ссылку на геймпасс как обычно.`
  );
}

/**
 * User typed a Roblox nick — same 5-branch tree as the TG version, text-only
 * (VK keyboards are text buttons; no photo card variant).
 */
async function handleRobloxNickInput(
  ctx: MessageContext,
  vkUserId: number,
  raw: string,
  wbCode: string,
  denomination: number,
): Promise<void> {
  const nick = raw.trim().replace(/^@/, "");
  if (!ROBLOX_NICK_RE.test(nick)) {
    await ctx.reply(
      "⚠️ Ник не похож на ник Roblox.\n\n" +
      "Должно быть 3–20 символов: буквы, цифры или подчёркивание. " +
      "Например: lokomotiv_2018"
    );
    return;
  }

  await ctx.reply(`🔎 Ищу геймпассы у ${nick}…`);
  const expectedPrice = Math.ceil(denomination / 0.7);

  let outcome: GamepassSearchOutcome;
  try {
    outcome = await searchGamepassesByNick(nick, expectedPrice);
  } catch (err: any) {
    // Infra failure (bridge/Roblox down) is NOT «ника нет на Roblox» — be honest.
    console.error("[VK/find-gp] searchGamepassesByNick failed:", err?.message ?? err);
    setState(vkUserId, { type: "AWAITING_LINK", wbCode, denomination });
    await ctx.reply({
      message:
        "⚠️ Поиск по нику временно недоступен — не получилось связаться с Roblox.\n\n" +
        "Попробуй ещё раз через минуту или пришли ссылку на геймпасс вручную.",
      keyboard: Keyboard.builder()
        .textButton({ label: "🔎 Попробовать ещё раз", payload: { command: "find_gp_start" }, color: "primary" })
        .row()
        .textButton({ label: "💬 Нужна помощь?", payload: { command: "support", context: "roblox_down" }, color: "secondary" })
        .inline(),
    });
    return;
  }

  // Always return to LINK state — picker handles next move via VK payload button.
  setState(vkUserId, { type: "AWAITING_LINK", wbCode, denomination });

  const guideUrl = `https://www.robloxbank.ru/guide?source=wb&skip=1&code=${wbCode}`;

  // Branch 1: nickname doesn't exist on Roblox
  if (outcome.status === "user_not_found") {
    await ctx.reply({
      message:
        `🤷 Пользователя ${nick} нет на Roblox.\n\n` +
        `Скорее всего опечатка. Скопируй ник прямо со страницы профиля и пришли заново.`,
      keyboard: Keyboard.builder()
        .textButton({ label: "🔎 Попробовать ещё раз", payload: { command: "find_gp_start" }, color: "primary" })
        .row()
        .textButton({ label: "💬 Нужна помощь?", payload: { command: "support", context: "nick_not_found" }, color: "secondary" })
        .inline(),
    });
    return;
  }

  // Branch 2: nick exists but no public for-sale gamepasses → place probably private
  if (outcome.status === "no_gamepasses") {
    await ctx.reply({
      message:
        `🙈 У ${nick} не нашли публичных геймпассов.\n\n` +
        `Самая частая причина — плейс закрыт. Открой его в настройках, тогда геймпассы станут видны:\n\n` +
        `1. Roblox → раздел Creations\n` +
        `2. Выбери свой плейс → ⚙️ Configure → Privacy\n` +
        `3. Поставь Public\n\n` +
        `Если плейс уже публичный — проверь, что геймпасс создан и выставлен на продажу за ${expectedPrice} R$.\n\n` +
        `Инструкция: ${guideUrl}`,
      keyboard: Keyboard.builder()
        .textButton({ label: "🔎 Попробовать другой ник", payload: { command: "find_gp_start" }, color: "primary" })
        .row()
        .textButton({ label: "💬 Нужна помощь?", payload: { command: "support", context: "place_closed" }, color: "secondary" })
        .inline(),
    });
    return;
  }

  // outcome.status === "ok"
  const { matches, nonMatches } = outcome;

  // Branch 5: gamepasses exist but none at expected price → show actual prices
  if (matches.length === 0) {
    const top = nonMatches.slice(0, MAX_PICK_BUTTONS);
    const listLines = top.map(g => `• ${g.name} · ${g.robux} R$`).join("\n");
    await ctx.reply({
      message:
        `У ${nick} нашли геймпассы, но ни один не за ${expectedPrice} R$:\n\n` +
        `${listLines}\n\n` +
        `Создай геймпасс ровно на ${expectedPrice} R$ или измени цену существующего — и нажми «🔎 Уже исправил».\n\n` +
        `Инструкция: ${guideUrl}`,
      keyboard: Keyboard.builder()
        .textButton({ label: "🔎 Уже исправил — проверить", payload: { command: "find_gp_start" }, color: "primary" })
        .row()
        .textButton({ label: "💬 Нужна помощь?", payload: { command: "support", context: "wrong_price" }, color: "secondary" })
        .inline(),
    });
    return;
  }

  // Branch 3: exactly 1 price-match (VK = text confirmation, no photo)
  if (matches.length === 1) {
    const m = matches[0];
    await ctx.reply({
      message:
        `🎯 Нашёл у ${nick} подходящий геймпасс:\n\n` +
        `💎 ${m.name} · ${m.robux} R$\n\n` +
        `Это он? Нажми «✅ Да» — отправлю на проверку.`,
      keyboard: Keyboard.builder()
        .textButton({ label: `✅ Да, выкупаем (${m.robux} R$)`, payload: { command: "gp_pick", passId: String(m.gamepassId) }, color: "positive" })
        .row()
        .textButton({ label: "🔎 Другой ник", payload: { command: "find_gp_start" }, color: "secondary" })
        .inline(),
    });
    return;
  }

  // Branch 4: 2–5 price-matches → text-button list
  const shown = matches.slice(0, MAX_PICK_BUTTONS);
  const kb = Keyboard.builder();
  for (const m of shown) {
    kb.textButton({
      label: `💎 ${m.name.slice(0, 32)} · ${m.robux} R$`,
      payload: { command: "gp_pick", passId: String(m.gamepassId) },
      color: "positive",
    }).row();
  }
  kb.textButton({ label: "🔎 Другой ник", payload: { command: "find_gp_start" }, color: "secondary" });
  await ctx.reply({
    message:
      `У ${nick} нашёл несколько подходящих геймпассов.\n` +
      `Выбери тот, который хочешь продать:`,
    keyboard: kb.inline(),
  });
}

/** User tapped a "💎 ${name} · ${price} R$" button → run the canonical flow. */
async function handleGpPick(
  ctx: MessageContext,
  vkUserId: number,
  passId: string,
): Promise<void> {
  if (!/^\d{3,15}$/.test(passId)) {
    await ctx.reply("⚠️ Не удалось распознать геймпасс.");
    return;
  }
  const user = await (db as any).user.findUnique({
    where: { vkId: String(vkUserId) },
    select: { id: true },
  });
  if (!user) {
    await ctx.reply("Сессия истекла — напиши «Начать».");
    return;
  }
  const order = await (db as any).wbOrder.findFirst({
    where: { userId: user.id, status: "AWAITING_GAMEPASS" },
    orderBy: { createdAt: "desc" },
  });
  if (!order) {
    await ctx.reply("У тебя сейчас нет активной заявки.");
    return;
  }
  setState(vkUserId, {
    type: "AWAITING_LINK",
    wbCode: order.wbCode,
    denomination: order.amount,
  });
  const url = `https://www.roblox.com/game-pass/${passId}`;
  await handleGamepassLink(ctx, vkUserId, url, order.wbCode, order.amount);
}

// ─────────────────────────────────────────────────────────────────────────────
// B3 — Direct order flow (no WB card needed)
// ─────────────────────────────────────────────────────────────────────────────

async function handleStartDirect(ctx: MessageContext, vkUserId: number): Promise<void> {
  // Subscription gate — same as TG bot
  if (process.env.VK_GROUP_ID) {
    const subbed = await isVkSubscribed(ctx, vkUserId);
    if (!subbed) {
      await sendVkSubPrompt(ctx, null);
      return;
    }
  }

  const user = await (db as any).user.findUnique({ where: { vkId: String(vkUserId) }, select: { balance: true } });
  const bonus = user?.balance ?? 0;
  const bonusNote = bonus > 0
    ? `\n\n🎁 У тебя есть бонус ${bonus} R$ — он автоматически добавится к заказу от 1000 R$ (бонус действует только для прямых заказов от 1000 R$).`
    : "";

  setState(vkUserId, { type: "AWAITING_DIRECT_AMOUNT" });

  await ctx.reply({
    message:
      `💎 Прямой заказ Robux\n\nВыбери количество (курс 0.7 ₽/R$):` +
      bonusNote,
    keyboard: buildVkPackKb(bonus),
  });
}

async function handleDirectAmountInput(ctx: MessageContext, vkUserId: number, text: string): Promise<void> {
  const num = parseInt(text.replace(/[\s,]/g, ""), 10);
  if (isNaN(num) || num < 100 || num > 10000) {
    await ctx.reply({
      message: "⚠️ Введи число от 100 до 10 000.\n\nНапример: 500",
      keyboard: Keyboard.builder()
        .textButton({ label: "❌ Отмена", payload: { command: "direct_cancel" }, color: "negative" })
        .inline(),
    });
    return;
  }
  await handleDirectPackSelect(ctx, vkUserId, num);
}

async function handleDirectPackSelect(ctx: MessageContext, vkUserId: number, amount: number): Promise<void> {
  const user = await (db as any).user.findUnique({ where: { vkId: String(vkUserId) }, select: { balance: true } });
  const rawBonus = user?.balance ?? 0;
  const bonus = amount >= 1000 ? rawBonus : 0;
  const totalAmount = amount + bonus;
  const passPrice = Math.ceil(totalAmount / 0.7);
  const rublePrice = Math.round(amount * DIRECT_RATE);

  setState(vkUserId, { type: "AWAITING_DIRECT_CONFIRM", amount, totalAmount, bonus });

  const bonusSection = bonus > 0
    ? `💎 Запрос:          ${amount} R$\n` +
      `🎁 Твой бонус:     +${bonus} R$\n` +
      `─────────────────\n` +
      `📦 Итого получишь:  ${totalAmount} R$\n`
    : rawBonus > 0 && amount < 1000
    ? `📦 Получишь:       ${amount} R$\n` +
      `💡 Бонус ${rawBonus} R$ применяется к заказам от 1000 R$.\n`
    : `📦 Получишь:       ${totalAmount} R$\n`;

  await ctx.reply({
    message:
      `✅ Подтверди заказ\n\n` +
      bonusSection +
      `💰 К оплате:       ${fmtRub(rublePrice)}\n` +
      `📌 Цена геймпасса:  ${passPrice} R$`,
    keyboard: Keyboard.builder()
      .textButton({ label: "✅ Подтвердить", payload: { command: "direct_confirm" }, color: "positive" })
      .textButton({ label: "❌ Отмена",      payload: { command: "direct_cancel"  }, color: "negative" })
      .inline(),
  });
}

async function handleDirectConfirm(ctx: MessageContext, vkUserId: number): Promise<void> {
  const state = getState(vkUserId);
  if (state?.type !== "AWAITING_DIRECT_CONFIRM") {
    await ctx.reply({
      message: "⏳ Время подтверждения вышло. Начни заново:",
      keyboard: Keyboard.builder()
        .textButton({ label: "💎 Купить напрямую", payload: { command: "start_direct" }, color: "primary" })
        .inline(),
    });
    return;
  }

  const { amount, totalAmount, bonus } = state;
  clearState(vkUserId);

  // Lazy upsert user
  let user = await (db as any).user.findUnique({ where: { vkId: String(vkUserId) } });
  if (!user) {
    const name = await vkGetName(vkUserId);
    user = await (db as any).user.create({ data: { vkId: String(vkUserId), name } });
  }

  // Guard: one active direct order at a time
  const existing = await (db as any).wbOrder.findFirst({
    where: { userId: user.id, status: { in: ["AWAITING_PAYMENT", "PAYMENT_PENDING"] } },
  });
  if (existing) {
    await ctx.reply({
      message:
        `⏳ У тебя уже есть активный заказ #${existing.id.slice(-6).toUpperCase()}.\n\n` +
        `Дождись реквизитов от менеджера, а затем оформи новый.`,
      keyboard: vkSupportKb("direct_wait"),
    });
    return;
  }

  const dirCode = generateDirectCode();
  let newOrder: any;
  try {
    newOrder = await (db as any).$transaction(async (tx: any) => {
      const ord = await tx.wbOrder.create({
        data: {
          amount:        totalAmount,
          gamepassUrl:   null,
          status:        "AWAITING_PAYMENT",
          platform:      "VK",
          userId:        user.id,
          wbCode:        dirCode,
          isDirectOrder: true,
        },
      });
      if (bonus > 0) {
        await tx.user.update({
          where: { id: user.id },
          data:  { balance: 0, reviewBonusGrantedAt: null, reviewReminderLevel: 0 },
        });
      }
      return ord;
    });
  } catch (err) {
    console.error("[VK] Direct order create error:", err);
    await ctx.reply({ message: "❌ Не удалось создать заказ. Попробуй снова.", keyboard: vkSupportKb("general") });
    return;
  }

  const shortId = newOrder.id.slice(-6).toUpperCase();
  const vkName = user.name ?? await vkGetName(vkUserId);
  const prevOrdersCount = await (db as any).wbOrder.count({
    where: { userId: user.id, status: "COMPLETED" },
  });

  try {
    await sendAdminDirectOrderCard({
      orderId:             newOrder.id,
      userId:              user.id,
      amount:              totalAmount,
      bonusApplied:        bonus,
      userDisplay:         `${vkUserDisplay(vkName, vkUserId)} (VK ID: ${vkUserId})`,
      createdAt:           newOrder.createdAt,
      previousOrdersCount: prevOrdersCount,
    });
  } catch (err) {
    console.error("[VK] sendAdminDirectOrderCard failed:", err);
  }

  await ctx.reply({
    message:
      `📋 Заказ #${shortId} оформлен!\n\n` +
      `Менеджер пришлёт реквизиты для оплаты в течение нескольких минут.\n\n` +
      `Ожидай сообщения 👇`,
    keyboard: vkSupportKb("direct_wait"),
  });

  console.log(`[VK] Direct order created: ${newOrder.id} vkUserId=${vkUserId} amount=${totalAmount}`);
}

async function handleDirectPaymentScreenshot(
  ctx: MessageContext,
  vkUserId: number,
  user: any,
  orderId: string
): Promise<void> {
  const url = await extractPhotoUrl(ctx);

  if (!url) {
    await ctx.reply("📸 Не удалось получить фото. Отправь скриншот оплаты как фотографию (не файлом) 👇");
    return;
  }

  clearState(vkUserId);

  await ctx.reply("✅ Скриншот получен! Менеджер проверит — обычно до 15 минут.");

  try {
    await sendAdminPaymentCard({
      orderId,
      userId:      user.id,
      photoFileId: url,
      userDisplay: vkUserDisplay(user.name ?? `VK #${vkUserId}`, vkUserId),
      amount:      undefined,
    });
  } catch (err) {
    console.error("[VK] sendAdminPaymentCard failed:", err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// B2 — Collect review screenshot
// ─────────────────────────────────────────────────────────────────────────────

async function handleReviewScreenshot(
  ctx: MessageContext,
  vkUserId: number,
  knownOrderId?: string
): Promise<void> {
  console.log(`[VK] handleReviewScreenshot: vkUserId=${vkUserId} knownOrderId=${knownOrderId ?? "none"}`);

  const url = await extractPhotoUrl(ctx);
  console.log(`[VK] handleReviewScreenshot: url=${url ? "found" : "NOT_FOUND"}`);

  if (!url) {
    if (knownOrderId) {
      await ctx.reply(
        "📸 Пришли скриншот отзыва в виде фотографии (не файлом).\n" +
        "После проверки администратором ты получишь +100 R$ (для прямых заказов от 1000 R$)."
      );
    } else {
      // Photo was detected at routing level but URL extraction failed — guide user
      await ctx.reply(
        "📸 Не удалось получить фото. Попробуй отправить скриншот ещё раз — именно как фотографию (не файлом).\n\n" +
        "Если не получается — напиши нам: https://t.me/RobloxBank_PA"
      );
    }
    return;
  }

  const user = await (db as any).user.findUnique({ where: { vkId: String(vkUserId) } });
  if (!user) {
    console.log(`[VK] handleReviewScreenshot: user not found for vkId=${vkUserId} — notifying admins`);
    await ctx.reply(
      "📸 Получили твой скриншот, но не смогли найти твою заявку в базе.\n\n" +
      "Свяжись с нами напрямую: https://t.me/RobloxBank_PA — " +
      "укажи свой VK ID, и мы разберёмся вручную."
    );
    try {
      for (const adminId of ADMIN_IDS) {
        await tgSend(
          adminId,
          `⚠️ <b>Скриншот ВБ отзыва — пользователь не найден в БД</b>\n` +
          `VK ID: <code>${vkUserId}</code> (<a href="https://vk.com/id${vkUserId}">vk.com/id${vkUserId}</a>)\n\n` +
          `Пользователь отправил скрин, но записи в базе нет. Нужна ручная проверка.`
        );
      }
    } catch (err) {
      console.error("[VK] admin notify for unknown reviewer failed:", err);
    }
    return;
  }

  // Resolve the order to attach this review to
  let orderId = knownOrderId;
  if (!orderId) {
    const order = await (db as any).wbOrder.findFirst({
      where:   { userId: user.id, status: "COMPLETED" },
      orderBy: { updatedAt: "desc" },
    });

    // Direct orders (wbCode starts with "DIR-") have no WbCode record in DB,
    // so skip the reviewBonusClaimed check for them.
    const isDirectOrder = (order?.wbCode as string | undefined)?.startsWith("DIR-");
    const linked = (order && !isDirectOrder)
      ? await (db as any).wbCode.findFirst({
          where: { userId: user.id, reviewBonusClaimed: false },
        })
      : order ?? null; // direct orders: truthy if order exists

    if (!order || !linked) {
      console.log(`[VK] handleReviewScreenshot: no eligible order/code for userId=${user.id} vkId=${vkUserId} hasOrder=${!!order} isDirectOrder=${!!isDirectOrder} hasLinked=${!!linked}`);
      await ctx.reply(
        "📸 У тебя сейчас нет выполненных заявок, ожидающих отзыва.\n\n" +
        "Если у тебя возникла проблема или вопрос — напиши сюда, ответим здесь. Или в Telegram: https://t.me/RobloxBank_PA"
      );
      return;
    }
    orderId = order.id as string;
  }

  clearState(vkUserId);

  await ctx.reply("✅ Отзыв получен! Менеджер проверит его в ближайшее время и начислит бонус 100 R$ (для прямых заказов от 1000 R$).");

  // Forward to Telegram admins
  const reviewerName = user.name ?? await vkGetName(vkUserId);
  try {
    await sendAdminReviewCard({
      orderId,
      userId:      user.id as string,
      photoSource: url,
      userDisplay: vkUserDisplay(reviewerName, vkUserId),
    });
  } catch (err) {
    console.error("[VK] sendAdminReviewCard failed:", err);
    // Fallback: plain alert so admins can approve manually
    for (const adminId of ADMIN_IDS) {
      try {
        await tgSend(adminId,
          `⚠️ <b>Ошибка доставки карточки отзыва — требуется ручная проверка</b>\n\n` +
          `👤 Юзер: ${vkUserDisplay(reviewerName, vkUserId)}\n` +
          `📦 Заказ: <code>${orderId}</code>\n` +
          `🖼 Фото: ${url}`
        );
      } catch {}
    }
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
    const codeExists = await (db as any).wbCode.findFirst({
      where: { code: { equals: text.trim().toUpperCase(), mode: "insensitive" } },
      select: { id: true },
    });
    if (codeExists) {
      await handleRefActivation(ctx, vkUserId, text.trim().toUpperCase());
      return;
    }
    // Not a known code — could be a 7-char Roblox nick for an active order
    // (e.g. a direct order right after payment confirmation, when the VK bot
    // has no in-memory state). Restore from DB and route into the link flow,
    // which understands nicks.
    const nickOutcome = await tryRestoreState(vkUserId);
    if (nickOutcome === "restored") {
      const st = getState(vkUserId) as { type: "AWAITING_LINK"; wbCode: string; denomination: number };
      await handleGamepassLink(ctx, vkUserId, text.trim(), st.wbCode, st.denomination);
      return;
    }
    await ctx.reply(
      "❌ Код не найден. Проверь правильность ввода на карточке.\n" +
      "💡 Часто путают букву «О» и цифру «0» — проверь эти символы в коде.\n\n" +
      "Нужна помощь? Напиши прямо сюда — ответим здесь 👇 Если удобнее в Telegram: https://t.me/RobloxBank_PA"
    );
    return;
  }

  // ── PRIORITY 2: Loyalty check FIRST for every idle message ─────────────
  const status = await getCustomerStatus(String(vkUserId), "VK");
  console.log(`[VK] User ${vkUserId} isReturning: ${status.isReturning}, orderCount: ${status.orderCount}`);

  // Guard: user sent a gamepass URL/ID but state machine has no active code.
  // Try DB auto-pickup first — they may have activated the code on the site.
  // Pass no ctx: we want orphan recovery to fall back to plain setState here
  // (legacy path), so we can immediately dispatch to handleGamepassLink with
  // the link the user just sent — rather than ping-ponging through the
  // handleRefActivation welcome flow.
  if (extractPassId(text) !== null) {
    const outcome = await tryRestoreState(vkUserId);
    if (outcome === "restored") {
      // State is now AWAITING_LINK — re-dispatch to gamepass handler
      const restoredState = getState(vkUserId) as { type: "AWAITING_LINK"; wbCode: string; denomination: number };
      await handleGamepassLink(ctx, vkUserId, text, restoredState.wbCode, restoredState.denomination);
      return;
    }
    await ctx.reply(
      "⚠️ Сначала активируй код с WB-карты — напиши его прямо сюда или на сайте:\n" +
      "🔗 https://robloxbank.ru/guide?source=wb\n\n" +
      "После активации пришли свой ник в Roblox или ссылку на геймпасс.\n" +
      "Нужна помощь? Напиши прямо сюда — ответим здесь 👇 Если удобнее в Telegram: https://t.me/RobloxBank_PA"
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
        "Нужна помощь? Напиши прямо сюда — ответим здесь 👇 Если удобнее в Telegram: https://t.me/RobloxBank_PA"
      );
      return;
    }

    const order = await (db as any).wbOrder.findFirst({
      where:   { userId: user.id },
      orderBy: { createdAt: "desc" },
    });

    if (!order) {
      await ctx.reply("У тебя пока нет заявок.\n\nЕсть код с WB-карты? Напиши его прямо сюда.\nНужна помощь? Напиши прямо сюда — ответим здесь 👇 Если удобнее в Telegram: https://t.me/RobloxBank_PA");
      return;
    }

    const label: Record<string, string> = {
      AWAITING_PAYMENT:  "⏳ Ожидаем реквизиты",
      PAYMENT_PENDING:   "💳 Ожидаем оплату",
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
      order.status === "AWAITING_PAYMENT"
        ? "\n\n💡 Менеджер скоро пришлёт реквизиты для оплаты. Если прошло больше 15 минут — напиши нам."
        : order.status === "PAYMENT_PENDING"
        ? "\n\n💳 Пришли скриншот оплаты сюда (фотографией, не файлом)."
        : order.status === "AWAITING_GAMEPASS"
        ? `\n\nПришли свой ник в Roblox — найду геймпасс сам 🔎\nИли отправь ссылку / Asset ID. Цена: ${passPrice} R$`
        : order.status === "PENDING"
        ? "\n\nНе переживай — менеджер работает в порядке очереди, обычно выкупаем в течение нескольких часов, максимум сутки. Напишем сами."
        : order.status === "IN_PROGRESS"
        ? "\n\n🔧 Менеджер уже работает над твоей заявкой. Скоро всё будет готово!"
        : order.status === "COMPLETED"
        ? (reviewClaimed
            ? "\n\n🚀 Хочешь заказать ещё? Постоянным клиентам — прямое обслуживание без очереди по лучшему курсу! Пиши: https://t.me/RobloxBank_PA"
            : "\n\n🎁 Оставь отзыв на Wildberries и получи +100 R$ бонусом (для прямых заказов от 1000 R$)!\nСделай скриншот отзыва и пришли его сюда фотографией.")
        : order.status === "REJECTED"
        ? `\n\n${order.rejectionReason ? `Причина: ${order.rejectionReason}\n\n` : ""}Исправь геймпасс и нажми кнопку ниже — отправим на проверку заново.`
        : "";

    const gamepassLine = order.gamepassUrl ? `🔗 ${order.gamepassUrl}\n` : "";

    const keyboard =
      order.status === "REJECTED"
        ? Keyboard.builder()
            .textButton({ label: "🔄 Исправить ссылку", payload: { command: "resubmit", code: order.wbCode }, color: "primary" })
            .inline()
        : order.status === "AWAITING_GAMEPASS"
        ? Keyboard.builder()
            .textButton({ label: "🔎 Найти по моему нику Roblox", payload: { command: "find_gp_start" }, color: "primary" })
            .row()
            .textButton({ label: "💬 Нужна помощь?", payload: { command: "support", context: "general" }, color: "secondary" })
            .inline()
        : order.status === "COMPLETED" && reviewClaimed
        ? Keyboard.builder()
            .textButton({ label: "💎 Заказать напрямую", payload: { command: "start_direct" }, color: "positive" })
            .inline()
        : undefined;

    await ctx.reply({
      message:
        `📦 Заявка #${shortId}\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `💎 Сумма: ${order.amount} R$ (Геймпасс: ${passPrice} R$)\n` +
        // DIR- codes are internal synthetic IDs for direct orders — don't expose them
        ((order.wbCode as string).startsWith("DIR-") ? "" : `🔑 Код ВБ: ${order.wbCode}\n`) +
        gamepassLine +
        `📊 Статус: ${statusStr}` +
        hint,
      ...(keyboard ? { keyboard } : {}),
    });
    return;
  }

  // Try to restore a pending WB code before falling back to the greeting.
  // "handled" = orphan code → handleRefActivation already sent the full welcome
  // with the gamepass-instruction link and created the provisional order.
  const outcome = await tryRestoreState(vkUserId, ctx);
  if (outcome === "handled") return;
  if (outcome === "restored") {
    const restoredState = getState(vkUserId) as { type: "AWAITING_LINK"; wbCode: string; denomination: number };
    // If the message itself is a Roblox nick — route it straight into the
    // link flow (which understands nicks) instead of swallowing it with a recap.
    if (ROBLOX_NICK_RE.test(text.trim().replace(/^@/, ""))) {
      await handleGamepassLink(ctx, vkUserId, text.trim(), restoredState.wbCode, restoredState.denomination);
      return;
    }
    const passPrice = Math.ceil(restoredState.denomination / 0.7);
    const firstName = await vkGetName(vkUserId);
    const isDirect = restoredState.wbCode.startsWith("DIR-");
    await ctx.reply({
      message:
        `${getGreeting(status, firstName)}\n` +
        (isDirect
          ? `✅ У тебя есть активный прямой заказ на ${restoredState.denomination} R$!\n\n`
          : `✅ У тебя есть активный код ${restoredState.wbCode}!\n` +
            `💎 Номинал: ${restoredState.denomination} R$\n\n`) +
        `Осталось совсем чуть-чуть — пришли свой ник в Roblox, и я найду геймпасс сам 🔎\n` +
        `📌 Цена геймпасса: ${passPrice} R$\n\n` +
        `Также можно прислать ссылку или Asset ID.\n\n` +
        `❓ Не помнишь как создать геймпасс? Инструкция со скриншотами:\n` +
        (isDirect
          ? `👉 https://robloxbank.ru/guide?source=direct`
          : `👉 https://www.robloxbank.ru/guide?source=wb&skip=1&code=${restoredState.wbCode}`),
      keyboard: Keyboard.builder()
        .textButton({ label: "🔎 Найти по моему нику Roblox", payload: { command: "find_gp_start" }, color: "primary" })
        .row()
        .textButton({ label: "💬 Нужна помощь?", payload: { command: "support", context: "general" }, color: "secondary" })
        .inline(),
    });
    return;
  }

  // ── PRIORITY 2: IDLE greeting ──────────────────────────────────────────
  const firstName = await vkGetName(vkUserId);

  if (status.isReturning) {
    await ctx.reply({
      message: getIdleGreeting(status, firstName) + "\n\nНужна помощь? Напиши прямо сюда — ответим здесь 👇 Если удобнее в Telegram: https://t.me/RobloxBank_PA",
      keyboard: Keyboard.builder()
        .textButton({ label: "📊 Статус заявки",   payload: { command: "status" },       color: "primary"   })
        .row()
        .textButton({ label: "💎 Купить напрямую", payload: { command: "start_direct" },  color: "positive"  })
        .row()
        .textButton({ label: "💬 Нужна помощь?",   payload: { command: "support", context: "general" }, color: "secondary" })
        .inline(),
    });
  } else {
    const greeting = getGreeting(status, firstName);
    await ctx.reply(
      `${greeting}Я помогаю обменять карты Wildberries на робуксы в Roblox.\n\n` +
      `Вот что я умею:\n` +
      `• Напиши 7-значный код с карты WB — оформлю заявку\n` +
      `• Напиши «статус» — покажу статус твоей заявки\n` +
      `• Пришли ник в Roblox или ссылку на геймпасс — приму в работу\n\n` +
      `Инструкция по активации: https://robloxbank.ru/guide?source=wb\n` +
      `Нужна живая помощь? https://t.me/RobloxBank_PA`
    );
  }
}
