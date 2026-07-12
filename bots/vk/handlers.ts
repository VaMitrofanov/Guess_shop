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
import { sendAdminOrderCard, sendAdminReviewCard, sendAdminDirectOrderCard, sendAdminPaymentCard, sendAdminIntentCard, notifySupportShown, ADMIN_IDS, DIRECT_PACKS, directPrice, customRate, BONUS_MIN_PACK, CUSTOM_MIN, CUSTOM_MAX, ROBLOX_NICK_RE, generateDirectCode, CB } from "../shared/admin";
import { vkGetName, tgSend, vkSend, escapeHtml } from "../shared/notify";
import { getState, setState, clearState } from "./session";
import { Keyboard } from "vk-io";
import { getGamepassDetails, getGamepassProductInfo } from "../shared/roblox";
import { searchGamepassesByNick, type GamepassSearchOutcome } from "../shared/gamepass-search";
import { enforceVkInlineKbLimits } from "../shared/vk-kb";
import { noteProbableNick } from "../shared/nick";
import { resolveReviewEligibility, reviewIneligibleMessage, REVIEW_BONUS_AMOUNT, REVIEW_BONUS_EXPIRY_DAYS } from "../shared/review-eligibility";
import { robuxUnlockDate, fmtDateRu } from "../shared/completed-messages";
import { confirmGpWatch, declineGpWatch } from "../shared/gp-watch-confirm";

// VK API instance injected from bot.ts to avoid circular import.
let _vkApi: any = null;

// ── Live-support pause ──────────────────────────────────────────────────────
// When a user taps support, the manager joins THIS VK dialog and chats directly.
// While that conversation is active the bot must stay silent on free text — else
// the user's replies to the manager get parsed as gamepass links and the bot
// spams "не принял ссылку" on top of the human chat. Keyed by VK user id → expiry.
const SUPPORT_PAUSE_MS = 30 * 60 * 1000;
const RESUME_KEYWORDS  = ["+бот", "+bot", "бот+"];
const supportPause = new Map<number, { exp: number; hinted: boolean }>();

function pauseSupport(vkUserId: number): void {
  supportPause.set(vkUserId, { exp: Date.now() + SUPPORT_PAUSE_MS, hinted: false });
}
function isSupportPaused(vkUserId: number): boolean {
  const p = supportPause.get(vkUserId);
  if (!p) return false;
  if (Date.now() < p.exp) return true;
  supportPause.delete(vkUserId); // expired
  return false;
}
function resumeSupport(vkUserId: number): void {
  supportPause.delete(vkUserId);
}
/** Одноразовый (на окно паузы) хинт «бот на паузе» — true, если ещё не показывали. */
function shouldHintSupportPause(vkUserId: number): boolean {
  const p = supportPause.get(vkUserId);
  if (!p || p.hinted) return false;
  p.hinted = true;
  return true;
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
      msg = `🤖 Бот снова на связи! Цена геймпасса: ${passPrice} R$\n\nНапиши свой ник в Roblox — найду геймпасс 🔎`;
    }
    await _vkApi.messages.send({ peer_id: vkUserId, message: msg, random_id: Date.now() + Math.floor(Math.random() * 1000) });
  } catch (e) {
    console.error("[VK] rePromptAfterSupport failed:", e);
  }
}

// Natural-language ways a user might ask for a human — so support is reachable by
// simply writing, not only via the button. Substring match (stems cover endings).
// «support» — ТОЛЬКО как отдельное слово: substring ловил латинские ники вида
// Support_Kid и уводил ввод ника в саппорт-паузу (кириллические стемы в латинском
// нике встретиться не могут, им substring безопасен).
const SUPPORT_WORDS = ["оператор", "поддержк", "менеджер", "помощь", "помоги", "саппорт", "живой человек", "живого человека", "жалоб"];
const SUPPORT_WORD_RE = /\bsupport\b/i;
function looksLikeSupportRequest(lower: string): boolean {
  return SUPPORT_WORDS.some((w) => lower.includes(w)) || SUPPORT_WORD_RE.test(lower);
}

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
    "✅ Готово! Дальше с тобой общается живой человек (не бот) — менеджер ответит прямо здесь, в этом чате.\n\n" +
    "Опиши, пожалуйста, что случилось, одним сообщением 👇\n" +
    "Пока идёт диалог с менеджером, бот не вмешивается. Вернуть бота можно командой «+бот».\n\n" +
    "Если удобнее в Telegram — там тоже живой человек: https://t.me/RobloxBank_PA"
  );
}

/**
 * Edit-in-place для VK: результат долгой операции редактируется в пузырь
 * «🔎 Ищу…» (messages.edit), чтобы ответ был виден без пролистывания —
 * delete/новое сообщение оставляли клиента на его сообщении, а результат
 * приходил ниже видимой области. Фолбэк — обычный reply (edit не прошёл:
 * нет cmid, сообщение старше 24 ч и т.п.).
 */
function buildVkEditInPlace(ctx: MessageContext, vkUserId: number, sentMsg: any) {
  // Одноразовый: первый вызов редактирует плейсхолдер, последующие (ветки,
  // шлющие несколько сообщений) уходят обычным reply.
  let consumed = false;
  return async (payload: string | { message: string; keyboard?: unknown }): Promise<void> => {
    const p = typeof payload === "string" ? { message: payload } : payload;
    const cmid = sentMsg?.conversationMessageId ?? sentMsg?.id;
    if (!consumed) {
      consumed = true;
      try {
        if (!_vkApi || !cmid) throw new Error("no api/cmid");
        await _vkApi.messages.edit({
          peer_id: vkUserId,
          conversation_message_id: cmid,
          message: p.message,
          ...(p.keyboard ? { keyboard: p.keyboard } : {}),
        });
        return;
      } catch { /* fall through to reply */ }
    }
    await ctx.reply(p as any);
  };
}

/** Format roubles with thousands separator, e.g. 3500 → "3 500 ₽". */
function fmtRub(n: number): string {
  if (n >= 1000) return `${Math.floor(n / 1000)} ${String(n % 1000).padStart(3, "0")} ₽`;
  return `${n} ₽`;
}

/** Visual step indicator (plain text for VK). */
function stepBar(current: number, label: string): string {
  const bar = Array.from({ length: 5 }, (_, i) => i < current ? "●" : "○").join(" ");
  return `${bar}  Шаг ${current}/5 · ${label}`;
}

// ── Клавиатура паков прямого заказа (PLAN +5.C) ──────────────────────────
// Шаг 1 компактный: [🔄 прошлый пак] + топ-3 (500/1000/2000) + «📋 Все паки»
// + [✏️ Своё][❌ Отменить] = максимум 7 кнопок / 5 рядов (лимит VK: 10/6/5).
// Каталог: 8 паков (без 400 и 1200 — полный набор из 10 в inline не влезает)
// по 2 в ряд + [✏️][❌] = ровно 10 кнопок / 5 рядов.

const VK_PACKS = [100, 200, 300, 500, 800, 1000, 1500, 2000];
const VK_FEATURED_PACKS = [500, 1000, 2000];

function vkPackBtnLabel(amt: number, userBonus: number, rubleDiscount: number): string {
  const tag = userBonus > 0 && amt >= BONUS_MIN_PACK ? ` +${userBonus}🎁` : "";
  const basePrice = directPrice(amt);
  const price = rubleDiscount > 0 ? Math.max(0, basePrice - rubleDiscount) : basePrice;
  return `${amt}${tag} R$ — ${fmtRub(price)}`;
}

/** Компактный первый экран выбора пака. */
function buildVkPackKb(userBonus = 0, rubleDiscount = 0, lastOrderAmount?: number) {
  const kb = Keyboard.builder();
  if (lastOrderAmount && DIRECT_PACKS.includes(lastOrderAmount)) {
    kb.textButton({
      label: `🔄 ${vkPackBtnLabel(lastOrderAmount, userBonus, rubleDiscount)}`,
      payload: { command: "direct_pack", amount: lastOrderAmount },
      color: "positive",
    });
    kb.row();
  }
  for (const amt of VK_FEATURED_PACKS) {
    kb.textButton({
      label: vkPackBtnLabel(amt, userBonus, rubleDiscount),
      payload: { command: "direct_pack", amount: amt },
      color: "primary",
    });
  }
  kb.row();
  kb.textButton({ label: "📋 Все паки (100–2000)", payload: { command: "direct_catalog" }, color: "secondary" });
  kb.row();
  kb.textButton({ label: "✏️ Своё количество", payload: { command: "direct_custom" }, color: "secondary" });
  kb.textButton({ label: "❌ Отменить", payload: { command: "direct_cancel" }, color: "negative" });
  return enforceVkInlineKbLimits(kb.inline(), "VK/pack-kb");
}

