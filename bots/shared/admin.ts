/**
 * Admin notification helpers.
 *
 * Both the TG and VK bots use these to deliver order cards and review
 * screenshot requests to Telegram admins.  All admin-facing interactions
 * happen exclusively through Telegram (inline button callbacks are handled
 * by the TG bot).
 */

import { tgSend, tgSendPhoto } from "./notify";

// ── Support alert ─────────────────────────────────────────────────────────────

const SUPPORT_CONTEXT_LABELS: Record<string, string> = {
  code_not_found: "Код не найден",
  code_mine:      "Код уже активирован (повторный вход)",
  code_claimed:   "Код активирован другим пользователем",
  pass_format:    "Не распознан формат геймпасса",
  pass_not_found: "Геймпасс не найден на Roblox",
  pass_private:   "Геймпасс в закрытой игре",
  pass_inactive:  "Геймпасс не выставлен на продажу",
  pass_price:     "Неверная цена геймпасса",
  roblox_down:    "Серверы Roblox недоступны",
  order_dupe:     "Дублирующийся заказ",
  order_lost:     "Заказ не найден",
  rejected:       "Заказ отклонён",
  resubmit:       "Исправление ссылки",
  review_rej:     "Отзыв отклонён",
  pending_long:   "Заказ долго в обработке",
  general:        "Общий вопрос",
};

export interface SupportAlertPayload {
  platform:     "TG" | "VK";
  userDisplay:  string;
  tgId?:        string;
  contextKey:   string;
  wbCode?:      string;
  denomination?: number;
}

