/**
 * Admin notification helpers.
 *
 * Both the TG and VK bots use these to deliver order cards and review
 * screenshot requests to Telegram admins.  All admin-facing interactions
 * happen exclusively through Telegram (inline button callbacks are handled
 * by the TG bot).
 */

import { tgSend, tgSendPhoto } from "./notify";

/** Comma-separated list of Telegram admin chat IDs from env. */
export const ADMIN_IDS: string[] = (
  process.env.ADMIN_IDS ?? process.env.TG_CHAT_ID ?? ""
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// ── callback_data constants (≤ 64 bytes guaranteed with CUID ~25 chars) ────────
export const CB = {
  adminOk:    (orderId: string) => `admin_ok:${orderId}`,   // 34 b
  adminErr:   (orderId: string) => `admin_reject_init:${orderId}`,  // 43 b
  reviewOk:   (orderId: string, userId: string) => `review_ok:${orderId}:${userId}`, // 61 b
  reviewNo:   (orderId: string, userId: string) => `review_no:${orderId}:${userId}`, // 61 b

  // Safety confirmation steps
  confirmRejectOrder:  (orderId: string) => `confirm_reject:${orderId}`,
  cancelRejectOrder:   (orderId: string) => `cancel_reject:${orderId}`,
  confirmReviewReject: (orderId: string, userId: string) => `confirm_rev_no:${orderId}:${userId}`,
  cancelReviewReject:  (orderId: string, userId: string) => `cancel_rev_no:${orderId}:${userId}`,

  // Preset review rejection reasons (encoded as short keys)
  reviewRejectReason: (orderId: string, userId: string, key: string) =>
    `rev_reason:${orderId}:${userId}:${key}`,

  // ── Hub navigation ─────────────────────────────────────────────────────────
  hubOrders:       "hub_orders",
  hubStats:        "hub_stats",
  hubWildberries:  "hub_wb",
  hubSystem:       "hub_sys",

  // ── Orders hub ─────────────────────────────────────────────────────────────
  ordersActive:    "ord_active",
  ordersSearch:    "ord_search",
  ordersHistory:   "ord_hist",
  ordersBatch:     "ord_batch",
  ordersBatchConfirm: "ord_batch_ok",
  orderTakeWork:   (id: string) => `ord_work:${id}`,
  orderComplete:   (id: string) => `ord_done:${id}`,
  orderView:       (id: string) => `admin_view:${id}`,
  orderContact:    (id: string, p: string) => `ord_ct:${id}:${p}`,
  ordersBack:      "ord_back",

  // ── Stats hub ──────────────────────────────────────────────────────────────
  statsChangeRate: "stat_rate",
  statsRefresh:    "stat_refresh",

  // ── WB hub ─────────────────────────────────────────────────────────────────
  wbAddCodes:      "wb_add",
  wbAddDenom:      (d: number) => `wb_denom:${d}`,
  wbAnalytics:     "wb_analytics",
  wbDownload:      "wb_download",
  wbRefresh:       "wb_refresh",

  // ── System hub ─────────────────────────────────────────────────────────────
  sysLogs:            (name: string) => `sys_log:${name}`,
  sysRestart:         (name: string) => `sys_rst:${name}`,
  sysConfirmRestart:  (name: string) => `sys_crst:${name}`,
  sysCancelRestart:   (name: string) => `sys_xrst:${name}`,
  sysRefresh:         "sys_refresh",

  // ── Legacy (kept for backwards compatibility) ──────────────────────────────
  adminStats: "admin_stats",
  adminQueue: "admin_queue",
  adminCodes: "admin_codes",

  // User actions
  refreshStatus: "refresh_status",
} as const;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OrderCardPayload {
  id:                  string;
  amount:              number;
  gamepassUrl:         string;
  platform:            "TG" | "VK";
  wbCode:              string;
  userDisplay:         string; // e.g. "@username" or "VK: https://vk.com/id123"
  createdAt?:          Date;
  bonusApplied?:       number;
  /** Number of WbOrders placed BEFORE this one. Used to render loyalty badge. */
  previousOrderCount?: number;
}

export interface ReviewCardPayload {
  orderId:     string;
  userId:      string;   // DB User.id
  photoSource: string;   // Telegram file_id OR public HTTPS URL (VK photo)
  userDisplay: string;
}

// ── Senders ───────────────────────────────────────────────────────────────────

/**
 * Broadcast a new-order card to all Telegram admins.
 * Each admin gets an independent message with [✅ ВЫКУПЛЕНО] / [❌ ОШИБКА] buttons.
 */
export async function sendAdminOrderCard(order: OrderCardPayload): Promise<void> {
  const passPrice = Math.ceil(order.amount / 0.7);
  const shortId   = order.id.slice(-6).toUpperCase();

  const dateStr = order.createdAt 
    ? new Date(order.createdAt).toLocaleString("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) + " МСК" 
    : new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) + " МСК";

  const platformEmojis: Record<string, string> = { TG: "📱", VK: "📘", WEB: "🌐" };
  const platformEmoji = platformEmojis[order.platform] || "📦";

  const bonusLine = order.bonusApplied && order.bonusApplied > 0
    ? `🎁 Использован бонус: <b>${order.bonusApplied} R$</b>\n`
    : "";

  const prev = order.previousOrderCount ?? 0;
  const loyaltyLine =
    prev >= 5 ? `👑 <b>VIP КЛИЕНТ (${prev} заказов)</b>\n` :
    prev >= 1 ? `🔄 <b>ПОВТОРНЫЙ КЛИЕНТ</b>\n`              :
    "";

  const text =
    `📦 <b>ЗАКАЗ #${shortId}</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    loyaltyLine +
    `${platformEmoji} Источник: <b>${order.platform}</b>\n` +
    `📅 Время: <b>${dateStr}</b>\n` +
    `👤 Юзер: ${order.userDisplay}\n` +
    bonusLine +
    `💎 Сумма: <b>${order.amount} R$</b> (Геймпасс: ${passPrice} R$)\n` +
    `🔑 Код ВБ: <code>${order.wbCode}</code>\n` +
    `📊 Статус: ⏳ В обработке\n\n` +
    `🔗 <a href="${order.gamepassUrl}">Открыть Gamepass</a>`;

  const reply_markup = {
    inline_keyboard: [[
      { text: "✅ ВЫКУПЛЕНО", callback_data: CB.adminOk(order.id)  },
      { text: "❌ ОШИБКА",    callback_data: CB.adminErr(order.id) },
    ]],
  };

  await Promise.allSettled(
    ADMIN_IDS.map((id) => tgSend(id, text, { reply_markup }))
  );
}

/**
 * Broadcast a review-screenshot card to all Telegram admins.
 * Admin chooses [🎁 Начислить +50 R$] or [❌ Отклонить].
 */
export async function sendAdminReviewCard(payload: ReviewCardPayload): Promise<void> {
  const shortId = payload.orderId.slice(-6).toUpperCase();
  const caption =
    `📸 <b>Скриншот отзыва</b>\n` +
    `Заказ #${shortId}\n` +
    `Юзер: ${payload.userDisplay}`;

  const reply_markup = {
    inline_keyboard: [[
      { text: "🎁 Начислить +50 R$", callback_data: CB.reviewOk(payload.orderId, payload.userId) },
      { text: "❌ Отклонить",         callback_data: CB.reviewNo(payload.orderId, payload.userId) },
    ]],
  };

  await Promise.allSettled(
    ADMIN_IDS.map((id) =>
      tgSendPhoto(id, payload.photoSource, caption, { reply_markup })
    )
  );
}
