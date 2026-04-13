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
  adminErr:   (orderId: string) => `admin_err:${orderId}`,  // 35 b
  reviewOk:   (orderId: string, userId: string) => `review_ok:${orderId}:${userId}`, // 61 b
  reviewNo:   (orderId: string, userId: string) => `review_no:${orderId}:${userId}`, // 61 b

  // Admin menu
  adminStats: "admin_stats",
  adminQueue: "admin_queue",
  adminCodes: "admin_codes",
  
  // User actions
  refreshStatus: "refresh_status",
} as const;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OrderCardPayload {
  id:          string;
  amount:      number;
  gamepassUrl: string;
  platform:    "TG" | "VK";
  wbCode:      string;
  userDisplay: string; // e.g. "@username" or "VK: https://vk.com/id123"
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

  const text =
    `📦 <b>ЗАКАЗ #${shortId}</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `📱 Платформа: [${order.platform}]\n` +
    `👤 Юзер: ${order.userDisplay}\n` +
    `💎 Сумма: <b>${order.amount} R$</b> (Геймпасс: ${passPrice} R$)\n` +
    `🔑 Код ВБ: <code>${order.wbCode}</code>\n` +
    `📊 Статус: ⏳ В обработке\n` +
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