export async function sendAdminSupportAlert(p: SupportAlertPayload): Promise<void> {
  const label   = SUPPORT_CONTEXT_LABELS[p.contextKey] ?? p.contextKey;
  const codeLine = p.wbCode
    ? `🔑 Код: <code>${p.wbCode}</code>${p.denomination ? ` · ${p.denomination} R$` : ""}\n`
    : "";
  const linkLine = p.platform === "TG" && p.tgId
    ? `\n<a href="tg://user?id=${p.tgId}">💬 Написать пользователю</a>`
    : "";
  const now = new Date().toLocaleString("ru-RU", {
    timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit",
  });

  const text =
    `🆘 <b>ОБРАЩЕНИЕ В ПОДДЕРЖКУ</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `${p.platform === "TG" ? "📱" : "📘"} Платформа: <b>${p.platform}</b>\n` +
    `👤 Юзер: ${p.userDisplay}\n` +
    codeLine +
    `📍 Причина: <b>${label}</b>\n` +
    `⏰ ${now} МСК` +
    linkLine;

  await Promise.allSettled(ADMIN_IDS.map((id) => tgSend(id, text)));
}

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
  // Shortened to fit Telegram's 64-byte callback_data limit (CUID×2 = 50 bytes used).
  // confirm_rev_no: was 66 b, cancel_rev_no: was 65 b — both exceeded the limit.
  confirmReviewReject: (orderId: string, userId: string) => `crn:${orderId}:${userId}`,
  cancelReviewReject:  (orderId: string, userId: string) => `xrn:${orderId}:${userId}`,

  // Preset review rejection reasons (encoded as short keys)
  // rev_reason: was 69 b max — shortened to rr: (61 b max with "notpub" key).
  reviewRejectReason: (orderId: string, userId: string, key: string) =>
    `rr:${orderId}:${userId}:${key}`,

  // Preset order rejection reasons — ord_rr:{orderId}:{key} (≤ 43 b with CUID + 8-char key)
  orderRejectReason:  (orderId: string, key: string) => `ord_rr:${orderId}:${key}`,
  // "type custom reason" → enter free-text mode
  orderRejectCustom:  (orderId: string) => `ord_rr_txt:${orderId}`,

  // ── Hub navigation ─────────────────────────────────────────────────────────
  hubOrders:       "hub_orders",
  hubStats:        "hub_stats",
  hubWildberries:  "hub_wb",
  hubSystem:       "hub_sys",

  // ── Orders hub ─────────────────────────────────────────────────────────────
  ordersActive:    "ord_active",
  ordersSearch:    "ord_search",
  ordersHistory:   "ord_hist",
  ordersRejected:  "ord_rej",
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
  wbAnalyticsPeriod: (p: string) => `wb_stat_p:${p}`,
  wbProducts:      "wb_prods",
  wbRecentOrders:  "wb_recent",
  wbEditPrice:     (nmID: number) => `wb_edit_p:${nmID}`,
  wbUpdatePrice:   (nmID: number, price: number) => `wb_upd_p:${nmID}:${price}`,
  wbDownload:      "wb_download",
  wbRefresh:       "wb_refresh",
  wbStocks:        "wb_stocks",
  wbDynamics:      "wb_dynamics",
  wbUnitEcon:      "wb_unit_econ",
  wbUnitEconItem:  (nmID: number) => `wb_ue:${nmID}`,
  wbReviews:       "wb_reviews",
  wbAnswerReview:  (id: string) => `wb_ans_r:${id}`,
  wbAnswerQuestion: (id: string) => `wb_ans_q:${id}`,
  wbFbs:           "wb_fbs",
  wbEditCost:      (nmID: number) => `wb_cost:${nmID}`,
  wbEditLogistics: (nmID: number) => `wb_log:${nmID}`,
  wbEditAd:        (nmID: number) => `wb_ad:${nmID}`,
  wbEditDenom:     (nmID: number) => `wb_denom_ue:${nmID}`,
  wbUeSettings:    "wb_ue_settings",
  wbUeKursRb:      "wb_ue_kurs_rb",
  wbUeKursUsd:     "wb_ue_kurs_usd",
  wbUeFixedCost:   "wb_ue_fixed",
  wbRealization:       "wb_realiz",
  wbRealizPeriod:      (p: string) => `wb_realiz_p:${p}`,
  wbAdvert:            "wb_advert",
  wbAdvertRefresh:     "wb_advert_refresh",

  // ── System hub ─────────────────────────────────────────────────────────────
  sysLogs:            (name: string) => `sys_log:${name}`,
  sysRestart:         (name: string) => `sys_rst:${name}`,
  sysConfirmRestart:  (name: string) => `sys_crst:${name}`,
  sysCancelRestart:   (name: string) => `sys_xrst:${name}`,
  sysRefresh:         "sys_refresh",

  // ── Rates hub ──────────────────────────────────────────────────────────────
  hubRates:        "hub_rates",
  ratesRefresh:    "rates_refresh",
  ratesAnalytics:  "rates_analytics",

  // ── AutoBuy hub ────────────────────────────────────────────────────────────
  hubAutoBuy:      "hub_autobuy",
  autoBuyToggle:   "ab_toggle",
  autoBuySetRate:  "ab_set_rate",
  autoBuyRefresh:  "ab_refresh",

  // ── Boss Robux (inside AutoBuy hub) ────────────────────────────────────────
  bossrobuxSearch:  "br_search",
  bossrobuxBuy:     (i: number) => `br_buy:${i}`,    // ≤ 10 b
  bossrobuxConfirm: (i: number) => `br_ok:${i}`,     // ≤ 9 b

  // ── Legacy (kept for backwards compatibility) ──────────────────────────────
  adminStats: "admin_stats",
  adminQueue: "admin_queue",
  adminCodes: "admin_codes",

  // ── Direct order ──────────────────────────────────────────────────────────
  startDirect:         "start_direct",
  confirmDirect:       "confirm_direct",
  cancelDirect:        "cancel_direct",
  sendPaymentDetails:  (orderId: string) => `spd:${orderId}`,                             // 29 b
  cancelDirectOrder:   (orderId: string) => `cdo:${orderId}`,                             // 29 b
  paymentOk:           (orderId: string, userId: string) => `pay_ok:${orderId}:${userId}`, // 59 b
  paymentNo:           (orderId: string, userId: string) => `pay_no:${orderId}:${userId}`, // 59 b

  // User actions
  refreshStatus: "refresh_status",
  reviewHint:    "review_hint",
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
  /** Roblox username of the gamepass creator, as returned by the validation API. */
  creatorName?:        string;
  /** true when the gamepass is in an 18+ age-restricted game. */
  isAgeRestricted?:    boolean;
}

export interface ReviewCardPayload {
  orderId:     string;
  userId:      string;   // DB User.id
  photoSource: string;   // Telegram file_id OR public HTTPS URL (VK photo)
  userDisplay: string;
}

export interface DirectOrderCardPayload {
  orderId:            string;
  userId:             string;   // DB User.id
  amount:             number;   // total Robux (incl. bonus)
  bonusApplied:       number;
  userDisplay:        string;
  tgId?:              string;   // optional — not set for VK users
  createdAt:          Date;
  previousOrdersCount?: number;
}

export interface PaymentScreenshotCardPayload {
  orderId:     string;
  userId:      string;
  photoFileId: string;
  userDisplay: string;
  amount?:     number;
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

  const creatorLine    = order.creatorName    ? `🎮 Создатель ГП: <b>${order.creatorName}</b>\n`  : "";
  const ageRestrictLine = order.isAgeRestricted ? `🔞 <b>Игра 18+ — выкуп вручную</b>\n`           : "";

  const text =
    `📦 <b>ЗАКАЗ #${shortId}</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    loyaltyLine +
    `${platformEmoji} Источник: <b>${order.platform}</b>\n` +
    `📅 Время: <b>${dateStr}</b>\n` +
    `👤 Юзер: ${order.userDisplay}\n` +
    bonusLine +
    creatorLine +
    ageRestrictLine +
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
 * Notify all admins about a new direct order (no WB card).
 * Admin can send payment details or cancel the order.
 */
export async function sendAdminDirectOrderCard(payload: DirectOrderCardPayload): Promise<void> {
  const shortId = payload.orderId.slice(-6).toUpperCase();
  const dateStr = new Date(payload.createdAt).toLocaleString("ru-RU", {
    timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit",
    year: "numeric", hour: "2-digit", minute: "2-digit",
  }) + " МСК";
  const bonusLine = payload.bonusApplied > 0
    ? `🎁 Бонус учтён: <b>+${payload.bonusApplied} R$</b>\n`
    : "";

  const prev = payload.previousOrdersCount ?? 0;
  const loyaltyLine =
    prev >= 5 ? `👑 <b>VIP КЛИЕНТ (${prev} заказов)</b>\n` :
    prev >= 1 ? `🔄 <b>ПОВТОРНЫЙ КЛИЕНТ (${prev} заказ${prev === 1 ? "" : prev < 5 ? "а" : "ов"})</b>\n` :
    `🆕 <b>НОВЫЙ КЛИЕНТ</b>\n`;

  const text =
    `🔷 <b>ПРЯМОЙ ЗАКАЗ #${shortId}</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    loyaltyLine +
    `📅 Время: <b>${dateStr}</b>\n` +
    `👤 Юзер: ${payload.userDisplay}\n` +
    bonusLine +
    `💎 Сумма: <b>${payload.amount} R$</b> (Геймпасс: ${Math.ceil(payload.amount / 0.7)} R$)\n` +
    `📊 Статус: ⏳ Ожидаем реквизиты`;

  const reply_markup = {
    inline_keyboard: [[
      { text: "💳 Отправить реквизиты", callback_data: CB.sendPaymentDetails(payload.orderId) },
      { text: "❌ Отменить заказ",      callback_data: CB.cancelDirectOrder(payload.orderId) },
    ]],
  };

  await Promise.allSettled(
    ADMIN_IDS.map((id) => tgSend(id, text, { reply_markup }))
  );
}

/**
 * Send a payment screenshot card to all admins for confirmation.
 */
export async function sendAdminPaymentCard(payload: PaymentScreenshotCardPayload): Promise<void> {
  const shortId = payload.orderId.slice(-6).toUpperCase();
  const amountLine = payload.amount ? `💎 Сумма: <b>${payload.amount} R$</b>\n` : "";
  const caption =
    `💳 <b>Скриншот оплаты</b>\n` +
    `Заказ #${shortId}\n` +
    amountLine +
    `Юзер: ${payload.userDisplay}`;

  const reply_markup = {
    inline_keyboard: [[
      { text: "✅ Оплата принята", callback_data: CB.paymentOk(payload.orderId, payload.userId) },
      { text: "❌ Отклонить",      callback_data: CB.paymentNo(payload.orderId, payload.userId) },
    ]],
  };

  await Promise.allSettled(
    ADMIN_IDS.map((id) =>
      tgSendPhoto(id, payload.photoFileId, caption, { reply_markup })
    )
  );
}

/**
 * Broadcast a review-screenshot card to all Telegram admins.
 * Admin chooses [🎁 Начислить +100 R$] or [❌ Отклонить].
 */
export async function sendAdminReviewCard(payload: ReviewCardPayload): Promise<void> {
  const shortId = payload.orderId.slice(-6).toUpperCase();
  const caption =
    `📸 <b>Скриншот отзыва</b>\n` +
    `Заказ #${shortId}\n` +
    `Юзер: ${payload.userDisplay}`;

  const reply_markup = {
    inline_keyboard: [[
      { text: "🎁 Начислить +100 R$", callback_data: CB.reviewOk(payload.orderId, payload.userId) },
      { text: "❌ Отклонить",         callback_data: CB.reviewNo(payload.orderId, payload.userId) },
    ]],
  };

  await Promise.allSettled(
    ADMIN_IDS.map((id) =>
      tgSendPhoto(id, payload.photoSource, caption, { reply_markup })
    )
  );
}