/** Каталог: 8 паков по 2 в ряд + сервисный ряд — ровно 10 кнопок. */
function buildVkPackCatalogKb(userBonus = 0, rubleDiscount = 0) {
  const kb = Keyboard.builder();
  for (let i = 0; i < VK_PACKS.length; i++) {
    const amt = VK_PACKS[i];
    kb.textButton({
      label: vkPackBtnLabel(amt, userBonus, rubleDiscount),
      payload: { command: "direct_pack", amount: amt },
      color: userBonus > 0 && amt >= BONUS_MIN_PACK ? "positive" : "primary",
    });
    if ((i + 1) % 2 === 0) kb.row();
  }
  kb.textButton({ label: "✏️ Своё количество", payload: { command: "direct_custom" }, color: "secondary" });
  kb.textButton({ label: "❌ Отменить", payload: { command: "direct_cancel" }, color: "negative" });
  return enforceVkInlineKbLimits(kb.inline(), "VK/pack-catalog");
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

    // Look for AWAITING_GAMEPASS or REJECTED WB orders — mirrors TG DB recovery.
    // REJECTED direct orders are dead (cancelled by manager) — never restore.
    // Limit to 30 days to avoid restoring stale orders from months ago where
    // the gamepass no longer exists.
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const recoverable = await (db as any).wbOrder.findFirst({
      where:   {
        userId: user.id,
        status: { in: ["AWAITING_GAMEPASS", "REJECTED"] },
        isDirectOrder: false,
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
 * True if the message carries a photo via vk-io OR the raw payload. vk-io
 * occasionally fails to flag `hasAttachments("photo")` depending on the
 * client/SDK version (and for forwarded/replied screenshots), which would
 * otherwise misroute the photo to the idle/help branch. Checks every path.
 */
function messageHasPhoto(ctx: MessageContext): boolean {
  if (ctx.hasAttachments("photo")) return true;
  const raw: any[] = (ctx as any).message?.attachments ?? (ctx as any).attachments ?? [];
  if (raw.some((a) => a?.type === "photo")) return true;
  const fwd: any[] = (ctx as any).message?.fwd_messages ?? [];
  const reply: any = (ctx as any).message?.reply_message;
  const all = reply ? [reply, ...fwd] : fwd;
  return all.some((m) => (m?.attachments ?? []).some((a: any) => a?.type === "photo"));
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

  // 4. VK API messages.getByConversationMessageId — re-fetch message with full
  // photo sizes. Community tokens can't use photos.getById (error 27), but CAN
  // use messages.getByConversationMessageId which returns complete attachments.
  if (_vkApi) {
    const peerId = (ctx as any).peerId ?? (ctx as any).message?.peer_id;
    const cmid   = (ctx as any).conversationMessageId ?? (ctx as any).message?.conversation_message_id;
    const groupId = process.env.VK_GROUP_ID;
    if (peerId && cmid && groupId) {
      try {
        const resp = await _vkApi.messages.getByConversationMessageId({
          peer_id: peerId,
          conversation_message_ids: cmid,
          group_id: Number(groupId),
        });
        const items: any[] = resp?.items ?? [];
        for (const msg of items) {
          for (const att of (msg?.attachments ?? [])) {
            if (att?.type === "photo") {
              const url = photoUrl(att.photo);
              if (url) return url;
            }
          }
          for (const fwd of (msg?.fwd_messages ?? [])) {
            for (const att of (fwd?.attachments ?? [])) {
              if (att?.type === "photo") {
                const url = photoUrl(att.photo);
                if (url) return url;
              }
            }
          }
        }
      } catch (err) {
        console.warn("[VK] messages.getByConversationMessageId fallback failed:", (err as any)?.message ?? err);
      }
    }
  }

  return undefined;
}

/**
 * True when a photo from this user is *terminal proof* we should accept even
 * during a live-support pause: a pending direct-order payment, or a completed
 * order whose review bonus hasn't been claimed yet. Used to stop the support
 * pause from silently swallowing review/payment screenshots ("фото зависло"),
 * while still ignoring random screenshots meant for the live manager.
 * Fail-safe: returns false on error so the pause behaviour is preserved.
 */
async function hasPendingProofPhoto(vkUserId: number): Promise<boolean> {
  try {
    const user = await (db as any).user.findUnique({
      where: { vkId: String(vkUserId) }, select: { id: true, reviewBonusGrantedAt: true },
    });
    if (!user) return false;
    const pendingPay = await (db as any).wbOrder.findFirst({
      where: { userId: user.id, status: "PAYMENT_PENDING", isDirectOrder: true }, select: { id: true },
    });
    if (pendingPay) return true;
    // П1: единая eligibility (ищет COMPLETED-заказ и по кодам юзера) — иначе
    // кросс-платформенный скрин отзыва глотался бы support-паузой.
    const elig = await resolveReviewEligibility(user);
    return elig.kind === "eligible";
  } catch (e) {
    console.error("[VK] hasPendingProofPhoto check failed:", e);
    return false;
  }
}

function vkUserDisplay(name: string, vkUserId: number): string {
  // Names go into HTML admin cards — escape so "<Имя>" can't break the message.
  return `<a href="https://vk.com/id${vkUserId}">${escapeHtml(name)}</a>`;
}

// generateDirectCode() now imported from shared/admin

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

const VK_FAQ_ITEMS: { key: string; label: string; answer: string }[] = [
  { key: "when_buy",  label: "⏳ Когда выкупят?",           answer: "Обычно выкупаем за пару часов, максимум — в течение суток.\nКак только выкупим — бот пришлёт уведомление прямо сюда. Ничего делать не нужно, просто жди 👌" },
  { key: "when_rbx",  label: "💎 Когда придут робуксы?",    answer: "После выкупа Roblox замораживает робуксы на 5–7 дней (это их стандартная процедура — «Pending Robux»).\n\nПроверить: roblox.com/transactions → строка Pending.\n\nМы на это повлиять не можем — дальше всё на стороне Roblox." },
  // Ф6.1 (2026-07-12): механика бонуса — одно место правды review-eligibility.ts.
  { key: "bonus",     label: "🎁 Бонус за отзыв",           answer: `За отзыв на Wildberries дарим +${REVIEW_BONUS_AMOUNT} R$ к любому прямому заказу.\n\nКак получить:\n1. Оставь отзыв с текстом и фото (только оценка не подойдёт).\n2. Пришли скриншот сюда фотографией (не файлом).\n3. После проверки начислим сразу — бонус действует ${REVIEW_BONUS_EXPIRY_DAYS} дней.\n\nКак потратить: оформи прямой заказ в боте — бонус добавится к номиналу автоматически (без карточки WB).` },
  { key: "what_now",  label: "🤔 Что мне делать сейчас?",   answer: "Если заказ оформлен — просто жди. Бот сам пришлёт уведомление, когда геймпасс будет выкуплен.\n\nЕсли ещё не создал геймпасс — открой 📖 Инструкцию и пройди все шаги." },
  { key: "wrong_gp",  label: "✏️ Не тот геймпасс/ник",     answer: "Напиши «сменить ник» — можно перевыбрать ник и геймпасс в любой момент до выкупа." },
  { key: "how_gp",    label: "📖 Как создать геймпасс?",    answer: "Полная пошаговая инструкция — по кнопке 📖 ИНСТРУКЦИЯ.\n\nВкратце: зайди на create.roblox.com → выбери свою игру → Monetization → Passes → Create Pass → поставь нужную цену → сохрани." },
  { key: "price",     label: "💰 Какую цену ставить?",      answer: "Цена геймпасса = номинал ÷ 0.7 (округлённо вверх).\n\nНапример: 500 R$ → 715 R$, 1000 R$ → 1429 R$.\n\nТочная цена написана в карточке заказа и в инструкции." },
  { key: "managed",   label: "⚠️ Managed pricing?",         answer: "Managed pricing (региональные цены) должен быть ОТКЛЮЧЁН.\n\nЕсли он включён — Roblox автоматически меняет цену геймпасса и мы не сможем его выкупить. Робуксы ты получишь только когда всё будет сделано правильно.\n\nПроверь: Passes → твой пасс → ☰ → Sales → переключатель Managed pricing = OFF.\n\nПо умолчанию он отключён, но если случайно включил — отключи и нажми Save Changes." },
];

function vkFaqKb() {
  return Keyboard.builder()
    .textButton({ label: "❓ Частые вопросы", payload: { command: "faq" }, color: "secondary" })
    .inline();
}

function vkFaqOrSupportKb(order: any, ctxKey = "general") {
  if (order && orderAgeMsFromOrder(order) < SUPPORT_COOLDOWN_MS) {
    return vkFaqKb();
  }
  return vkSupportKb(ctxKey);
}

function orderAgeMsFromOrder(order: any): number {
  if (!order?.createdAt) return Infinity;
  return Date.now() - new Date(order.createdAt).getTime();
}

const SUPPORT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/**
 * Sends the subscription prompt and inline buttons.
 * `after` — контекст продолжения после «✅ Я вступил» (напр. "start_direct"):
 * без него check_sub не знает, откуда пришёл юзер, и отвечает «отправь код ВБ»
 * — тупик для прямого заказа (шов гейта, PLAN +5.D).
 */
async function sendVkSubPrompt(ctx: MessageContext, refCode: string | null, denomination?: number, after?: string): Promise<void> {
  const groupId  = process.env.VK_GROUP_ID;
  const groupUrl = groupId ? `https://vk.com/club${groupId}` : "https://vk.com";
  const orderLine = refCode && denomination
    ? `📦 Заказ ${refCode} · ${denomination} R$ — создан\n\n`
    : "";
  const payload: Record<string, string> = { command: "check_sub" };
  if (refCode) payload.ref = refCode;
  if (after) payload.after = after;
  await ctx.reply({
    message:
      orderLine +
      `⭐ Чтобы продолжить, подпишись на наше сообщество 👇\n` +
      `После подписки бот точнее находит геймпассы по нику и ты получишь персональную инструкцию — заказ оформляется прямо в ней.\n\n` +
      `${groupUrl}\n\n` +
      `После подписки нажми кнопку «✅ Я вступил» ниже.`,
    keyboard: Keyboard.builder()
      .urlButton({ label: "🔔 Подписаться", url: groupUrl })
      .row()
      .textButton({ label: "✅ Я вступил", payload, color: "positive" })
      .inline(),
  });
}

// ── Бесшовный гейт (PLAN +5.D): stash текста, съеденного idle-гейтом ─────────
// Неподписанный шлёт код/ссылку → гейт. После «Я вступил» / вступления в группу
// текст переигрывается штатно, юзеру не приходится вводить его заново.
const gateStash = new Map<number, { text: string; at: number }>();
// «Купить напрямую» упёрся в гейт → после подписки продолжаем прямой заказ
// (нужно для group_join, где payload-кнопки нет).
const gateDirectPending = new Map<number, number>();
const GATE_STASH_TTL_MS = 30 * 60 * 1000;

function popGateStash(vkUserId: number): string | null {
  const s = gateStash.get(vkUserId);
  gateStash.delete(vkUserId);
  if (s && Date.now() - s.at < GATE_STASH_TTL_MS) return s.text;
  return null;
}

function popGateDirectPending(vkUserId: number): boolean {
  const at = gateDirectPending.get(vkUserId);
  gateDirectPending.delete(vkUserId);
  return !!at && Date.now() - at < GATE_STASH_TTL_MS;
}

/**
 * Продолжение флоу после подтверждённой подписки (кнопка «Я вступил» или
 * событие group_join). Возвращает true, если продолжение отправлено.
 * При AWAITING_LINK и известном нике даём кнопки «Найти у <ник>» — не
 * заставляем вводить ник заново (шов 3 гейта).
 */
async function sendPostSubscribeContinuation(ctx: MessageContext, vkUserId: number): Promise<boolean> {
  let st = getState(vkUserId);
  if (!st || st.type !== "AWAITING_LINK") {
    const restored = await tryRestoreState(vkUserId);
    if (restored !== "restored") return false;
    st = getState(vkUserId);
    if (!st || st.type !== "AWAITING_LINK") return false;
  }
  const passPrice = Math.ceil(st.denomination / 0.7);
  const user = await (db as any).user.findUnique({
    where: { vkId: String(vkUserId) },
    select: { id: true, robloxUsername: true },
  }).catch(() => null);
  const order = user
    ? await (db as any).wbOrder.findFirst({
        where: { userId: user.id, wbCode: st.wbCode },
        select: { probableNick: true, robloxUsername: true },
      }).catch(() => null)
    : null;
  const knownNick = order?.probableNick ?? order?.robloxUsername ?? user?.robloxUsername ?? null;
  if (knownNick) {
    await ctx.reply({
      message:
        `✅ Подписка подтверждена!\n\n` +
        `🎮 Твой ник: ${knownNick}\n` +
        `📌 Цена геймпасса: ${passPrice} R$\n\n` +
        `Продолжим? Найду твои геймпассы сам 🔎`,
      keyboard: Keyboard.builder()
        .textButton({ label: `✅ Найти у ${knownNick}`, payload: { command: "find_gp_recheck" }, color: "positive" })
        .row()
        .textButton({ label: "🔎 Другой ник", payload: { command: "find_gp_start" }, color: "secondary" })
        .inline(),
    });
  } else {
    await ctx.reply(
      `✅ Подписка подтверждена!\n\n` +
      `Пришли свой ник в Roblox — найду геймпасс сам 🔎\n` +
      `📌 Цена геймпасса: ${passPrice} R$\n\n` +
      `Также можно прислать ссылку или Asset ID.`
    );
  }
  return true;
}

/**
 * VK событие group_join (шов 4 гейта, PLAN +5.D): юзер подписался сам, не
 * нажимая «Я вступил» — продолжаем флоу сразу. Пишем ТОЛЬКО тем, у кого есть
 * незакрытый контекст (гейт прямого заказа / съеденный текст / активный или
 * восстановимый заказ) — случайных вступивших не трогаем. Ошибки отправки
 * (VK 901 у юзеров без диалога) глотаем: подписка без диалога легальна.
 */
export async function handleVkGroupJoin(vkUserId: number): Promise<void> {
  if (!_vkApi || !vkUserId || vkUserId <= 0) return;
  const pseudoCtx: any = {
    reply: async (payload: string | { message: string; keyboard?: unknown }) => {
      const p = typeof payload === "string" ? { message: payload } : payload;
      return _vkApi.messages.send({
        peer_id: vkUserId,
        random_id: Math.floor(Math.random() * 1e9),
        message: p.message,
        ...(p.keyboard ? { keyboard: p.keyboard } : {}),
      });
    },
    vk: { api: _vkApi },
  };
  try {
    if (popGateDirectPending(vkUserId)) {
      await handleStartDirect(pseudoCtx, vkUserId);
      return;
    }
    const stashed = popGateStash(vkUserId);
    if (stashed) {
      await handleIdleMessage(pseudoCtx, vkUserId, stashed);
      return;
    }
    await sendPostSubscribeContinuation(pseudoCtx, vkUserId);
  } catch (err: any) {
    console.warn(`[VK/group_join] continuation failed for ${vkUserId}:`, err?.message ?? err);
  }
}

// ── Entry point: called for every message_new event ───────────────────────────

/**
 * Исходящие сообщения сообщества (событие message_reply; в handleMessage —
 * страховка на message_new с out-флагом). Различаем живого менеджера и самого
 * бота по `admin_author_id`: он есть только у сообщений, отправленных админом
 * вручную из интерфейса сообщества (random_id ненадёжен — у менеджерских
 * сообщений он тоже бывает ненулевым, проверено историей). Сообщения бота
 * паузу НЕ трогают — иначе она самоподдерживалась бы бесконечно.
 */
export async function handleOutboxMessage(ctx: MessageContext): Promise<void> {
  const peer = typeof (ctx as any).peerId === "number" ? (ctx as any).peerId : undefined;
  if (peer === undefined || peer <= 0) return;
  const t = (ctx.text ?? "").trim().toLowerCase();
  const adminAuthorId =
    (ctx as any).adminAuthorId ??
    (ctx as any)?.message?.admin_author_id ??
    (ctx as any)?.payload?.admin_author_id;
  if (RESUME_KEYWORDS.includes(t)) {
    // Менеджер вернул бота командой «+бот» из чата сообщества.
    resumeSupport(peer);
    void rePromptAfterSupport(peer);
  } else if (adminAuthorId) {
    // Живой менеджер пишет клиенту → бот замолкает (ставим/продлеваем паузу).
    pauseSupport(peer);
  }
}

export async function handleMessage(ctx: MessageContext): Promise<void> {
  if (ctx.isOutbox) {
    await handleOutboxMessage(ctx);
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

  // ── ❓ FAQ — self-service answers ─────────────────────────────────────────
  if (msgPayload?.command === "faq") {
    // Ф6.2: when_rbx персонализируется датой разблокировки последнего заказа.
    let whenRbxExtra = "";
    try {
      const faqUser = await (db as any).user.findUnique({ where: { vkId: String(vkUserId) }, select: { id: true } });
      const lastDone = faqUser
        ? await (db as any).wbOrder.findFirst({
            where: { userId: faqUser.id, status: "COMPLETED", completedAt: { not: null } },
            orderBy: { completedAt: "desc" },
            select: { amount: true, completedAt: true },
          })
        : null;
      if (lastDone) {
        const unlock = robuxUnlockDate(new Date(lastDone.completedAt));
        const daysLeft = Math.ceil((unlock.getTime() - Date.now()) / 86_400_000);
        whenRbxExtra = daysLeft > 0
          ? `\n📌 По твоему заказу на ${lastDone.amount} R$: разблокировка ~ ${fmtDateRu(unlock)} (осталось ${daysLeft} ${vkPluralDays(daysLeft)}).`
          : `\n📌 По твоему заказу на ${lastDone.amount} R$ робуксы уже должны быть доступны — проверь transactions.`;
      }
    } catch { /* персонализация — не повод ронять FAQ */ }

    const lines = ["❓ Частые вопросы\n"];
    for (const item of VK_FAQ_ITEMS) {
      lines.push(`${item.label}\n${item.answer}${item.key === "when_rbx" ? whenRbxExtra : ""}\n`);
    }
    lines.push("💬 Не нашёл ответ? Напиши прямо сюда — ответим здесь, или в Telegram: https://t.me/RobloxBank_PA");
    await ctx.reply({
      message: lines.join("\n"),
      keyboard: Keyboard.builder()
        .textButton({ label: "📊 Мой заказ", payload: { command: "status" }, color: "primary" })
        .row()
        // Ф6.1: кнопки бонусного FAQ-пункта (в TG — на самом пункте).
        .textButton({ label: "📸 Прислать отзыв", payload: { command: "review_hint" }, color: "primary" })
        .textButton({ label: "💎 Купить напрямую", payload: { command: "start_direct" }, color: "positive" })
        .row()
        .textButton({ label: "👤 В моё меню", payload: { command: "menu" }, color: "secondary" })
        .inline(),
    });
    return;
  }

  // ── 📸 review_hint — клиент тапнул «Отзыв = +100 R$» на карточке COMPLETED ──
  if (msgPayload?.command === "review_hint") {
    const rhUser = await (db as any).user.findUnique({
      where: { vkId: String(vkUserId) },
      select: { id: true, balance: true, reviewBonusGrantedAt: true },
    }).catch(() => null);
    if (rhUser) {
      const elig = await resolveReviewEligibility(rhUser);
      if (elig.kind === "eligible") {
        setState(vkUserId, { type: "AWAITING_REVIEW", orderId: elig.orderId });
      } else if (elig.kind === "already_granted" || elig.kind === "active_order") {
        await ctx.reply({ message: reviewIneligibleMessage(elig, { html: false }) });
        return;
      }
    }
    await ctx.reply({
      message:
        "📸 Оставь отзыв на Wildberries с текстом и фото, сделай скриншот и пришли его сюда фотографией (не файлом).\n\n" +
        "После проверки бонус +100 R$ придёт автоматически (действует на любой номинал).",
    });
    return;
  }

  // ── 👤 Buyer mini-profile hub ─────────────────────────────────────────────
  if (msgPayload?.command === "menu") {
    await sendVkBuyerMenu(ctx, vkUserId);
    return;
  }

  // ── 👁 GP-watch (+3): клиент подтверждает/отклоняет найденный геймпасс ─────
  if (msgPayload?.command === "gpw_ok" && msgPayload?.orderId) {
    // П2 (кейс DCTAKAJ/Эсмира): заказ уходит в очередь — старый стейт
    // AWAITING_LINK больше не нужен, иначе следующий текст юзера падал в
    // «Не удалось распознать. Напиши свой ник…».
    clearState(vkUserId);
    const res = await confirmGpWatch(String(msgPayload.orderId));
    await ctx.reply(
      res.status === "ok"
        ? `✅ Отлично! Геймпасс ${res.passName} (${res.robux} R$) принят на ник ${res.nick}.\n\nЗаказ в очереди на выкуп — как только выкупим, сразу напишу сюда 💛`
        : res.status === "already"
        ? "✅ Этот заказ уже в работе — ничего делать не нужно."
        : res.status === "gone"
        ? "⚠️ Геймпасс сейчас не находится по этому нику. Проверь, что он выставлен на продажу за нужную цену, и пришли ссылку сюда."
        : "⚠️ Не получилось обработать. Пришли ссылку на геймпасс сюда, помогу.",
    );
    return;
  }
  if (msgPayload?.command === "gpw_no" && msgPayload?.orderId) {
    // П2: чистим стейл и сразу взводим ввод ника — «пришли его сюда»
    // должно реально уводить следующий текст в ник-поиск.
    clearState(vkUserId);
    const declined = await declineGpWatch(String(msgPayload.orderId));
    if (declined) {
      setState(vkUserId, { type: "AWAITING_ROBLOX_NICK", wbCode: declined.wbCode, denomination: declined.amount });
    }
    await ctx.reply("Понял 👍 Если знаешь свой точный ник Roblox — пришли его сюда, и я найду твой геймпасс.");
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
            .textButton({ label: "❓ Частые вопросы", payload: { command: "faq" }, color: "secondary" })
            .inline(),
        });
        return;
      }
    }
    await ctx.reply("Заказ не найден или уже не требует исправления.\n\nЕсть вопросы? https://t.me/RobloxBank_PA");
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
      if (msgPayload?.after === "start_direct" || popGateDirectPending(vkUserId)) {
        // Пришли из гейта «Купить напрямую» — продолжаем прямой заказ, а не
        // «отправь код ВБ» (шов 2 гейта, PLAN +5.D).
        await handleStartDirect(ctx, vkUserId);
        return;
      }
      // Came from the gamepass-submission gate — AWAITING_LINK state is still
      // active (or restorable). Known nick → «Найти у <ник>» buttons (шов 3).
      if (await sendPostSubscribeContinuation(ctx, vkUserId)) return;
      // Idle-гейт съел текст (код/ссылку/ник)? Переигрываем его штатно (шов 1).
      const stashed = popGateStash(vkUserId);
      if (stashed) {
        await handleIdleMessage(ctx, vkUserId, stashed);
        return;
      }
      await ctx.reply("✅ Подписка подтверждена! Теперь отправь свой код с карточки Wildberries — бот выдаст инструкцию.");
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
  // вот ссылка …» must reach the flow, not freeze the bot for 30 minutes.
  // Also skip when it carries an *eligible proof photo* — «помогите, вот мой
  // отзыв 📷» must route to the review/payment flow, not trigger support. ──
  if (
    text.length > 0 &&
    extractPassId(text) === null &&
    looksLikeSupportRequest(lower) &&
    !(messageHasPhoto(ctx) && await hasPendingProofPhoto(vkUserId))
  ) {
    if (isSupportPaused(vkUserId)) {
      await ctx.reply("С тобой на связи живой человек (не бот) — менеджер ответит прямо здесь 👇 Опиши, пожалуйста, свой вопрос одним сообщением.");
    } else {
      await triggerSupport(ctx, vkUserId, "general");
    }
    return;
  }

  // ── Live-support pause: stay silent on free text while a manager is handling
  // this chat, so the user's replies to the manager aren't parsed as links.
  // Button payload commands (start_direct, status, edit_nick, etc.) still work —
  // they are intentional user actions from inline keyboards, not free text.
  // The user can hand control back to the bot themselves with «+бот».
  if (isSupportPaused(vkUserId)) {
    if (RESUME_KEYWORDS.includes(lower)) {
      resumeSupport(vkUserId);
      void rePromptAfterSupport(vkUserId);
      return;
    }
    const hasKnownPayload = msgPayload?.command && typeof msgPayload.command === "string";
    // A photo is almost always *terminal proof* (review screenshot or direct
    // payment). Silently dropping it here was the "фото зависло" bug — the user
    // got no acknowledgement at all. Let an *eligible* proof photo fall through
    // to the photo-routing below; non-eligible photos (e.g. a screenshot meant
    // for the live manager) still stay silent so the bot doesn't hijack the chat.
    //
    // Терминальные для флоу ТЕКСТЫ тоже не глотаем: ссылка/ID геймпасса, WB-код,
    // ник Roblox (когда флоу ждёт ник). Раньше они молча пропадали на 30 минут —
    // клиент видел «бот не ищет по нику», менеджер не видел ничего.
    const pausedState = getState(vkUserId);
    const awaitsNick =
      pausedState?.type === "AWAITING_LINK" ||
      pausedState?.type === "AWAITING_ROBLOX_NICK" ||
      pausedState?.type === "AWAITING_DIRECT_NICK_INPUT" ||
      pausedState?.type === "AWAITING_NICK_EDIT";
    const looksLikeFlowInput =
      extractPassId(text) !== null ||
      (/^[A-Za-z0-9]{7}$/.test(text.trim()) && /[A-Za-z]/.test(text.trim())) ||
      (awaitsNick && ROBLOX_NICK_RE.test(text.trim().replace(/^@/, "")));
    if (!hasKnownPayload && !looksLikeFlowInput && !(messageHasPhoto(ctx) && await hasPendingProofPhoto(vkUserId))) {
      // Не молчим совсем: один раз за окно паузы говорим, что происходит.
      if (shouldHintSupportPause(vkUserId)) {
        await ctx.reply("⏸ Сейчас с тобой на связи менеджер — бот не вмешивается.\nВернуть бота: напиши «+бот».");
      }
      return;
    }
    if (hasKnownPayload) {
      console.log(`[VK] support-pause bypass: payload command "${msgPayload.command}" from vkUserId=${vkUserId}`);
    } else if (looksLikeFlowInput) {
      console.log(`[VK] support-pause bypass: flow-input text from vkUserId=${vkUserId}`);
    } else {
      console.log(`[VK] support-pause bypass: eligible proof photo from vkUserId=${vkUserId}`);
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
      const isDirect = state.wbCode.startsWith("DIR-");
      const startGuideUrl = isDirect
        ? `https://robloxbank.ru/guide?source=direct`
        : `https://robloxbank.ru/guide?source=wb&skip=1&code=${state.wbCode}`;
      const awUserData = await (db as any).user.findUnique({ where: { vkId: String(vkUserId) }, select: { robloxUsername: true } });
      const awNick = awUserData?.robloxUsername;
      const awNickLine = awNick ? `\n🎮 Ник: ${awNick}` : "";
      const awKb = Keyboard.builder()
        .urlButton({ label: "📖 ОТКРЫТЬ МОЮ ИНСТРУКЦИЮ", url: startGuideUrl })
        .row();
      if (awNick) {
        awKb.textButton({ label: `✅ Найти у ${awNick}`, payload: { command: "find_gp_saved" }, color: "positive" })
            .row()
            .textButton({ label: "🔎 Другой ник", payload: { command: "find_gp_start" }, color: "primary" });
      } else {
        awKb.textButton({ label: "🔎 Ввести ник Roblox", payload: { command: "find_gp_start" }, color: "primary" });
      }
      await ctx.reply({
        message:
          `${getGreeting(custStatus, firstName)}\n` +
          `✅ Код активирован! 📌 Цена геймпасса: ${passPrice} R$${awNickLine}\n\n` +
          `📖 Открой свою персональную инструкцию — заказ оформляется там же: создай геймпасс и найди его по нику Roblox 🔎\n` +
          `👉 ${startGuideUrl}\n\n` +
          `🔔 Здесь, в боте, придут уведомления о заказе.`,
        keyboard: awKb.inline(),
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
      const restoredGuideUrl = isDirect
        ? `https://robloxbank.ru/guide?source=direct`
        : `https://robloxbank.ru/guide?source=wb&skip=1&code=${restoredState.wbCode}`;
      // One-tap: gamepass already picked on the website → offer confirm.
      if (await vkOfferPreselectedGamepass(ctx, restoredState.wbCode, passPrice, restoredGuideUrl)) return;
      const resUser = await (db as any).user.findUnique({ where: { vkId: String(vkUserId) }, select: { robloxUsername: true } });
      const resNick = resUser?.robloxUsername;
      const resNickLine = resNick ? `\n🎮 Ник: ${resNick}` : "";
      const resKb = Keyboard.builder()
        .urlButton({ label: "📖 ОТКРЫТЬ МОЮ ИНСТРУКЦИЮ", url: restoredGuideUrl })
        .row();
      if (resNick) {
        resKb.textButton({ label: `✅ Найти у ${resNick}`, payload: { command: "find_gp_saved" }, color: "positive" })
             .row()
             .textButton({ label: "🔎 Другой ник", payload: { command: "find_gp_start" }, color: "primary" });
      } else {
        resKb.textButton({ label: "🔎 Ввести ник Roblox", payload: { command: "find_gp_start" }, color: "primary" });
      }
      await ctx.reply({
        message:
          `${getGreeting(custStatus, firstName)}\n` +
          `✅ Код активирован · цена геймпасса ${passPrice} R$${resNickLine}\n\n` +
          `📖 Вот твоя персональная инструкция — заказ оформляется там же: создай геймпасс и найди его по нику Roblox 🔎\n\n` +
          `🔔 Здесь, в боте, ты получишь уведомления о заказе — приняли → выкупаем → готово.`,
        keyboard: resKb.inline(),
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
          .textButton({ label: "📊 Мой заказ",         payload: { command: "status" },       color: "primary"   })
          .row()
          .textButton({ label: "💎 Купить напрямую", payload: { command: "start_direct" },  color: "positive"  })
          .row()
          .textButton({ label: "❓ Частые вопросы",   payload: { command: "faq" }, color: "secondary" })
          .inline(),
      });
      return;
    }

    const coldGroupId  = process.env.VK_GROUP_ID;
    const coldGroupUrl = coldGroupId ? `https://vk.com/club${coldGroupId}` : "https://vk.com";
    await ctx.reply({
      message:
        "👋 Привет! Я бот RobloxBank — помогу получить робуксы 💎\n\n" +
        "⭐ Подпишись на наше сообщество 👇\n" +
        "После подписки бот точнее находит геймпассы по нику и ты получишь персональную инструкцию — заказ оформляется прямо в ней.\n\n" +
        `${coldGroupUrl}\n\n` +
        "🔑 Есть код с WB-карты? Напиши его прямо сюда.\n" +
        "💎 Нет кода? Можно купить Robux напрямую — без карты WB, быстрее и выгоднее.",
      keyboard: Keyboard.builder()
        .urlButton({ label: "🔔 Подписаться", url: coldGroupUrl })
        .row()
        .textButton({ label: "✅ Я вступил", payload: { command: "check_sub" }, color: "positive" })
        .textButton({ label: "💎 Купить напрямую", payload: { command: "start_direct" }, color: "positive" })
        .row()
        .textButton({ label: "❓ Частые вопросы", payload: { command: "faq" }, color: "secondary" })
        .inline(),
    });
    return;
  }

  // ── Direct order payload commands ─────────────────────────────────────────
  if (msgPayload?.command === "start_direct") {
    await handleStartDirect(ctx, vkUserId);
    return;
  }
  if (msgPayload?.command === "direct_pack") {
    const packAmt = typeof msgPayload.amount === "number" ? msgPayload.amount : NaN;
    if (!isNaN(packAmt) && DIRECT_PACKS.includes(packAmt)) {
      await handleDirectPackSelect(ctx, vkUserId, packAmt);
    }
    return;
  }
  // «📋 Все паки» — полный каталог (PLAN +5.C)
  if (msgPayload?.command === "direct_catalog") {
    const cu = await (db as any).user.findUnique({
      where: { vkId: String(vkUserId) },
      select: { balance: true, bonusExpiresAt: true, rubleDiscount: true },
    }).catch(() => null);
    const cRaw = cu?.balance ?? 0;
    const cExpired = cu?.bonusExpiresAt ? cu.bonusExpiresAt <= new Date() : false;
    const cBonus = cRaw > 0 && !cExpired ? cRaw : 0;
    await ctx.reply({
      message: "📋 Все паки — выбери количество:",
      keyboard: buildVkPackCatalogKb(cBonus, cu?.rubleDiscount ?? 0),
    });
    return;
  }
  if (msgPayload?.command === "direct_confirm") {
    await handleDirectConfirm(ctx, vkUserId, false);
    return;
  }
  if (msgPayload?.command === "direct_confirm_nb") {
    await handleDirectConfirm(ctx, vkUserId, true);
    return;
  }
  if (msgPayload?.command === "direct_custom") {
    setState(vkUserId, { type: "AWAITING_DIRECT_AMOUNT" });
    const customKb = Keyboard.builder();
    customKb.textButton({ label: "◀️ К пакам", payload: { command: "start_direct" }, color: "secondary" });
    customKb.textButton({ label: "❌ Отменить", payload: { command: "direct_cancel" }, color: "negative" });
    await ctx.reply({
      message: `✏️ Своё количество\n\nВведи количество робуксов от ${CUSTOM_MIN} до ${CUSTOM_MAX.toLocaleString("ru-RU")}:`,
      keyboard: customKb.inline(),
    });
    return;
  }
  if (msgPayload?.command === "direct_cancel") {
    clearState(vkUserId);
    const cancelKb = Keyboard.builder();
    cancelKb.textButton({ label: "💎 Заказать снова", payload: { command: "start_direct" }, color: "positive" });
    await ctx.reply({ message: "Заказ отменён.", keyboard: cancelKb.inline() });
    return;
  }
  if (msgPayload?.command === "direct_back") {
    const backState = getState(vkUserId);
    if (!backState) {
      await handleStartDirect(ctx, vkUserId);
      return;
    }
    const st = backState.type;
    if (st === "AWAITING_DIRECT_CONFIRM") {
      await handleStartDirect(ctx, vkUserId);
    } else if (st === "AWAITING_DIRECT_NICK" || st === "AWAITING_DIRECT_NICK_INPUT") {
      await handleDirectPackSelect(ctx, vkUserId, backState.amount);
    } else if (st === "AWAITING_DIRECT_GAMEPASS") {
      const fd = { amount: backState.amount, totalAmount: backState.totalAmount, bonus: backState.bonus, rubleDiscount: backState.rubleDiscount, rublePrice: backState.rublePrice };
      await showVkNickStep(ctx, vkUserId, fd);
    } else if (st === "AWAITING_DIRECT_SUMMARY") {
      if (backState.robloxUsername) {
        const fd = { amount: backState.amount, totalAmount: backState.totalAmount, bonus: backState.bonus, rubleDiscount: backState.rubleDiscount, rublePrice: backState.rublePrice };
        setState(vkUserId, { type: "AWAITING_DIRECT_NICK", ...fd });
        await handleVkDirectNickResolved(ctx, vkUserId, backState.robloxUsername);
      } else {
        const fd = { amount: backState.amount, totalAmount: backState.totalAmount, bonus: backState.bonus, rubleDiscount: backState.rubleDiscount, rublePrice: backState.rublePrice };
        await showVkNickStep(ctx, vkUserId, fd);
      }
    } else {
      await handleStartDirect(ctx, vkUserId);
    }
    return;
  }
  if (msgPayload?.command === "direct_nick_ok") {
    const nickState = getState(vkUserId);
    if (!nickState || nickState.type !== "AWAITING_DIRECT_NICK") {
      await ctx.reply("⏳ Сессия истекла. Начни заново.");
      return;
    }
    const savedNick = msgPayload.nick as string;
    if (!savedNick) { await ctx.reply("Ошибка — начни заново."); return; }
    await handleVkDirectNickResolved(ctx, vkUserId, savedNick);
    return;
  }
  if (msgPayload?.command === "direct_nick_new") {
    const nickState = getState(vkUserId);
    if (!nickState || (nickState.type !== "AWAITING_DIRECT_NICK" && nickState.type !== "AWAITING_DIRECT_NICK_INPUT" && nickState.type !== "AWAITING_DIRECT_GAMEPASS" && nickState.type !== "AWAITING_DIRECT_SUMMARY")) {
      await ctx.reply("⏳ Сессия истекла. Начни заново.");
      return;
    }
    setState(vkUserId, { type: "AWAITING_DIRECT_NICK_INPUT", amount: nickState.amount, totalAmount: nickState.totalAmount, bonus: nickState.bonus, rubleDiscount: nickState.rubleDiscount, rublePrice: nickState.rublePrice });
    const kb = Keyboard.builder();
    kb.textButton({ label: "◀️ Назад", payload: { command: "direct_back" }, color: "secondary" });
    kb.textButton({ label: "❌ Отменить", payload: { command: "direct_cancel" }, color: "negative" });
    await ctx.reply({ message: "🎮 Введи ник Roblox\n\nНапиши его в чат:", keyboard: kb.inline() });
    return;
  }
  if (msgPayload?.command === "direct_gp_pick" && typeof msgPayload.passId === "string") {
    await handleVkDirectGpPick(ctx, vkUserId, msgPayload.passId);
    return;
  }
  if (msgPayload?.command === "direct_submit") {
    await handleVkDirectSubmit(ctx, vkUserId);
    return;
  }
  if (msgPayload?.command === "direct_cancel_intent" && msgPayload?.intentId) {
    const intentId = String(msgPayload.intentId);
    const intent = await (db as any).directIntent.findUnique({ where: { id: intentId } });
    if (!intent || intent.status !== "PENDING") {
      await ctx.reply("Заявка уже обработана.");
      return;
    }
    await (db as any).directIntent.update({ where: { id: intentId }, data: { status: "CANCELLED" } });
    const kb = Keyboard.builder();
    kb.textButton({ label: "💎 Заказать снова", payload: { command: "start_direct" }, color: "positive" });
    await ctx.reply({ message: "❌ Заявка отменена.", keyboard: kb.inline() });
    await Promise.allSettled(
      ADMIN_IDS.map(id => tgSend(id, `❌ Заявка ${escapeHtml(intent.robloxUsername)} · ${intent.totalAmount} R$ отменена покупателем (VK).`))
    );
    return;
  }
  if (msgPayload?.command === "edit_nick") {
    setState(vkUserId, { type: "AWAITING_NICK_EDIT" });
    await ctx.reply("🎮 Введи новый ник Roblox:");
    return;
  }
  if (msgPayload?.command === "user_cancel_direct" && msgPayload?.orderId) {
    const ucdOrderId = String(msgPayload.orderId);
    const ucdOrder = await (db as any).wbOrder.findUnique({
      where: { id: ucdOrderId },
      include: { user: { select: { id: true, vkId: true, balance: true } } },
    });
    if (!ucdOrder) { await ctx.reply("Заказ не найден."); return; }
    if (ucdOrder.status !== "AWAITING_PAYMENT") {
      await ctx.reply("Этот заказ уже нельзя отменить.");
      return;
    }
    if (ucdOrder.user?.vkId !== String(vkUserId)) {
      await ctx.reply("⛔ Это не твой заказ.");
      return;
    }
    const updateData: any = {};
    const baseAmount = ucdOrder.amount;
    // Restore bonus if any was applied (amount > pack denomination)
    const dirCodeRec = await (db as any).wbCode.findFirst({ where: { code: ucdOrder.wbCode } });
    const bonusApplied = dirCodeRec ? baseAmount - dirCodeRec.denomination : 0;
    if (bonusApplied > 0) updateData.balance = (ucdOrder.user.balance ?? 0) + bonusApplied;

    await (db as any).$transaction(async (tx: any) => {
      await tx.wbOrder.update({
        where: { id: ucdOrderId },
        data: { status: "REJECTED", rejectionReason: "Отменён покупателем" },
      });
      if (Object.keys(updateData).length > 0) {
        await tx.user.update({ where: { id: ucdOrder.user.id }, data: updateData });
      }
    });
    await ctx.reply({
      message: `❌ Заказ на ${baseAmount} R$ отменён.\n\nЕсли хочешь — создай новый заказ.`,
      keyboard: Keyboard.builder()
        .textButton({ label: "💎 Заказать напрямую", payload: { command: "start_direct" }, color: "positive" })
        .inline(),
    });
    // Notify admins via TG
    const fullName = await vkGetName(vkUserId);
    const adminText =
      `❌ <b>Заказ <code>${ucdOrder.wbCode}</code> отменён покупателем</b>\n` +
      `👤 <a href="https://vk.com/id${vkUserId}">${escapeHtml(fullName)}</a> (VK)\n` +
      `💎 ${baseAmount} R$`;
    await Promise.allSettled(ADMIN_IDS.map((id) => tgSend(id, adminText)));
    return;
  }

  // ── 🔎 Find gamepass by Roblox nick (item 7) ───────────────────────────────
  if (msgPayload?.command === "find_gp_start") {
    await handleFindGpStart(ctx, vkUserId);
    return;
  }
  // ── 🔎 Auto-search by saved Roblox nick ───────────────────────────────────
  if (msgPayload?.command === "find_gp_saved") {
    await handleFindGpSaved(ctx, vkUserId);
    return;
  }
  // ── 🔎 Re-check the nick the user already entered (probableNick) ──────────
  if (msgPayload?.command === "find_gp_recheck") {
    await handleFindGpRecheck(ctx, vkUserId);
    return;
  }
  // ── ✏️ Change nick / gamepass on an order that isn't bought yet ────────────
  if (msgPayload?.command === "change_nick") {
    await handleChangeNick(ctx, vkUserId);
    return;
  }
  if (msgPayload?.command === "gp_pick" && typeof msgPayload.passId === "string") {
    await handleGpPick(ctx, vkUserId, msgPayload.passId);
    return;
  }
  // П2 (стейл-стейт): стейты, привязанные к заказу, могли отстать от БД —
  // gpw_ok, attach из TWA или выкуп уже перевели заказ дальше, а Map-стейт
  // остался и съедал любой текст формат-ошибкой (кейс DCTAKAJ: «❤️❤️» →
  // «Напиши свой ник…» при заказе давно в очереди). Перепроверяем статус.
  if (state?.type === "AWAITING_ROBLOX_NICK" || state?.type === "AWAITING_LINK") {
    const sweep = await sweepStaleVkOrderState(ctx, vkUserId, state.wbCode, text);
    if (sweep === "replied") return;
    if (sweep === "cleared") {
      // Валидный WB-код — стейт снят, уходим в штатный маршрут (PRIORITY-1 активация).
      await handleIdleMessage(ctx, vkUserId, text);
      return;
    }
    if (state.type === "AWAITING_ROBLOX_NICK") {
      await handleRobloxNickInput(ctx, vkUserId, text, state.wbCode, state.denomination);
      return;
    }
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
        .textButton({ label: "◀️ Назад",       payload: { command: "direct_back"    }, color: "secondary" })
        .textButton({ label: "❌ Отменить",    payload: { command: "direct_cancel"  }, color: "negative" })
        .inline(),
    });
    return;
  }
  // AWAITING_DIRECT_NICK_INPUT: user is typing a Roblox nick for the new direct flow
  if (state?.type === "AWAITING_DIRECT_NICK_INPUT") {
    const nick = text.replace(/^@/, "").trim();
    if (!ROBLOX_NICK_RE.test(nick)) {
      const kb = Keyboard.builder();
      kb.textButton({ label: "◀️ Назад", payload: { command: "direct_back" }, color: "secondary" });
      kb.textButton({ label: "❌ Отменить", payload: { command: "direct_cancel" }, color: "negative" });
      await ctx.reply({ message: "⚠️ Ник Roblox: 3–20 символов (буквы, цифры, _). Попробуй ещё раз:", keyboard: kb.inline() });
      return;
    }
    await handleVkDirectNickResolved(ctx, vkUserId, nick);
    return;
  }
  // AWAITING_DIRECT_NICK / AWAITING_DIRECT_GAMEPASS / AWAITING_DIRECT_SUMMARY: use buttons
  if (state?.type === "AWAITING_DIRECT_NICK" || state?.type === "AWAITING_DIRECT_GAMEPASS" || state?.type === "AWAITING_DIRECT_SUMMARY") {
    await ctx.reply("Используй кнопки выше ☝️");
    return;
  }
  // AWAITING_NICK_EDIT: user editing their nick from /menu
  if (state?.type === "AWAITING_NICK_EDIT") {
    clearState(vkUserId);
    const nick = text.replace(/^@/, "").trim();
    if (!ROBLOX_NICK_RE.test(nick)) {
      setState(vkUserId, { type: "AWAITING_NICK_EDIT" });
      await ctx.reply("⚠️ Ник Roblox: 3–20 символов (буквы, цифры, _). Попробуй ещё раз:");
      return;
    }
    const { resolveRobloxUserId } = await import("../shared/roblox");
    const rId = await resolveRobloxUserId(nick);
    if (!rId) {
      setState(vkUserId, { type: "AWAITING_NICK_EDIT" });
      await ctx.reply(`❌ Пользователь ${nick} не найден на Roblox. Проверь написание.`);
      return;
    }
    await (db as any).user.updateMany({ where: { vkId: String(vkUserId) }, data: { robloxUsername: nick } });
    await ctx.reply(`✅ Ник сохранён: ${nick}`);
    return;
  }

  // ── Direct order payment screenshot (BEFORE review routing) ───────────────
  if (messageHasPhoto(ctx) || state?.type === "AWAITING_DIRECT_PAYMENT") {
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

  if (state?.type === "AWAITING_REVIEW" || messageHasPhoto(ctx)) {
    console.log(`[VK] photo routing: vkUserId=${vkUserId} hasPhoto=${messageHasPhoto(ctx)} state=${state?.type ?? "none"}`);
    await handleReviewScreenshot(ctx, vkUserId, state?.type === "AWAITING_REVIEW" ? state.orderId : undefined);
    return;
  }

  // ── (C) No active state — DB-derived status / help message ───────────────
  // "status" button payload routes to the same handler as the "статус" keyword.
  const effectiveText = msgPayload?.command === "status" ? "статус" : text;
  await handleIdleMessage(ctx, vkUserId, effectiveText);
}

/**
 * П2 (стейл-стейт): перед обработкой стейта, привязанного к заказу
 * (AWAITING_LINK / AWAITING_ROBLOX_NICK), перепроверяем статус заказа в БД.
 * Терминальные события (gpw_ok, attach из TWA, выкуп) могли перевести заказ
 * дальше, а Map-стейт остался.
 *  - "valid"   — заказ всё ещё ждёт геймпасс (AWAITING_GAMEPASS/REJECTED) или
 *                БД недоступна: обрабатываем штатно;
 *  - "cleared" — стейт снят, текст (валидный WB-код) должен уйти обычным маршрутом;
 *  - "replied" — стейт снят, юзеру честно отвечено по фактическому статусу.
 */
async function sweepStaleVkOrderState(
  ctx: MessageContext,
  vkUserId: number,
  wbCode: string,
  text: string,
): Promise<"valid" | "cleared" | "replied"> {
  let order: any = null;
  try {
    order = await (db as any).wbOrder.findFirst({
      where: { wbCode },
      select: { status: true, wbCode: true },
    });
  } catch { return "valid"; }
  if (!order || order.status === "AWAITING_GAMEPASS" || order.status === "REJECTED") return "valid";

  clearState(vkUserId);

  // Валидный существующий WB-код не глотаем — пусть активируется штатно.
  if (/^[A-Za-z0-9]{7}$/.test(text) && /[A-Za-z]/.test(text)) {
    const codeExists = await (db as any).wbCode.findFirst({
      where: { code: { equals: text.toUpperCase(), mode: "insensitive" } },
      select: { id: true },
    }).catch(() => null);
    if (codeExists) return "cleared";
  }

  const statusKb = Keyboard.builder()
    .textButton({ label: "📊 Мой заказ", payload: { command: "status" }, color: "primary" })
    .inline();
  if (order.status === "PENDING" || order.status === "IN_PROGRESS") {
    await ctx.reply({
      message:
        `✅ По заказу ${order.wbCode} всё уже принято — он в очереди на выкуп, ничего присылать не нужно.\n\n` +
        `Как выкупим — сразу напишу сюда 💛`,
      keyboard: statusKb,
    });
  } else if (order.status === "COMPLETED") {
    await ctx.reply({
      message: `🎉 Заказ ${order.wbCode} уже выполнен!\n\nХочешь ещё робуксов? Оформи прямой заказ — без карты WB, быстрее и выгоднее.`,
      keyboard: Keyboard.builder()
        .textButton({ label: "💎 Купить напрямую", payload: { command: "start_direct" }, color: "positive" })
        .row()
        .textButton({ label: "📊 Мой заказ", payload: { command: "status" }, color: "primary" })
        .inline(),
    });
  } else if (order.status === "AWAITING_PAYMENT" || order.status === "PAYMENT_PENDING") {
    await ctx.reply({
      message: `💳 Заказ ${order.wbCode} ждёт оплату — реквизиты выше в чате. После оплаты пришли скрин сюда.`,
      keyboard: statusKb,
    });
  } else {
    await ctx.reply({
      message: `ℹ️ Статус заказа ${order.wbCode} изменился — проверь кнопкой ниже.`,
      keyboard: statusKb,
    });
  }
  return "replied";
}

/**
 * Website Step-9 handoff (VK). Two cases when the user picked a gamepass on the
 * site:
 *   1. The site already materialised the order (PENDING/processing) → show
 *      "заказ оформлен, слежу за статусом", not another buy prompt.
 *   2. Still AWAITING_GAMEPASS/REJECTED → offer the one-tap "выкупаем?" as a
 *      fallback (routes into gp_pick → handleGpPick, full validation runs).
 * Returns true when something was shown.
 */
async function vkOfferPreselectedGamepass(
  ctx: MessageContext,
  code: string,
  passPrice: number,
  guideUrl: string,
): Promise<boolean> {
  try {
    if (!code) return false;
    const wbCode = await (db as any).wbCode.findFirst({
      where: { code: { equals: code, mode: "insensitive" } },
      select: { selectedGamepassId: true },
    });
    const gpId = wbCode?.selectedGamepassId ? String(wbCode.selectedGamepassId) : "";
    if (!/^\d{3,15}$/.test(gpId)) return false;

    // Case 1 — order already placed from the site.
    const order = await (db as any).wbOrder.findFirst({
      where: { wbCode: { equals: code, mode: "insensitive" } },
      select: { id: true, status: true },
    });
    if (order && order.status !== "AWAITING_GAMEPASS" && order.status !== "REJECTED") {
      await ctx.reply({
        message:
          `✅ Заказ уже оформлен — твой геймпасс принят! 🙌\n\n` +
          `🔑 Код ВБ: ${code}\n` +
          `📊 Слежу за статусом: приняли → выкупаем → готово ✨\n\n` +
          `Как только выкупим — сразу напишу сюда.`,
        keyboard: Keyboard.builder()
          .textButton({ label: "📊 Мой заказ", payload: { command: "status" }, color: "positive" })
          .row()
          .textButton({ label: "💎 Купить ещё напрямую", payload: { command: "start_direct" }, color: "primary" })
          .inline(),
      });
      return true;
    }

    // Case 2 — fallback one-tap offer.
    await ctx.reply({
      message:
        `🎯 Ты уже выбрал геймпасс на сайте!\n\n` +
        `Выкупаем его за ${passPrice} R$? Жми «✅ Да» — проверю и оформлю заказ.`,
      keyboard: Keyboard.builder()
        .textButton({ label: `✅ Да, выкупаем (${passPrice} R$)`, payload: { command: "gp_pick", passId: gpId }, color: "positive" })
        .row()
        .textButton({ label: "🔎 Выбрать другой", payload: { command: "find_gp_start" }, color: "primary" })
        .row()
        .urlButton({ label: "📖 Инструкция", url: guideUrl })
        .inline(),
    });
    return true;
  } catch (err: any) {
    console.error("[VK] vkOfferPreselectedGamepass:", err?.message ?? err);
    return false;
  }
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
    // If THIS user owns the code and already has a placed order (e.g. they
    // materialised it from the website one-tap), greet with the order status
    // instead of the "уже активирован" dead-end.
    const owner = await (db as any).user.findUnique({ where: { vkId: String(vkUserId) }, select: { id: true } });
    if (owner && owner.id === wbCode.userId) {
      const placedOrder = await (db as any).wbOrder.findFirst({
        where: { userId: owner.id, wbCode: { equals: code, mode: "insensitive" } },
        orderBy: { createdAt: "desc" },
        select: { id: true, status: true },
      });
      if (placedOrder && ["PENDING", "IN_PROGRESS", "COMPLETED"].includes(placedOrder.status)) {
        const done = placedOrder.status === "COMPLETED";
        await ctx.reply({
          message: done
            ? `✅ Заказ выполнен — спасибо! 🎉\n\nХочешь ещё робуксов? 💎`
            : `✅ Заказ оформлен — твой геймпасс принят! 🙌\n\n` +
              `🔑 Код ВБ: ${code}\n` +
              `📊 Слежу за статусом: приняли → выкупаем → готово ✨\n\n` +
              `Как только выкупим — сразу напишу сюда.`,
          keyboard: Keyboard.builder()
            .textButton({ label: "📊 Мой заказ", payload: { command: "status" }, color: "positive" })
            .row()
            .textButton({ label: "💎 Купить напрямую", payload: { command: "start_direct" }, color: "primary" })
            .inline(),
        });
        return;
      }
    }
    await ctx.reply("⚠️ Этот код уже был активирован.\n\nЕсли карточка твоя — напиши нам: https://t.me/RobloxBank_PA");
    return;
  }

  // Fetch real name from VK API. У MessageContext нет свойства `vk` —
  // прежний `(ctx as any).vk.api` всегда падал в TypeError, и каждый новый
  // юзер записывался в БД как «VK User». vkGetName ходит в API по токену;
  // её фолбэк «VK #<id>» ниже самолечится (update при следующем контакте).
  const fullName = await vkGetName(vkUserId);

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
          ...(user.robloxUsername ? { robloxUsername: user.robloxUsername } : {}),
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
    await sendVkSubPrompt(ctx, rawCode, totalAmount);
    return;
  }

  const vkGuideUrl = `https://robloxbank.ru/guide?source=wb&skip=1&code=${code}`;
  // One-tap: gamepass already picked on the website → offer confirm.
  if (await vkOfferPreselectedGamepass(ctx, code, passPrice, vkGuideUrl)) return;
  // Returning user with saved nick — show it and offer auto-search
  const vkSavedNick = user.robloxUsername;
  const vkNickLine = vkSavedNick ? `\n🎮 Ник: ${vkSavedNick}` : "";
  const kb = Keyboard.builder()
    .urlButton({ label: "📖 ОТКРЫТЬ ИНСТРУКЦИЮ", url: vkGuideUrl })
    .row();
  if (vkSavedNick) {
    kb.textButton({ label: `✅ Найти у ${vkSavedNick}`, payload: { command: "find_gp_saved" }, color: "positive" })
      .row()
      .textButton({ label: "🔎 Другой ник", payload: { command: "find_gp_start" }, color: "primary" });
  } else {
    kb.textButton({ label: "🔎 Ввести ник Roblox", payload: { command: "find_gp_start" }, color: "primary" });
  }
  await ctx.reply({
    message:
      greetLine + `\n` +
      `✅ Код ${code} активирован · номинал ${totalAmount} R$ → геймпасс ${passPrice} R$${vkNickLine}\n\n` +
      `📖 Открой инструкцию по кнопке ниже — она проведёт тебя по шагам. Заказ оформляется прямо там 👇`,
    keyboard: kb.inline(),
  });
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
    // The bot's own prompts promise «пришли свой ник — найду геймпасс сам».
    // Honor that: nick-looking text routes into the nick search instead of
    // a format error.
    if (ROBLOX_NICK_RE.test(input.trim().replace(/^@/, ""))) {
      await handleRobloxNickInput(ctx, vkUserId, input, wbCode, denomination);
      return;
    }
    const fmtGuideUrl = `https://robloxbank.ru/guide?source=wb&skip=1&code=${wbCode}`;
    await ctx.reply({
      message:
        "⚠️ Не удалось распознать.\n\n" +
        "Напиши свой ник в Roblox (латиница, 3–20 символов) — найду геймпасс сам.\n\n" +
        "📖 Как создать геймпасс и найти ник — в инструкции:",
      keyboard: Keyboard.builder()
        .urlButton({ label: "📖 ИНСТРУКЦИЯ", url: fmtGuideUrl })
        .row()
        .textButton({ label: "🔎 Ввести ник Roblox", payload: { command: "find_gp_start" }, color: "primary" })
        .inline(),
    });
    return;
  }

  // ── Roblox API validation ─────────────────────────────────────────────
  // Warn the user — validation can take 10–30 s via bridge/retries.
  const checkingMsg: any = await ctx.reply("⏳ Проверяем геймпасс…");
  // Edit-in-place (пункт F): первый ответ ветки редактируется в «⏳ Проверяем…».
  const showResult = buildVkEditInPlace(ctx, vkUserId, checkingMsg);
  const expectedPrice = Math.ceil(denomination / 0.7);
  const gamepassInfo  = await getGamepassDetails(passId);

  if (!gamepassInfo) {
    // Roblox returned HTTP responses but no usable data → gamepass doesn't exist
    await showResult(
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

    // Early nick capture: Roblox already told us the creator — note it (в заметку
    // заказа) even if validation fails below (wrong price / not for sale), so
    // the manager sees the probable nick immediately.
    if (gamepassInfo.creatorName) {
      void noteProbableNick({ nick: gamepassInfo.creatorName, source: "gp-validation", wbCode });
    }

    if (!gamepassInfo.isActive) {
      if (gamepassInfo.isNotInCatalog) {
        await showResult({
          message:
            `❌ Геймпасс недоступен — скорее всего, игра, в которой он создан, закрыта (Private).\n\n` +
            `Два варианта:\n` +
            `1. Открой игру: Creator Hub → Experience → Settings → Permissions → Public → сохрани. Затем пришли ссылку снова.\n` +
            `2. Создай геймпасс в любой публичной игре (цена: ${expectedPrice} R$) и пришли новую ссылку.\n\n` +
            `Не удаляй геймпасс до получения оплаты.\n\n` +
            `📖 Подробная инструкция по кнопке ниже:`,
          keyboard: Keyboard.builder()
            .urlButton({ label: "📖 ИНСТРУКЦИЯ", url: `https://robloxbank.ru/guide?source=wb&skip=1&code=${wbCode}` })
            .inline(),
        });
      } else if (gamepassInfo.isGamePrivate) {
        await showResult({
          message:
            `❌ Геймпасс в закрытой игре — выкупить невозможно.\n\n` +
            `Как открыть игру:\n` +
            `1. Нажми на плейс → Configure → Settings\n` +
            `2. Найди Audience → выбери Public → сохрани\n\n` +
            `Не помогло? Configure → Questionnaire → Restart\n` +
            `Ответь «No» на все 10 вопросов → Continue\n\n` +
            `Или создай геймпасс в другой публичной игре (цена: ${expectedPrice} R$)\n\n` +
            `📖 Полная инструкция со скринами:`,
          keyboard: Keyboard.builder()
            .urlButton({ label: "📖 ИНСТРУКЦИЯ", url: `https://robloxbank.ru/guide?source=wb&skip=1&code=${wbCode}` })
            .inline(),
        });
      } else {
        await showResult({
          message:
            `⚠️ Геймпасс №${passId} не выставлен на продажу.\n\n` +
            `Убедись, что он активен и доступен для покупки, затем пришли ссылку снова.\n\n` +
            `📖 Как правильно создать и активировать — в инструкции:`,
          keyboard: Keyboard.builder()
            .urlButton({ label: "📖 ИНСТРУКЦИЯ", url: `https://robloxbank.ru/guide?source=wb&skip=1&code=${wbCode}` })
            .inline(),
        });
      }
      return;
    }

    if (Math.abs(gamepassInfo.price - expectedPrice) > 2) {
      await showResult({
        message:
          `⚠️ Цена геймпасса не совпадает с ожидаемой.\n\n` +
          `Установлено: ${gamepassInfo.price} R$\n` +
          `Ожидается:   ${expectedPrice} R$\n\n` +
          `❗️ Чаще всего причина — включённый Managed pricing. Он автоматически меняет цену, и выкупить геймпасс невозможно, пока цена не совпадёт.\n\n` +
          `Исправь: Passes → твой пасс → ☰ → Sales → отключи Managed pricing → поставь правильную цену → Save Changes. Потом пришли ссылку снова.\n\n` +
          `📖 Подробная инструкция:`,
        keyboard: Keyboard.builder()
          .urlButton({ label: "📖 ИНСТРУКЦИЯ", url: `https://robloxbank.ru/guide?source=wb&skip=1&code=${wbCode}` })
          .inline(),
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
    await showResult(
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
    await showResult("Ошибка сессии. Напиши нам: https://t.me/RobloxBank_PA — разберёмся вместе.");
    clearState(vkUserId);
    return;
  }

  // Count completed/pending/rejected orders only — exclude the current order
  // entirely (by wbCode): if it was already promoted to PENDING (e.g. by the
  // site one-tap a minute earlier), the old status-only filter counted the
  // order itself → false «ПОВТОРНЫЙ КЛИЕНТ» badge.
  const previousOrderCount = await (db as any).wbOrder.count({
    where: { userId: user.id, status: { notIn: ["AWAITING_GAMEPASS"] }, wbCode: { not: wbCode } },
  }).catch(() => 0);

  // ── Atomic claim + order creation ──────────────────────────────────────
  // Roblox validation passed above — now commit in a single transaction:
  //  1. Claim the code (userId:null covers both fresh and web-pre-activated codes)
  //  2. Create the order
  // Bonus balance is preserved — only spent on direct bot orders.
  // If any step fails the whole transaction rolls back — code stays unclaimed.
  let order: any;
  let duplicateSubmission = false;
  let replacedGamepassUrl: string | null = null;
  try {
    const txResult = await (db as any).$transaction(async (tx: any) => {
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
      let replacedUrl: string | null = null;
      if (existingOrder) {
        // AWAITING_GAMEPASS / REJECTED → first gamepass; PENDING / IN_PROGRESS →
        // the user re-picked their nick ("передумал") before it was bought. Both
        // (re)bind the gamepass and (re)set PENDING so the manager re-checks.
        // COMPLETED is the only terminal block here.
        if (existingOrder.status === "COMPLETED") {
          throw Object.assign(new Error("Order already exists"), { code: "P2002" });
        }
        const isProcessing = existingOrder.status === "PENDING" || existingOrder.status === "IN_PROGRESS";
        if (isProcessing && existingOrder.gamepassUrl === cleanLink) {
          // Same gamepass re-submitted while the order is already queued —
          // idempotent no-op: no re-PENDING, no duplicate admin card (bug
          // «двойные карточки» J2XVS0: site one-tap + bot submit of same pass).
          return { order: existingOrder, duplicate: true, replacedUrl: null };
        }
        // A DIFFERENT pass on a queued order = замена — card gets a 🔁 marker.
        if (isProcessing) replacedUrl = existingOrder.gamepassUrl;
        // Promote / re-point to PENDING with the (new) gamepass link
        newOrder = await tx.wbOrder.update({
          where: { id: existingOrder.id },
          data: {
            gamepassUrl: cleanLink,
            status: "PENDING",
            pendingAt: new Date(),
            rejectionReason: null,
            adminId: null,
            ...(validatedCreator ? { robloxUsername: validatedCreator } : {}),
          },
        });
      } else {
        // Fresh order
        newOrder = await tx.wbOrder.create({
          data: {
            amount:      denomination,
            gamepassUrl: cleanLink,
            status:      "PENDING",
            pendingAt:   new Date(),
            platform:    "VK",
            userId:      user.id,
            wbCode,
            ...(validatedCreator ? { robloxUsername: validatedCreator } : {}),
          },
        });
      }

      // Bonus balance is preserved — only spent on direct bot orders, not WB-code orders.

      return { order: newOrder, duplicate: false, replacedUrl };
    });
    order = txResult.order;
    duplicateSubmission = txResult.duplicate;
    replacedGamepassUrl = txResult.replacedUrl;
  } catch (err: any) {
    if (err.isClaimed) {
      clearState(vkUserId);
      await showResult("⚠️ Этот код уже был активирован другим пользователем. Обратись в поддержку.\nhttps://t.me/RobloxBank_PA");
      return;
    }
    if (err.code === "P2002") {
      clearState(vkUserId);
      await showResult("⚠️ Заказ по этому коду уже создан и сейчас обрабатывается. Напиши «статус» чтобы проверить.\n\nНужна помощь? Напиши прямо сюда — ответим здесь 👇 Если удобнее в Telegram: https://t.me/RobloxBank_PA");
      return;
    }
    console.error("[VK] Order/transaction error:", err);
    await showResult("❌ Ошибка при создании заказа. Попробуй позже или напиши нам: https://t.me/RobloxBank_PA");
    return;
  }

  clearState(vkUserId);

  if (duplicateSubmission) {
    // Same pass on an already-queued order — confirm to the user, but do NOT
    // re-send the admin card (root cause of «двойные карточки»).
    await showResult({
      message: "✅ Этот геймпасс уже принят — заказ в обработке, выкупим в ближайшее время.\n\nСтатус — по кнопке ниже 👇",
      keyboard: Keyboard.builder()
        .textButton({ label: "📊 Мой заказ", payload: { command: "status" }, color: "positive" })
        .inline(),
    });
    return;
  }

  if (validatedCreator) {
    try { await (db as any).user.update({ where: { vkId: String(vkUserId) }, data: { robloxUsername: validatedCreator } }); } catch {}
  }

  const creatorLine = validatedCreator ? `\n👤 Создатель: ${validatedCreator}` : "";
  const priceLine = validatedPrice != null ? `\n💰 Цена: ${validatedPrice} R$` : "";
  await showResult({
    message:
      `🎉 Твой геймпасс принят!` +
      creatorLine +
      priceLine +
      `\n\n📋 Что будет дальше:\n` +
      `1. Выкупим твой геймпасс\n` +
      `2. Пришлём уведомление сюда ✅\n` +
      `3. Roblox начислит робуксы — это 5–7 дней после выкупа\n\n` +
      `⚠️ Обязательно проверь, что Managed pricing отключён (Sales → переключатель OFF). Если он включён — Roblox изменит цену и мы не сможем выкупить геймпасс, пока ты не исправишь. Подробности — шаг 7 инструкции.\n\n` +
      `Ничего делать не нужно — просто жди сообщение 👌` +
      BUYOUT_ETA_NOTE +
      `\n\nКод ВБ: ${wbCode} · Статус и бонусы — в меню 👇`,
    keyboard: Keyboard.builder()
      .textButton({ label: "📊 Мой заказ", payload: { command: "status" }, color: "positive" })
      .row()
      .textButton({ label: "👤 Открыть моё меню", payload: { command: "menu" }, color: "secondary" })
      .inline(),
  });

  // Soft subscription prompt — order is already saved, never blocks
  const groupId = process.env.VK_GROUP_ID;
  if (groupId) {
    try {
      if (!(await isVkSubscribed(ctx, vkUserId))) {
        const groupUrl = `https://vk.com/club${groupId}`;
        await ctx.reply({
          message:
            `⭐ Кстати — подпишись на наше сообщество, чтобы не пропустить акции и бонусы:\n${groupUrl}`,
          keyboard: Keyboard.builder()
            .urlButton({ label: "🔔 Подписаться", url: groupUrl })
            .inline(),
        });
      }
    } catch { /* non-fatal */ }
  }

  // Fetch real name for admin card (non-blocking — fallback is "VK #id")
  const vkName = user.name ?? await vkGetName(vkUserId);

  // Marker: did the customer pick this pass on the website? selectedGamepassId
  // is only ever written by /api/wb-code/select-gamepass. Non-fatal extra read.
  let viaWebOneTap = false;
  try {
    const codeRow = await (db as any).wbCode.findFirst({
      where: { code: { equals: wbCode, mode: "insensitive" } },
      select: { selectedGamepassId: true },
    });
    viaWebOneTap = !!codeRow?.selectedGamepassId && cleanLink.includes(String(codeRow.selectedGamepassId));
  } catch { /* non-fatal — marker just won't show */ }

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
    viaWebOneTap,
    replacedGamepassUrl: replacedGamepassUrl ?? undefined,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// B2 — Gamepass search by Roblox nick (item 7)
// ─────────────────────────────────────────────────────────────────────────────

// ROBLOX_NICK_RE now imported from shared/admin
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
    where: { userId: user.id, status: { in: VK_CHANGEABLE_ORDER_STATUSES } },
    orderBy: { createdAt: "desc" },
  });
  if (!order) {
    await ctx.reply("У тебя сейчас нет активного заказа. Введи код WB чтобы начать.");
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

async function handleFindGpSaved(ctx: MessageContext, vkUserId: number): Promise<void> {
  const user = await (db as any).user.findUnique({
    where: { vkId: String(vkUserId) },
    select: { id: true, robloxUsername: true },
  });
  if (!user?.robloxUsername) {
    await handleFindGpStart(ctx, vkUserId);
    return;
  }
  const order = await (db as any).wbOrder.findFirst({
    where: { userId: user.id, status: { in: VK_CHANGEABLE_ORDER_STATUSES } },
    orderBy: { createdAt: "desc" },
  });
  if (!order) {
    await ctx.reply("У тебя сейчас нет активного заказа. Введи код WB чтобы начать.");
    return;
  }
  setState(vkUserId, {
    type: "AWAITING_ROBLOX_NICK",
    wbCode: order.wbCode,
    denomination: order.amount,
  });
  await handleRobloxNickInput(ctx, vkUserId, user.robloxUsername, order.wbCode, order.amount);
}

/**
 * «🔎 Уже сделал/исправил — проверить» — повторный поиск по нику, который клиент
 * УЖЕ вводил (order.probableNick из раннего захвата → order.robloxUsername →
 * сохранённый User.robloxUsername). Раньше кнопка вела на find_gp_start и
 * заставляла вводить ник заново (жалоба владельца 2026-07-04). Если ника нигде
 * нет — фолбэк на обычный ввод.
 */
async function handleFindGpRecheck(ctx: MessageContext, vkUserId: number): Promise<void> {
  const user = await (db as any).user.findUnique({
    where: { vkId: String(vkUserId) },
    select: { id: true, robloxUsername: true },
  });
  if (!user) {
    await ctx.reply("Сессия истекла — напиши «Начать», чтобы продолжить.");
    return;
  }
  const order = await (db as any).wbOrder.findFirst({
    where: { userId: user.id, status: { in: VK_CHANGEABLE_ORDER_STATUSES } },
    orderBy: { createdAt: "desc" },
  });
  if (!order) {
    await ctx.reply("У тебя сейчас нет активного заказа. Введи код WB чтобы начать.");
    return;
  }
  const nick = order.probableNick ?? order.robloxUsername ?? user.robloxUsername;
  if (!nick) {
    await handleFindGpStart(ctx, vkUserId);
    return;
  }
  setState(vkUserId, {
    type: "AWAITING_ROBLOX_NICK",
    wbCode: order.wbCode,
    denomination: order.amount,
  });
  await handleRobloxNickInput(ctx, vkUserId, nick, order.wbCode, order.amount);
}

/**
 * "Передумал" — re-pick nick / gamepass on an order that hasn't been bought yet.
 * Same machinery as {@link handleFindGpStart} but with copy that makes the intent
 * explicit (we re-bind the order to the newly chosen gamepass). Direct/paid
 * orders are excluded — only WB orders re-route through the nick search.
 */
async function handleChangeNick(ctx: MessageContext, vkUserId: number): Promise<void> {
  const user = await (db as any).user.findUnique({
    where: { vkId: String(vkUserId) },
    select: { id: true },
  });
  if (!user) {
    await ctx.reply("Сессия истекла — напиши «Начать», чтобы продолжить.");
    return;
  }
  const order = await (db as any).wbOrder.findFirst({
    where: { userId: user.id, status: { in: VK_CHANGEABLE_ORDER_STATUSES }, isDirectOrder: false },
    orderBy: { createdAt: "desc" },
  });
  if (!order) {
    await ctx.reply("Нет заказа, который можно изменить.");
    return;
  }
  setState(vkUserId, {
    type: "AWAITING_ROBLOX_NICK",
    wbCode: order.wbCode,
    denomination: order.amount,
  });
  const passPrice = Math.ceil(order.amount / 0.7);
  await ctx.reply(
    `⚠️ Внимание: меняем ник и геймпасс в заказе!\n\n` +
    `Текущий геймпасс будет заменён на новый.\n` +
    `Пришли новый ник Roblox — найду геймпассы за ${passPrice} R$ и переоформлю заказ.\n\n` +
    `Используй это только если ошибся с ником при оформлении.`
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

  const searchingMsg: any = await ctx.reply(`🔎 Ищу геймпассы у ${nick}…`);
  const showResult = buildVkEditInPlace(ctx, vkUserId, searchingMsg);
  const expectedPrice = Math.ceil(denomination / 0.7);

  let outcome: GamepassSearchOutcome;
  try {
    outcome = await searchGamepassesByNick(nick, expectedPrice);
  } catch (err: any) {
    // Infra failure (bridge/Roblox down) is NOT «ника нет на Roblox» — be honest.
    console.error("[VK/find-gp] searchGamepassesByNick failed:", err?.message ?? err);
    setState(vkUserId, { type: "AWAITING_LINK", wbCode, denomination });
    const downGuideUrl = `https://robloxbank.ru/guide?source=wb&skip=1&code=${wbCode}`;
    await showResult({
      message:
        "⚠️ Поиск по нику временно недоступен — не получилось связаться с Roblox.\n\n" +
        "Попробуй ещё раз через минуту или пришли ссылку на геймпасс вручную.\n\n" +
        "📖 Вся инструкция по созданию и оформлению — по кнопке ниже.",
      keyboard: Keyboard.builder()
        .urlButton({ label: "📖 ИНСТРУКЦИЯ", url: downGuideUrl })
        .row()
        .textButton({ label: "🔎 Попробовать ещё раз", payload: { command: "find_gp_recheck" }, color: "primary" })
        .inline(),
    });
    return;
  }

  // Always return to LINK state — picker handles next move via VK payload button.
  setState(vkUserId, { type: "AWAITING_LINK", wbCode, denomination });

  // Early nick capture: every branch except user_not_found means the nick is a
  // real Roblox account — note it on the order (заметка, не основное поле:
  // юзер мог опечататься), even if the gamepass never materialises (VFNCQMT).
  if (outcome.status !== "user_not_found") {
    void noteProbableNick({ nick, source: "nick-search", wbCode });
  }

  const guideUrl = `https://robloxbank.ru/guide?source=wb&skip=1&code=${wbCode}`;

  // Branch 1: nickname doesn't exist on Roblox
  if (outcome.status === "user_not_found") {
    await showResult({
      message:
        `🤷 Пользователя ${nick} нет на Roblox.\n\n` +
        `Скорее всего опечатка. Скопируй ник прямо со страницы профиля и пришли заново.\n\n` +
        `📖 Как найти ник и создать геймпасс — в инструкции:`,
      keyboard: Keyboard.builder()
        .urlButton({ label: "📖 ИНСТРУКЦИЯ", url: guideUrl })
        .row()
        .textButton({ label: "🔎 Попробовать ещё раз", payload: { command: "find_gp_start" }, color: "primary" })
        .inline(),
    });
    return;
  }

  // Branch 2: nick exists but no public for-sale gamepasses
  if (outcome.status === "no_gamepasses") {
    await showResult({
      message:
        `🙈 У ${nick} не нашли публичных геймпассов.\n\n` +
        `Скорее всего геймпасс ещё не создан, не выставлен на продажу или плейс закрыт.\n\n` +
        `⚠️ Пройди инструкцию — там по шагам: создание, разблокировка, правильная цена ${expectedPrice} R$:\n` +
        `👉 ${guideUrl}`,
      keyboard: Keyboard.builder()
        .urlButton({ label: "📖 ИНСТРУКЦИЯ", url: guideUrl })
        .row()
        .textButton({ label: "🔎 Уже сделал — проверить", payload: { command: "find_gp_recheck" }, color: "primary" })
        .row()
        .textButton({ label: "✏️ Поменять ник", payload: { command: "find_gp_start" }, color: "secondary" })
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
    await showResult({
      message:
        `У ${nick} нашли геймпассы, но ни один не за ${expectedPrice} R$:\n\n` +
        `${listLines}\n\n` +
        `Нужен геймпасс ровно на ${expectedPrice} R$. Как исправить — в инструкции:`,
      keyboard: Keyboard.builder()
        .urlButton({ label: "📖 ИНСТРУКЦИЯ", url: guideUrl })
        .row()
        .textButton({ label: "🔎 Уже исправил — проверить", payload: { command: "find_gp_recheck" }, color: "primary" })
        .row()
        .textButton({ label: "✏️ Поменять ник", payload: { command: "find_gp_start" }, color: "secondary" })
        .inline(),
    });
    return;
  }

  // Branch 3: exactly 1 price-match (VK = text confirmation, no photo)
  if (matches.length === 1) {
    const m = matches[0];
    await showResult({
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

  // Branch 4: 2–5 price-matches → text-button list.
  // 5 рядов пассов + ряд «Другой ник» = ровно 6 рядов (лимит VK) — страховка обязательна.
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
  await showResult({
    message:
      `У ${nick} нашёл несколько подходящих геймпассов.\n` +
      `Выбери тот, который хочешь продать:`,
    keyboard: enforceVkInlineKbLimits(kb.inline(), "VK/find-gp"),
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
    where: { userId: user.id, status: { in: VK_CHANGEABLE_ORDER_STATUSES } },
    orderBy: { createdAt: "desc" },
  });
  if (!order) {
    await ctx.reply("У тебя сейчас нет активного заказа.");
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
      // after: "start_direct" — после «Я вступил» продолжаем прямой заказ, а не
      // просим код ВБ (шов 2 гейта); маркер — для group_join, где payload нет.
      gateDirectPending.set(vkUserId, Date.now());
      await sendVkSubPrompt(ctx, null, undefined, "start_direct");
      return;
    }
  }

  const user = await (db as any).user.findUnique({
    where: { vkId: String(vkUserId) },
    select: { id: true, balance: true, bonusExpiresAt: true, rubleDiscount: true, robloxUsername: true },
  });
  const now = new Date();
  const rawBonus = user?.balance ?? 0;
  const bonusExpired = user?.bonusExpiresAt ? user.bonusExpiresAt <= now : false;
  const bonus = rawBonus > 0 && !bonusExpired ? rawBonus : 0;
  const rubleDiscount = user?.rubleDiscount ?? 0;
  const robloxNick = user?.robloxUsername;

  let lastOrderAmount: number | undefined;
  if (user?.id) {
    const lastOrder = await (db as any).wbOrder.findFirst({
      where: { userId: user.id, status: "COMPLETED", isDirectOrder: true },
      orderBy: { createdAt: "desc" },
      select: { amount: true },
    });
    if (lastOrder) lastOrderAmount = lastOrder.amount;
  }

  const notes: string[] = [];
  if (bonus > 0) notes.push(`🎁 Бонус ${bonus} R$ — добавится автоматически.`);
  if (rubleDiscount > 0) notes.push(`💰 Скидка ${rubleDiscount} ₽ на этот заказ.`);
  const nickNote = robloxNick ? `\n🎮 Ник: ${robloxNick}` : "";
  const notesBlock = notes.length > 0 ? "\n" + notes.join("\n") : "";

  setState(vkUserId, { type: "AWAITING_DIRECT_AMOUNT" });

  await ctx.reply({
    message: `${stepBar(1, "Выбери пак")}\n\n💎 Прямой заказ Robux${nickNote}${notesBlock}\n\nВыбери количество:`,
    keyboard: buildVkPackKb(bonus, rubleDiscount, lastOrderAmount),
  });
}

async function handleDirectAmountInput(ctx: MessageContext, vkUserId: number, text: string): Promise<void> {
  const num = parseInt(text.replace(/[\s,]/g, ""), 10);
  if (isNaN(num) || num < CUSTOM_MIN || num > CUSTOM_MAX) {
    const kb = Keyboard.builder();
    kb.textButton({ label: "◀️ К пакам", payload: { command: "start_direct" }, color: "secondary" });
    kb.textButton({ label: "❌ Отменить", payload: { command: "direct_cancel" }, color: "negative" });
    await ctx.reply({
      message: `⚠️ Введи число от ${CUSTOM_MIN} до ${CUSTOM_MAX.toLocaleString("ru-RU")}.\n\nНапример: 500`,
      keyboard: kb.inline(),
    });
    return;
  }
  await handleDirectPackSelect(ctx, vkUserId, num);
}

async function handleDirectPackSelect(ctx: MessageContext, vkUserId: number, amount: number): Promise<void> {
  const user = await (db as any).user.findUnique({
    where: { vkId: String(vkUserId) },
    select: { balance: true, bonusExpiresAt: true, rubleDiscount: true },
  });
  const rawBonus = user?.balance ?? 0;
  const bonusExpired = user?.bonusExpiresAt ? user.bonusExpiresAt <= new Date() : false;
  const bonus = rawBonus > 0 && !bonusExpired && amount >= BONUS_MIN_PACK ? rawBonus : 0;
  const totalAmount = amount + bonus;
  const passPrice = Math.ceil(totalAmount / 0.7);
  const baseRublePrice = directPrice(amount);
  const discount = user?.rubleDiscount ?? 0;
  const rublePrice = discount > 0 ? Math.max(0, baseRublePrice - discount) : baseRublePrice;

  const flowData = { amount, totalAmount, bonus, rubleDiscount: discount, rublePrice };

  if (bonus > 0) {
    setState(vkUserId, { type: "AWAITING_DIRECT_CONFIRM", ...flowData });

    const bonusSection =
      `💎 Запрос:          ${amount} R$\n` +
      `🎁 Твой бонус:     +${bonus} R$\n` +
      `─────────────────\n` +
      `📦 Итого получишь:  ${totalAmount} R$\n`;
    const discountLine = discount > 0 ? `💰 Скидка:          −${discount} ₽\n` : "";
    const rateLine = amount >= 1000 ? `📊 Курс:            ${customRate(amount)} ₽/R$\n` : "";

    const kb = Keyboard.builder();
    kb.textButton({ label: `✅ С бонусом (+${bonus} R$)`, payload: { command: "direct_confirm" }, color: "positive" });
    kb.row();
    kb.textButton({ label: "✅ Без бонуса", payload: { command: "direct_confirm_nb" }, color: "secondary" });
    kb.row();
    kb.textButton({ label: "◀️ Назад", payload: { command: "direct_back" }, color: "secondary" });
    kb.textButton({ label: "❌ Отменить", payload: { command: "direct_cancel" }, color: "negative" });

    await ctx.reply({
      message:
        `${stepBar(2, "Подтверждение")}\n\n` +
        bonusSection + rateLine + discountLine +
        `💰 К оплате:       ${fmtRub(rublePrice)}\n` +
        `📌 Цена геймпасса:  ${passPrice} R$`,
      keyboard: kb.inline(),
    });
  } else {
    setState(vkUserId, { type: "AWAITING_DIRECT_CONFIRM", ...flowData });
    const kb = Keyboard.builder();
    kb.textButton({ label: "✅ Подтвердить", payload: { command: "direct_confirm" }, color: "positive" });
    kb.row();
    kb.textButton({ label: "◀️ Назад", payload: { command: "direct_back" }, color: "secondary" });
    kb.textButton({ label: "❌ Отменить", payload: { command: "direct_cancel" }, color: "negative" });
    const discountLine2 = discount > 0 ? `💰 Скидка:          −${discount} ₽\n` : "";
    const rateLine2 = amount >= 1000 ? `📊 Курс:            ${customRate(amount)} ₽/R$\n` : "";
    await ctx.reply({
      message:
        `${stepBar(2, "Подтверждение")}\n\n` +
        `📦 Получишь:       ${totalAmount} R$\n` +
        rateLine2 + discountLine2 +
        `💰 К оплате:       ${fmtRub(rublePrice)}\n` +
        `📌 Цена геймпасса:  ${passPrice} R$`,
      keyboard: kb.inline(),
    });
  }
}

async function handleDirectConfirm(ctx: MessageContext, vkUserId: number, skipBonus = false): Promise<void> {
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

  const { amount, bonus: stateBonus, rubleDiscount, rublePrice } = state;
  const bonus = skipBonus ? 0 : stateBonus;
  const totalAmount = amount + bonus;
  const recalcedRublePrice = skipBonus
    ? Math.max(0, directPrice(amount) - rubleDiscount)
    : rublePrice;

  const flowData = { amount, totalAmount, bonus, rubleDiscount, rublePrice: recalcedRublePrice };
  setState(vkUserId, { type: "AWAITING_DIRECT_NICK", ...flowData });
  await showVkNickStep(ctx, vkUserId, flowData);
}

async function showVkNickStep(ctx: MessageContext, vkUserId: number, flowData: { amount: number; totalAmount: number; bonus: number; rubleDiscount: number; rublePrice: number }): Promise<void> {
  const user = await (db as any).user.findUnique({
    where: { vkId: String(vkUserId) }, select: { robloxUsername: true },
  });
  const savedNick = user?.robloxUsername;

  if (savedNick) {
    setState(vkUserId, { type: "AWAITING_DIRECT_NICK", ...flowData });
    const kb = Keyboard.builder();
    kb.textButton({ label: `✅ ${savedNick}`, payload: { command: "direct_nick_ok", nick: savedNick }, color: "positive" });
    kb.row();
    kb.textButton({ label: "✏️ Другой ник", payload: { command: "direct_nick_new" }, color: "secondary" });
    kb.row();
    kb.textButton({ label: "◀️ Назад", payload: { command: "direct_back" }, color: "secondary" });
    kb.textButton({ label: "❌ Отменить", payload: { command: "direct_cancel" }, color: "negative" });
    await ctx.reply({
      message: `${stepBar(3, "Ник Roblox")}\n\nТвой сохранённый ник: ${savedNick}\n\nПродолжить с ним?`,
      keyboard: kb.inline(),
    });
  } else {
    setState(vkUserId, { type: "AWAITING_DIRECT_NICK_INPUT", ...flowData });
    const kb = Keyboard.builder();
    kb.textButton({ label: "◀️ Назад", payload: { command: "direct_back" }, color: "secondary" });
    kb.textButton({ label: "❌ Отменить", payload: { command: "direct_cancel" }, color: "negative" });
    await ctx.reply({
      message: `${stepBar(3, "Ник Roblox")}\n\nВведи свой ник Roblox — напиши его в чат:`,
      keyboard: kb.inline(),
    });
  }
}

async function handleVkDirectNickResolved(ctx: MessageContext, vkUserId: number, nick: string): Promise<void> {
  const state = getState(vkUserId);
  if (!state || (state.type !== "AWAITING_DIRECT_NICK" && state.type !== "AWAITING_DIRECT_NICK_INPUT")) return;

  const passPrice = Math.ceil(state.totalAmount / 0.7);
  const flowData = { amount: state.amount, totalAmount: state.totalAmount, bonus: state.bonus, rubleDiscount: state.rubleDiscount, rublePrice: state.rublePrice };

  setState(vkUserId, { type: "AWAITING_DIRECT_GAMEPASS", robloxUsername: nick, ...flowData });

  const searchingMsg: any = await ctx.reply(`🔎 Ищу геймпассы у ${nick}…`);
  const showResult = buildVkEditInPlace(ctx, vkUserId, searchingMsg);
  let result: GamepassSearchOutcome;
  try {
    result = await searchGamepassesByNick(nick, passPrice);
  } catch (err: any) {
    // Инфра-сбой (Roblox/мост) ≠ «ника нет» — честный ответ + возврат к вводу
    // ника, как в WB-коридоре. Раньше исключение улетало в глобальный catch
    // («⚠️ Произошла ошибка») и юзер оставался в AWAITING_DIRECT_GAMEPASS-тупике.
    console.error("[VK/direct] searchGamepassesByNick failed:", err?.message ?? err);
    setState(vkUserId, { type: "AWAITING_DIRECT_NICK_INPUT", ...flowData });
    const kb = Keyboard.builder();
    kb.textButton({ label: "◀️ Назад", payload: { command: "direct_back" }, color: "secondary" });
    kb.textButton({ label: "❌ Отменить", payload: { command: "direct_cancel" }, color: "negative" });
    await showResult({
      message: "⚠️ Поиск по нику временно недоступен — не получилось связаться с Roblox.\n\nПодожди минуту и пришли ник ещё раз:",
      keyboard: kb.inline(),
    });
    return;
  }

  if (result.status !== "user_not_found") {
    // Nick confirmed by Roblox (userId resolved) — only now persist it.
    await (db as any).user.updateMany({ where: { vkId: String(vkUserId) }, data: { robloxUsername: nick } });
  }

  if (result.status === "user_not_found") {
    setState(vkUserId, { type: "AWAITING_DIRECT_NICK_INPUT", amount: state.amount, totalAmount: state.totalAmount, bonus: state.bonus, rubleDiscount: state.rubleDiscount, rublePrice: state.rublePrice });
    const kb = Keyboard.builder();
    kb.textButton({ label: "◀️ Назад", payload: { command: "direct_back" }, color: "secondary" });
    kb.textButton({ label: "❌ Отменить", payload: { command: "direct_cancel" }, color: "negative" });
    await showResult({ message: `❌ Пользователь ${nick} не найден на Roblox.\n\nПроверь написание и отправь ещё раз:`, keyboard: kb.inline() });
    return;
  }
  if (result.status === "no_gamepasses") {
    setState(vkUserId, { type: "AWAITING_DIRECT_NICK_INPUT", amount: state.amount, totalAmount: state.totalAmount, bonus: state.bonus, rubleDiscount: state.rubleDiscount, rublePrice: state.rublePrice });
    const kb = Keyboard.builder();
    kb.urlButton({ label: "📖 Инструкция", url: "https://robloxbank.ru/guide?source=direct" });
    kb.row();
    kb.textButton({ label: "✏️ Другой ник", payload: { command: "direct_nick_new" }, color: "secondary" });
    kb.row();
    kb.textButton({ label: "◀️ Назад", payload: { command: "direct_back" }, color: "secondary" });
    kb.textButton({ label: "❌ Отменить", payload: { command: "direct_cancel" }, color: "negative" });
    await showResult({ message: `⚠️ У ${nick} нет геймпассов на продаже.\n\nСоздай геймпасс по инструкции и отправь ник ещё раз:`, keyboard: kb.inline() });
    return;
  }

  const gpHeader = stepBar(4, "Геймпасс");
  const { matches, nonMatches } = result;

  // Auto-skip: exactly 1 price-matched gamepass → go straight to summary
  if (matches.length === 1 && nonMatches.length === 0) {
    const g = matches[0];
    const gpDetails = await getGamepassDetails(String(g.gamepassId));
    if (gpDetails) {
      const gamepassUrl = `https://www.roblox.com/game-pass/${g.gamepassId}`;
      setState(vkUserId, {
        type: "AWAITING_DIRECT_SUMMARY",
        robloxUsername: nick,
        gamepassId: String(g.gamepassId), gamepassUrl, gamepassName: gpDetails.name,
        gamepassRobux: gpDetails.price,
        amount: state.amount, totalAmount: state.totalAmount, bonus: state.bonus,
        rubleDiscount: state.rubleDiscount, rublePrice: state.rublePrice,
      });
      await showVkSummary(ctx, state, nick, String(g.gamepassId), gpDetails.price, gpDetails.name, showResult);
      return;
    }
  }

  // ⚠️ Лимиты VK inline-клавиатур: ≤10 кнопок / ≤6 рядов / ≤5 в ряду.
  // До 5 рядов пассов + ОДИН сервисный ряд из трёх кнопок = 6 рядов, 8 кнопок.
  // Раньше сервисные кнопки занимали два ряда → 7 рядов → VK отвергал сообщение,
  // и прямой заказ падал у любого клиента с ≥5 геймпассами (кейс ypa_0982).
  const kb = Keyboard.builder();
  const listIsWrongPriceOnly = matches.length === 0 && nonMatches.length > 0;
  const shownPasses = listIsWrongPriceOnly
    ? nonMatches.slice(0, MAX_PICK_BUTTONS)
    : [...matches, ...nonMatches.slice(0, 3)].slice(0, MAX_PICK_BUTTONS);

  for (const g of shownPasses) {
    const prefix = g.isPriceMatch ? "✅ " : "";
    kb.textButton({ label: `${prefix}${g.robux} R$ · ${g.name.slice(0, 16)}`, payload: { command: "direct_gp_pick", passId: String(g.gamepassId) }, color: g.isPriceMatch ? "positive" : "primary" });
    kb.row();
  }
  kb.textButton({ label: "✏️ Другой ник", payload: { command: "direct_nick_new" }, color: "secondary" });
  kb.textButton({ label: "◀️ Назад", payload: { command: "direct_back" }, color: "secondary" });
  kb.textButton({ label: "❌ Отменить", payload: { command: "direct_cancel" }, color: "negative" });

  const listMessage = listIsWrongPriceOnly
    ? `${gpHeader}\n\n⚠️ Нет геймпассов с нужной ценой ${passPrice} R$.\n\nВот что нашлось у ${nick} — выбери подходящий или создай новый с правильной ценой:`
    : `${gpHeader}\n\n🎫 Геймпассы ${nick} — выбери для заказа:`;

  try {
    await showResult({
      message: listMessage,
      keyboard: enforceVkInlineKbLimits(kb.inline(), "VK/direct"),
    });
  } catch (err: any) {
    // Отправка списка не прошла (VK отверг клавиатуру и т.п.) — не бросаем юзера
    // в AWAITING_DIRECT_GAMEPASS-тупике «Используй кнопки выше».
    console.error("[VK/direct] список геймпассов не отправился:", err?.message ?? err);
    setState(vkUserId, { type: "AWAITING_DIRECT_NICK_INPUT", ...flowData });
    await ctx.reply("⚠️ Не получилось показать список геймпассов. Пришли ник ещё раз:");
  }
}

async function showVkSummary(ctx: MessageContext, flowState: { totalAmount: number; bonus: number; rubleDiscount: number; rublePrice: number }, nick: string, gamepassId: string, gpRobux: number, gpName: string, edit?: (p: { message: string; keyboard?: unknown }) => Promise<void>): Promise<void> {
  const bonusLine = flowState.bonus > 0 ? `\n🎁 Бонус:       +${flowState.bonus} R$` : "";
  const discountLine = flowState.rubleDiscount > 0 ? `\n💰 Скидка:      −${flowState.rubleDiscount} ₽` : "";

  let mpLine = "";
  try {
    const info = await getGamepassProductInfo(gamepassId);
    if (info && info.priceInRobux !== info.userBasePriceInRobux) {
      mpLine = `\n⚠️ Managed pricing ВКЛЮЧЁН — выкуп может задержаться`;
    } else if (info) {
      mpLine = `\n✅ Managed pricing отключён`;
    }
  } catch { /* non-critical */ }

  // П5: клиент выбрал пасс с ценой ≠ расчётной — предупреждаем его,
  // а не только админскую карточку (зеркально TG showSummary).
  const expectedGp = Math.ceil(flowState.totalAmount / 0.7);
  const wrongPriceLine = expectedGp > 0 && Math.abs(gpRobux - expectedGp) > 2
    ? `\n\n⚠️ Цена геймпасса не совпадает: этот пасс стоит ${gpRobux} R$, ` +
      `а для ${flowState.totalAmount} R$ нужен пасс на ${expectedGp} R$. ` +
      `Лучше создать новый с правильной ценой — иначе выкуп задержится.`
    : "";

  const summaryText =
    `${stepBar(5, "Итого")}\n\n` +
    `📦 Получишь:    ${flowState.totalAmount} R$${bonusLine}\n` +
    `🎮 Ник:         ${nick}\n` +
    `🎫 Геймпасс:    ${gpRobux} R$ · "${gpName.slice(0, 30)}"${discountLine}\n` +
    `💰 К оплате:    ${fmtRub(flowState.rublePrice)}` +
    mpLine + wrongPriceLine;

  const kb = Keyboard.builder();
  kb.textButton({ label: "✅ Оформить", payload: { command: "direct_submit" }, color: "positive" });
  kb.row();
  kb.textButton({ label: "◀️ Назад", payload: { command: "direct_back" }, color: "secondary" });
  kb.textButton({ label: "❌ Отменить", payload: { command: "direct_cancel" }, color: "negative" });

  // Автопропуск после текстового ввода ника: итог редактируется в пузырь
  // «Ищу…», чтобы ответ был виден без пролистывания (edit-in-place, пункт F).
  if (edit) await edit({ message: summaryText, keyboard: kb.inline() });
  else await ctx.reply({ message: summaryText, keyboard: kb.inline() });
}

async function handleVkDirectGpPick(ctx: MessageContext, vkUserId: number, passId: string): Promise<void> {
  const state = getState(vkUserId);
  if (!state || state.type !== "AWAITING_DIRECT_GAMEPASS") {
    await ctx.reply("⏳ Сессия истекла. Начни заново.");
    return;
  }

  const gpDetails = await getGamepassDetails(passId);
  if (!gpDetails) {
    await ctx.reply("❌ Геймпасс не найден. Попробуй другой.");
    return;
  }

  const gamepassUrl = `https://www.roblox.com/game-pass/${passId}`;
  setState(vkUserId, {
    type: "AWAITING_DIRECT_SUMMARY",
    robloxUsername: state.robloxUsername,
    gamepassId: passId,
    gamepassUrl,
    gamepassName: gpDetails.name,
    gamepassRobux: gpDetails.price,
    amount: state.amount, totalAmount: state.totalAmount, bonus: state.bonus,
    rubleDiscount: state.rubleDiscount, rublePrice: state.rublePrice,
  });

  await showVkSummary(ctx, state, state.robloxUsername, passId, gpDetails.price, gpDetails.name);
}

async function handleVkDirectSubmit(ctx: MessageContext, vkUserId: number): Promise<void> {
  const state = getState(vkUserId);
  if (!state || state.type !== "AWAITING_DIRECT_SUMMARY") {
    await ctx.reply("⏳ Сессия истекла. Начни заново.");
    return;
  }
  clearState(vkUserId);

  let user = await (db as any).user.findUnique({ where: { vkId: String(vkUserId) } });
  if (!user) {
    const name = await vkGetName(vkUserId);
    user = await (db as any).user.create({ data: { vkId: String(vkUserId), name } });
  }

  // Guard: one active intent at a time
  const existingIntent = await (db as any).directIntent.findFirst({
    where: { userId: user.id, status: "PENDING" },
  });
  if (existingIntent) {
    const kb = Keyboard.builder();
    kb.textButton({ label: "❌ Отменить заявку", payload: { command: "direct_cancel_intent", intentId: existingIntent.id }, color: "negative" });
    await ctx.reply({ message: `⏳ У тебя уже есть активная заявка на ${existingIntent.totalAmount} R$.\n\nДождись реквизитов от менеджера или отмени заявку.`, keyboard: kb.inline() });
    return;
  }
  const existingOrder = await (db as any).wbOrder.findFirst({
    where: { userId: user.id, status: { in: ["AWAITING_PAYMENT", "PAYMENT_PENDING"] } },
  });
  if (existingOrder) {
    await ctx.reply({
      message: `⏳ У тебя уже есть активный заказ на ${existingOrder.amount} R$.\n\nДождись реквизитов от менеджера, а затем оформи новый.`,
      keyboard: vkFaqKb(),
    });
    return;
  }

  let intent: any;
  try {
    intent = await (db as any).directIntent.create({
      data: {
        userId:        user.id,
        amount:        state.amount,
        bonus:         state.bonus,
        totalAmount:   state.totalAmount,
        rubleDiscount: state.rubleDiscount,
        rublePrice:    state.rublePrice,
        robloxUsername: state.robloxUsername,
        gamepassId:    state.gamepassId,
        gamepassUrl:   state.gamepassUrl,
        platform:      "VK",
      },
    });
  } catch (err) {
    console.error("[VK] DirectIntent create error:", err);
    await ctx.reply({ message: "❌ Не удалось оформить заявку. Попробуй снова.", keyboard: vkFaqKb() });
    return;
  }

  const vkName = user.name ?? await vkGetName(vkUserId);
  const prevOrdersCount = await (db as any).wbOrder.count({
    where: { userId: user.id, status: "COMPLETED" },
  });

  try {
    await sendAdminIntentCard({
      intentId:            intent.id,
      userId:              user.id,
      amount:              state.amount,
      bonus:               state.bonus,
      totalAmount:         state.totalAmount,
      rublePrice:          state.rublePrice,
      robloxUsername:       state.robloxUsername,
      gamepassUrl:         state.gamepassUrl,
      gamepassName:        state.gamepassName,
      gamepassRobux:       state.gamepassRobux,
      userDisplay:         `${vkUserDisplay(vkName, vkUserId)} (VK ID: ${vkUserId})`,
      platform:            "VK",
      createdAt:           intent.createdAt,
      previousOrdersCount: prevOrdersCount,
    });
  } catch (err) {
    console.error("[VK] sendAdminIntentCard failed:", err);
  }

  const kb = Keyboard.builder();
  kb.textButton({ label: "❌ Отменить заявку", payload: { command: "direct_cancel_intent", intentId: intent.id }, color: "negative" });
  await ctx.reply({
    message:
      `✅ Заявка отправлена!\n\n` +
      `📦 ${state.totalAmount} R$ → ${state.robloxUsername}\n` +
      `💰 К оплате: ${fmtRub(state.rublePrice)}\n\n` +
      `⏱ Менеджер пришлёт реквизиты — обычно в течение 5 минут.\nОжидай сообщения 👇`,
    keyboard: kb.inline(),
  });

  console.log(`[VK] DirectIntent created: ${intent.id} vkUserId=${vkUserId} amount=${state.totalAmount}`);
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
    // Extraction failed. If the user genuinely has a review pending, don't trap
    // them in a "resend" loop — alert admins for manual handling and reassure.
    if (await hasPendingProofPhoto(vkUserId)) {
      await ctx.reply(
        "📸 Скриншот получили, но не смогли обработать его автоматически.\n" +
        "Менеджер проверит вручную — это займёт немного времени. 🙌"
      );
      try {
        for (const adminId of ADMIN_IDS) {
          await tgSend(
            adminId,
            `⚠️ <b>VK отзыв: не удалось извлечь фото — нужна ручная проверка</b>\n` +
            `VK ID: <code>${vkUserId}</code> (<a href="https://vk.com/id${vkUserId}">vk.com/id${vkUserId}</a>)\n\n` +
            `Пользователь прислал скрин отзыва, авто-извлечение URL не сработало. Проверь диалог и начисли бонус вручную.`
          );
        }
      } catch (err) {
        console.error("[VK] admin notify for unextractable review photo failed:", err);
      }
      return;
    }
    if (knownOrderId) {
      await ctx.reply(
        "📸 Оставь отзыв на Wildberries с текстом и фото, пришли скриншот в виде фотографии (не файлом).\n" +
        "После проверки получишь +100 R$ (действует на любой номинал)."
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
      "📸 Получили твой скриншот, но не смогли найти твой заказ в базе.\n\n" +
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

  // Resolve the order to attach this review to. П1: eligibility ищет заказ и по
  // кодам юзера (кросс-платформенный заказ может висеть на другом User-ряду).
  let orderId = knownOrderId;
  if (!orderId) {
    const elig = await resolveReviewEligibility(user);

    if (elig.kind !== "eligible") {
      console.log(`[VK] handleReviewScreenshot: not eligible (${elig.kind}) for userId=${user.id} vkId=${vkUserId}`);
      if (elig.kind === "already_granted") {
        await ctx.reply({
          message: reviewIneligibleMessage(elig, { html: false }),
          keyboard: Keyboard.builder()
            .textButton({ label: "💎 Купить напрямую", payload: { command: "start_direct" }, color: "positive" })
            .inline(),
        });
      } else if (elig.kind === "active_order") {
        await ctx.reply(reviewIneligibleMessage(elig, { html: false }));
      } else {
        await ctx.reply(
          "📸 У тебя сейчас нет выполненных заявок, ожидающих отзыва.\n\n" +
          "Если у тебя возникла проблема или вопрос — напиши сюда, ответим здесь. Или в Telegram: https://t.me/RobloxBank_PA"
        );
      }
      return;
    }
    orderId = elig.orderId;
  }

  clearState(vkUserId);

  await ctx.reply("✅ Отзыв получен! Менеджер проверит его в ближайшее время и начислит бонус 100 R$ (действует на любой номинал).");

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

const VK_ACTIVE_STATUSES = ["AWAITING_PAYMENT", "PAYMENT_PENDING", "AWAITING_GAMEPASS", "PENDING", "IN_PROGRESS"];

async function findRelevantOrder(userId: string): Promise<any | null> {
  const active = await (db as any).wbOrder.findFirst({
    where: { userId, status: { in: VK_ACTIVE_STATUSES } },
    orderBy: { createdAt: "desc" },
  });
  if (active) return active;
  const completed = await (db as any).wbOrder.findFirst({
    where: { userId, status: "COMPLETED" },
    orderBy: { createdAt: "desc" },
  });
  if (completed) return completed;
  return (db as any).wbOrder.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
}

const VK_STATUS_LABEL: Record<string, string> = {
  AWAITING_PAYMENT:  "⏳ Ожидаем реквизиты",
  PAYMENT_PENDING:   "💳 Ожидаем оплату",
  AWAITING_GAMEPASS: "⌛ Ожидаем геймпасс",
  PENDING:           "⏳ В обработке",
  IN_PROGRESS:       "🔧 В работе",
  COMPLETED:         "✅ Выполнен",
  REJECTED:          "❌ Отклонён",
};

// Statuses where the user may still re-pick their nick / gamepass (not yet bought).
const VK_CHANGEABLE_ORDER_STATUSES = ["AWAITING_GAMEPASS", "PENDING", "IN_PROGRESS", "REJECTED"];

// Ф7 (2026-07-12): нейтральная нота вместо прежнего алармистского баннера
// «Roblox ввёл ограничения… 1–3 дня». Зеркало — bots/tg/handlers.ts.
const BUYOUT_ETA_NOTE = `\n\n⏱ Выкупаем в течение суток — обычно быстрее. Иногда чуть дольше — уведомим сразу, как выкупим.`;

/**
 * Plain-text VK mirror of the TG `pendingStage` — gives a PENDING order a sense
 * of forward motion from elapsed time so the status visibly "moves" even with no
 * real change. Stays within queued/checking/preparing semantics — never claims a
 * manager has actually started (that's the real IN_PROGRESS).
 */
function vkPendingStage(createdAt: Date | string): { label: string; note: string } {
  const mins = (Date.now() - new Date(createdAt).getTime()) / 60_000;
  if (mins < 3)   return { label: "🆕 Заказ создан",             note: "Только что приняли — ставим в очередь на выкуп." };
  if (mins < 12)  return { label: "🔍 Проверяем геймпасс",      note: "Сверяем геймпасс и цену перед выкупом." };
  if (mins < 30)  return { label: "📋 Поставлен в очередь",     note: "Заказ в очереди — скоро возьмём в работу." };
  if (mins < 90)  return { label: "💼 Готовим к выкупу",        note: "Менеджер вот-вот возьмёт твой геймпасс в работу." };
  if (mins < 360) return { label: "⏳ В очереди на выкуп",      note: "Очередь сегодня больше обычного — выкупим в течение суток, уведомим сразу 🙏" };
  return            { label: "⏳ В очереди на выкуп",        note: "Заказ в очереди — почти всегда выкупаем в течение суток. Уведомим сразу, как выкупим 🙏" };
}

/** Russian day pluralization: 1 день · 2 дня · 5 дней. */
function vkPluralDays(n: number): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return "дней";
  if (b > 1 && b < 5) return "дня";
  if (b === 1) return "день";
  return "дней";
}

/**
 * Countdown for Roblox's pending-funds hold once we've bought the gamepass
 * (plain-text VK mirror of the TG `robuxCountdown`). `completedAt` ≈
 * WbOrder.updatedAt for a COMPLETED order — Roblox releases pending Robux in
 * ~5 days (up to 7). Answers the recurring "а сколько ждать?".
 */
function vkRobuxCountdown(completedAt: Date | string): string {
  // Ф6.3: конкретная дата (completedAt+5д) вместо абстрактных «5–7 дней».
  const unlock = robuxUnlockDate(new Date(completedAt));
  const left = Math.ceil((unlock.getTime() - Date.now()) / 86_400_000);
  if (left >= 2) return `⏳ Робуксы станут доступны ~ ${fmtDateRu(unlock)} (через ${left} ${vkPluralDays(left)}).`;
  if (left === 1) return `⏳ Уже завтра (${fmtDateRu(unlock)}) робуксы должны стать доступны.`;
  return `⏳ Робуксы вот-вот появятся. Roblox иногда держит пендинг до 7 дней — если их пока нет, подожди ещё чуть-чуть.`;
}

/**
 * Buyer "mini profile" / home hub (VK mirror of TG `buildBuyerMenu`). The place
 * a customer lands once the WB flow is done, so the bot becomes the habit for
 * the next (direct) purchase. Loyalty-aware; fail-open.
 */
async function sendVkBuyerMenu(ctx: MessageContext, vkUserId: number): Promise<void> {
  let user: any = null;
  let activeOrders: any[] = [];
  let lastCompleted: any = null;
  let status = { isReturning: false, orderCount: 0 };
  try {
    user = await (db as any).user.findUnique({ where: { vkId: String(vkUserId) } });
    status = await getCustomerStatus(String(vkUserId), "VK");
    if (user) {
      activeOrders = await (db as any).wbOrder.findMany({
        where: { userId: user.id, status: { in: VK_ACTIVE_STATUSES } },
        orderBy: { createdAt: "desc" },
        take: 5,
      });
      lastCompleted = await (db as any).wbOrder.findFirst({
        where: { userId: user.id, status: "COMPLETED" },
        orderBy: { createdAt: "desc" },
      });
    }
  } catch (err) {
    console.error("[VK] sendVkBuyerMenu lookup failed:", err);
  }

  const firstName = await vkGetName(vkUserId);
  const balance = user?.balance ?? 0;
  const bonusExpiresAt = user?.bonusExpiresAt ? new Date(user.bonusExpiresAt) : null;
  const bonusExpired = bonusExpiresAt ? bonusExpiresAt <= new Date() : false;
  const effectiveBonus = balance > 0 && !bonusExpired ? balance : 0;
  const rubleDiscount = user?.rubleDiscount ?? 0;
  const robloxNick = user?.robloxUsername;
  const tier = status.orderCount >= 5 ? "👑 VIP-клиент"
             : status.isReturning   ? "💛 Постоянный клиент"
             : "🌱 Новый клиент";

  const heading = robloxNick
    ? `🎮 RobloxBank · ${robloxNick}`
    : `👤 Твоё меню${firstName ? `, ${firstName}` : ""} · RobloxBank`;

  const perks: string[] = [];
  if (effectiveBonus > 0) {
    const expStr = bonusExpiresAt!.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
    perks.push(`🎁 ${effectiveBonus} R$ (до ${expStr})`);
  }
  if (rubleDiscount > 0) perks.push(`💰 Скидка ${rubleDiscount} ₽`);
  const perksStr = perks.length > 0 ? ` · ${perks.join(" · ")}` : "";

  const lines: string[] = [heading, ""];
  const oc = status.orderCount;
  lines.push(`${tier} · ${oc > 0 ? `${oc} ${oc === 1 ? "заказ" : oc < 5 ? "заказа" : "заказов"}` : "0 заказов"}${perksStr}`);

  if (activeOrders.length > 0) {
    lines.push("");
    lines.push("── Активные заказы ──");
    for (const o of activeOrders) {
      const statusLbl = VK_STATUS_LABEL[o.status] ?? o.status;
      // Идентификатор для клиента = сумма+статус, без внутреннего номера (C2).
      lines.push(`📦 ${o.amount} R$ · ${statusLbl}`);
    }
  }

  if (lastCompleted) {
    lines.push("");
    const dt = new Date(lastCompleted.createdAt).toLocaleDateString("ru-RU");
    lines.push(`✅ Последний: ${lastCompleted.amount} R$ · ${dt}`);
  }

  lines.push("");
  lines.push(`💎 Заказать Robux напрямую — без карты WB, быстрее и выгоднее 👇`);

  // Инструкция показывается только пока есть активный заказ, которому она нужна.
  // Все заказы выполнены → никакого WB, только прямой заказ (решение владельца).
  const firstActiveWb = activeOrders.find(o => o.wbCode && !String(o.wbCode).startsWith("DIR-") && !o.isDirectOrder);
  const firstActiveDirect = activeOrders.find(o => o.isDirectOrder || String(o.wbCode).startsWith("DIR-"));
  const guideUrl = firstActiveWb
    ? `https://robloxbank.ru/guide?source=wb&skip=1&code=${firstActiveWb.wbCode}`
    : firstActiveDirect
    ? "https://robloxbank.ru/guide?source=direct"
    : null;

  const kb = Keyboard.builder();
  if (robloxNick) {
    kb.textButton({ label: `💎 Ещё на ${robloxNick}`, payload: { command: "start_direct" }, color: "positive" }).row();
  } else {
    kb.textButton({ label: "💎 Купить Robux напрямую", payload: { command: "start_direct" }, color: "positive" }).row();
  }
  if (activeOrders.length > 0) kb.textButton({ label: "📦 Мой заказ", payload: { command: "status" }, color: "primary" }).row();
  if (guideUrl) kb.urlButton({ label: "📖 Инструкция", url: guideUrl }).row();
  const relevantOrder = activeOrders[0] ?? lastCompleted;
  if (relevantOrder && orderAgeMsFromOrder(relevantOrder) < SUPPORT_COOLDOWN_MS) {
    kb.textButton({ label: "❓ Частые вопросы", payload: { command: "faq" }, color: "secondary" });
  } else {
    kb.textButton({ label: "💬 Поддержка", payload: { command: "support", context: "menu" }, color: "secondary" });
  }

  await ctx.reply({ message: lines.join("\n"), keyboard: kb.inline() });

  // Separate nick edit button
  const nickKb = Keyboard.builder();
  if (robloxNick) {
    nickKb.textButton({ label: `✏️ Ник: ${robloxNick.slice(0, 18)}`, payload: { command: "edit_nick" }, color: "secondary" });
  } else {
    nickKb.textButton({ label: "🎮 Привязать ник Roblox", payload: { command: "edit_nick" }, color: "secondary" });
  }
  await ctx.reply({ message: "⚙️ Настройки:", keyboard: nickKb.inline() });
}

async function handleIdleMessage(
  ctx: MessageContext,
  vkUserId: number,
  text: string
): Promise<void> {
  const lower = text.toLowerCase();

  // ── PRIORITY 0: Subscription gate for idle messages ────────────────────
  // Runs before loyalty/state logic. Fail-open: if the VK API is down,
  // isVkSubscribed returns true and the user is not blocked.
  //
  // Шов 1 гейта (PLAN +5.D): валидный WB-код активируем ДО гейта — внутри
  // handleRefActivation свой гейт с ref в payload, после «Я вступил» активация
  // продолжается сама. Раньше idle-гейт съедал код, и после подписки бот просил
  // «отправь код» заново. Остальной текст стэшим и переигрываем после подписки.
  const trimmedIdle = text.trim();
  const looksLikeWbCode = /^[A-Za-z0-9]{7}$/.test(trimmedIdle) && /[A-Za-z]/.test(trimmedIdle);
  if (looksLikeWbCode) {
    const preGateCode = await (db as any).wbCode.findFirst({
      where: { code: { equals: trimmedIdle.toUpperCase(), mode: "insensitive" } },
      select: { id: true },
    }).catch(() => null);
    if (preGateCode) {
      await handleRefActivation(ctx, vkUserId, trimmedIdle.toUpperCase());
      return;
    }
  }
  if (process.env.VK_GROUP_ID) {
    const subbed = await isVkSubscribed(ctx, vkUserId);
    if (!subbed) {
      if (trimmedIdle.length > 0) gateStash.set(vkUserId, { text: trimmedIdle, at: Date.now() });
      await sendVkSubPrompt(ctx, null);
      return;
    }
  }

  // ── PRIORITY 1: Direct WB code entry (7 alphanumeric chars, at least one letter) ──
  if (looksLikeWbCode) {
    // Код с валидным lookup обработан до гейта; сюда доходит только не-найденный
    // 7-символьник — возможно, это ник Roblox для активного заказа.
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

  // A customer with a LIVE order (placed / in payment / being processed) must
  // never get the generic idle/upsell greeting — that reads as "the bot forgot my
  // order" and shows stale info. Surface their real order status for ANY message.
  // Bug fix (order 5Q8V6LJ): only AWAITING_GAMEPASS/REJECTED were treated as
  // active here (via tryRestoreState), so a website one-tap order (PENDING) left
  // the client with a «рады видеть снова, покупай напрямую» upsell instead.
  let hasLiveOrder = false;
  try {
    const liveU = await (db as any).user.findUnique({ where: { vkId: String(vkUserId) }, select: { id: true } });
    if (liveU) {
      const liveOrder = await (db as any).wbOrder.findFirst({
        where: { userId: liveU.id, status: { in: ["AWAITING_PAYMENT", "PAYMENT_PENDING", "PENDING", "IN_PROGRESS"] } },
        select: { id: true },
      });
      hasLiveOrder = !!liveOrder;
    }
  } catch { /* fail-open: fall through to the normal greeting */ }

  // "статус" keyword (also triggered via payload routing in handleMessage) → show last order in rich format
  if (lower.includes("статус") || lower.includes("заявк") || lower.includes("заказ") || hasLiveOrder) {
    const user = await (db as any).user.findUnique({ where: { vkId: String(vkUserId) } });
    if (!user) {
      await ctx.reply(
        "У тебя пока нет заявок.\n\n" +
        "Есть код с WB-карты? Напиши его прямо сюда — и мы всё оформим.\n" +
        "Нужна помощь? Напиши прямо сюда — ответим здесь 👇 Если удобнее в Telegram: https://t.me/RobloxBank_PA"
      );
      return;
    }

    const order = await findRelevantOrder(user.id);

    if (!order) {
      await ctx.reply("У тебя пока нет заказов.\n\nЕсть код с WB-карты? Напиши его прямо сюда.\nНужна помощь? Напиши прямо сюда — ответим здесь 👇 Если удобнее в Telegram: https://t.me/RobloxBank_PA");
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
    const pendingAgeMs   = Date.now() - new Date(order.createdAt).getTime();
    const pendingOver120 = order.status === "PENDING" && pendingAgeMs > 120 * 60 * 1000;
    // PENDING shows a time-based pseudo-stage so it visibly "moves" over time.
    const stage     = order.status === "PENDING" ? vkPendingStage(order.createdAt) : null;
    const statusStr = stage ? stage.label : (label[order.status] ?? order.status);

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
        ? `\n\nПройди инструкцию, создай геймпасс — затем напиши свой ник в Roblox 🔎\nЦена геймпасса: ${passPrice} R$`
        : order.status === "PENDING"
        ? `\n\n💬 ${stage!.note}` + (pendingOver120 ? "\n💡 Ответы на частые вопросы — в кнопке ниже 👇" : "")
        : order.status === "IN_PROGRESS"
        ? "\n\n🔧 Менеджер уже работает над твоим заказом. Скоро всё будет готово!"
        : order.status === "COMPLETED"
        ? "\n\n" + vkRobuxCountdown(order.completedAt ?? order.updatedAt) +
          "\n💡 Они уже у тебя в Roblox — лежат в пендинге (заморожены самим Roblox). Проверить: roblox.com/transactions → строка Pending." +
          (reviewClaimed
            ? "\n\n🚀 Хочешь заказать ещё? Постоянным клиентам — прямое обслуживание без очереди по лучшему курсу! Пиши: https://t.me/RobloxBank_PA"
            : "\n\n🎁 Оставь отзыв на Wildberries с текстом и фото — получи +100 R$ бонусом (действует на любой номинал)!\nПришли скриншот отзыва сюда фотографией.")
        : order.status === "REJECTED" && order.isDirectOrder
        ? `\n\n${order.rejectionReason ? `Причина: ${order.rejectionReason}\n\n` : ""}Если хочешь — оформи новый заказ.`
        : order.status === "REJECTED"
        ? `\n\n${order.rejectionReason ? `Причина: ${order.rejectionReason}\n\n` : ""}Исправь геймпасс и нажми кнопку ниже — отправим на проверку заново.`
        : "";

    // Выполненный WB-заказ отработан: код и ссылка на геймпасс больше не нужны —
    // карточка уводит в прямые заказы (владелец: никакого WB после выкупа).
    const isCompletedCard = order.status === "COMPLETED";
    const gamepassLine = order.gamepassUrl && !isCompletedCard ? `🔗 Геймпасс: ${order.gamepassUrl}\n` : "";
    // Spell out that this nick is the recipient — so the user reads it as "robux
    // land HERE", not just some technical field.
    const nickLine = order.robloxUsername ? `🎮 Робуксы придут на ник: ${order.robloxUsername}\n` : "";

    // Status-specific rows first, then always a "👤 В моё меню" row so the user
    // never dead-ends on the status screen (mirror of the TG menuRow).
    const kb = Keyboard.builder();
    if (order.status === "AWAITING_PAYMENT" && order.isDirectOrder) {
      kb.textButton({ label: "❌ Отменить заказ", payload: { command: "user_cancel_direct", orderId: order.id }, color: "negative" }).row();
    } else if (order.status === "REJECTED" && order.isDirectOrder) {
      kb.textButton({ label: "💎 Заказать напрямую", payload: { command: "start_direct" }, color: "positive" }).row();
    } else if (order.status === "REJECTED") {
      kb.textButton({ label: "🔄 Исправить ссылку", payload: { command: "resubmit", code: order.wbCode }, color: "primary" }).row();
    } else if (order.status === "AWAITING_GAMEPASS") {
      kb.urlButton({ label: "📖 ИНСТРУКЦИЯ", url: `https://robloxbank.ru/guide?source=wb&skip=1&code=${order.wbCode}` }).row()
        .textButton({ label: "🔎 Ввести ник Roblox", payload: { command: "find_gp_start" }, color: "primary" }).row();
    } else if (order.status === "COMPLETED") {
      // Всегда уводим в прямой заказ. Кнопка отзыва — только пока бонус не начислен.
      kb.textButton({ label: "💎 Заказать напрямую", payload: { command: "start_direct" }, color: "positive" }).row();
      if (!reviewClaimed && !order.isDirectOrder) {
        kb.textButton({ label: "📸 Отзыв = +100 R$ бонус", payload: { command: "review_hint" }, color: "primary" }).row();
      }
    } else if ((order.status === "PENDING" || order.status === "IN_PROGRESS") && !order.isDirectOrder) {
      // "Передумал" — re-pick nick/gamepass while the order isn't bought yet.
      kb.textButton({ label: "⚠️ Ошибся с ником? Изменить заказ", payload: { command: "change_nick" }, color: "negative" }).row();
    }
    if (orderAgeMsFromOrder(order) < SUPPORT_COOLDOWN_MS) {
      kb.row().textButton({ label: "❓ Частые вопросы", payload: { command: "faq" }, color: "secondary" });
    } else {
      kb.row().textButton({ label: "💬 Нужна помощь?", payload: { command: "support", context: "status" }, color: "secondary" });
    }
    kb.row().textButton({ label: "👤 В моё меню", payload: { command: "menu" }, color: "secondary" });

    const vkShowEtaNote = order.status === "PENDING" || order.status === "IN_PROGRESS";

    await ctx.reply({
      message:
        (isCompletedCard
          ? `✅ Заказ выполнен\n`
          : String(order.wbCode).startsWith("DIR-")
          ? `📦 Прямой заказ\n`
          : `🔑 Код ВБ: ${order.wbCode}\n`) +
        `📅 ${new Date(order.createdAt).toLocaleDateString("ru-RU")}\n` +
        `💎 Номинал: ${order.amount} R$\n` +
        nickLine +
        gamepassLine +
        `📊 Статус: ${statusStr}` +
        hint +
        (vkShowEtaNote ? BUYOUT_ETA_NOTE : ""),
      keyboard: kb.inline(),
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
    if (ROBLOX_NICK_RE.test(text.trim().replace(/^@/, ""))) {
      await handleGamepassLink(ctx, vkUserId, text.trim(), restoredState.wbCode, restoredState.denomination);
      return;
    }
    const passPrice = Math.ceil(restoredState.denomination / 0.7);
    const firstName = await vkGetName(vkUserId);
    const isDirect = restoredState.wbCode.startsWith("DIR-");
    const idleGuideUrl = isDirect
      ? `https://robloxbank.ru/guide?source=direct`
      : `https://robloxbank.ru/guide?source=wb&skip=1&code=${restoredState.wbCode}`;
    await ctx.reply({
      message:
        `${getGreeting(status, firstName)}\n` +
        `✅ Код активирован! 📌 Цена геймпасса: ${passPrice} R$\n\n` +
        `📖 Открой свою персональную инструкцию — заказ оформляется там же: создай геймпасс и найди его по нику Roblox 🔎\n` +
        `👉 ${idleGuideUrl}\n\n` +
        `🔔 Здесь, в боте, придут уведомления о заказе.`,
      keyboard: Keyboard.builder()
        .urlButton({ label: "📖 ОТКРЫТЬ МОЮ ИНСТРУКЦИЮ", url: idleGuideUrl })
        .row()
        .textButton({ label: "🔎 Ввести ник Roblox", payload: { command: "find_gp_start" }, color: "primary" })
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
        .textButton({ label: "👤 Моё меню",        payload: { command: "menu" },         color: "primary"   })
        .row()
        .textButton({ label: "📊 Мой заказ",        payload: { command: "status" },       color: "secondary" })
        .textButton({ label: "💎 Купить напрямую", payload: { command: "start_direct" },  color: "positive"  })
        .row()
        .textButton({ label: "❓ Частые вопросы",   payload: { command: "faq" }, color: "secondary" })
        .inline(),
    });
  } else {
    const greeting = getGreeting(status, firstName);
    await ctx.reply({
      message:
        `${greeting}Я помогу получить робуксы за код с карты Wildberries 💎\n\n` +
        `🔑 Есть код с WB-карты? Напиши его прямо сюда — дам твою персональную инструкцию, заказ оформишь по ней, а тут будешь получать уведомления о заказе.\n\n` +
        `💎 Нет кода? Можно купить Robux напрямую — без карты WB, быстрее и выгоднее.`,
      keyboard: Keyboard.builder()
        .urlButton({ label: "📖 ИНСТРУКЦИЯ", url: "https://robloxbank.ru/guide?source=wb" })
        .row()
        .textButton({ label: "💬 Нужна помощь?", payload: { command: "support", context: "general" }, color: "secondary" })
        .inline(),
    });
  }
}
