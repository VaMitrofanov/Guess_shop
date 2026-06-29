/**
 * Admin notification helpers.
 *
 * Both the TG and VK bots use these to deliver order cards and review
 * screenshot requests to Telegram admins.  All admin-facing interactions
 * happen exclusively through Telegram (inline button callbacks are handled
 * by the TG bot).
 */

import { tgSend, tgSendPhoto, escapeHtml } from "./notify";

// ── Direct order pricing ───────────────────────────────────────────────────────

/** Available pack sizes for button UI. Prices computed by directPrice(). */
export const DIRECT_PRICES: Record<number, number> = {
  100:  160,
  200:  260,
  300:  360,
  400:  460,
  500:  450,
  800:  720,
  1000: 800,
  1200: 960,
  1500: 1050,
  2000: 1400,
};

/** Ordered list of available pack sizes (derived from DIRECT_PRICES). */
export const DIRECT_PACKS = Object.keys(DIRECT_PRICES).map(Number) as number[];

/** Rate per robux (₽/R$) by tier — used for custom (non-pack) amounts. */
export function customRate(amount: number): number {
  if (amount < 500)  return 1.0;
  if (amount < 1000) return 0.9;
  if (amount < 1500) return 0.8;
  return 0.7;
}

/** Returns the ruble price for any amount. Always uses tiered formula. */
export function directPrice(amount: number): number {
  const surcharge = amount < 500 ? 60 : 0;
  return Math.round(customRate(amount) * amount + surcharge);
}

/** Minimum pack size that qualifies for the R$ bonus. Set to 0 for all packs. */
export const BONUS_MIN_PACK = 0;

/** Minimum custom amount for direct orders. */
export const CUSTOM_MIN = 100;

/** Maximum custom amount for direct orders. */
export const CUSTOM_MAX = 100_000;

/** Special promo prices for non-bonus users (Friday push). */
export const PROMO_PRICES: Record<number, number> = {
  100:  100,
  200:  200,
  500:  450,
  1000: 800,
};

/** @deprecated Kept for admin card backwards compat — use directPrice() instead. */
export const DIRECT_RATE = 0.7;

export const ROBLOX_NICK_RE = /^[A-Za-z0-9_]{3,20}$/;

export function generateDirectCode(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "DIR-";
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

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
  pass_deleted:   "Геймпасс удалён",
  roblox_down:    "Серверы Roblox недоступны",
  order_dupe:     "Дублирующийся заказ",
  order_lost:     "Заказ не найден",
  rejected:       "Заказ отклонён",
  resubmit:       "Исправление ссылки",
  review_rej:     "Отзыв отклонён",
  pending_long:   "Заказ долго в обработке",
  direct_wait:    "Долгое ожидание прямого заказа",
  general:        "Общий вопрос",
  // Item 7 Phase E — nick-search dead-ends
  nick_not_found: "Ник Roblox не найден",
  place_closed:   "Закрытый плейс / нет публичных геймпассов",
  wrong_price:    "Геймпасс есть, но цена неверна",
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

/** Public support contact. Used as the final URL the bot hands the user after
 *  they tap the in-bot support button — see TG `sup:<ctxKey>` callback. */
export const SUPPORT_URL = "https://t.me/RobloxBank_PA";

// In-memory dedup shared by the full SOS alert (real tap) and the lightweight
// "user hurdle" heads-up (show-time on a dead-end). Different namespaces so
// the two streams don't poison each other's TTL window.
const SUPPORT_ALERT_TTL_MS = 30 * 60 * 1000;
const supportAlertSeen = new Map<string, number>();

function cleanupSupportAlertSeen(now: number): void {
  if (supportAlertSeen.size <= 500) return;
  for (const [k, t] of supportAlertSeen) if (now - t > SUPPORT_ALERT_TTL_MS) supportAlertSeen.delete(k);
}

/** Deduplicated wrapper around {@link sendAdminSupportAlert} for real button-tap
 *  events (currently fired from the TG `sup:<ctxKey>` callback and from VK's
 *  payload-driven support button). */
export async function notifySupportShown(p: SupportAlertPayload): Promise<void> {
  const key = `SOS:${p.platform}:${p.tgId ?? p.userDisplay}:${p.contextKey}`;
  const now = Date.now();
  const last = supportAlertSeen.get(key);
  if (last && now - last < SUPPORT_ALERT_TTL_MS) return;
  supportAlertSeen.set(key, now);
  cleanupSupportAlertSeen(now);
  await sendAdminSupportAlert(p);
}

/** "User got stuck" heads-up — fires at show-time when the bot puts a support
 *  button in front of the user after a UX dead-end (wrong nick, closed place,
 *  wrong price, etc.). Distinct from the full SOS alert: one-liner, no 🆘
 *  scream emoji, just a 👀 + stage + code so the admin can decide whether to
 *  jump in proactively. Real SOS still fires *only* when the user actually
 *  taps the support button (see {@link notifySupportShown}). */
export async function notifyUserHurdle(p: SupportAlertPayload): Promise<void> {
  const key = `HURDLE:${p.platform}:${p.tgId ?? p.userDisplay}:${p.contextKey}`;
  const now = Date.now();
  const last = supportAlertSeen.get(key);
  if (last && now - last < SUPPORT_ALERT_TTL_MS) return;
  supportAlertSeen.set(key, now);
  cleanupSupportAlertSeen(now);

  const label = SUPPORT_CONTEXT_LABELS[p.contextKey] ?? p.contextKey;
  const codePart = p.wbCode
    ? ` · 🔑 <code>${p.wbCode}</code>${p.denomination ? ` (${p.denomination} R$)` : ""}`
    : "";
  const time = new Date().toLocaleString("ru-RU", {
    timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit",
  });
  const text = `👀 ${p.userDisplay} застрял: <i>${label}</i>${codePart} · ${time}`;
  await Promise.allSettled(ADMIN_IDS.map(id => tgSend(id, text)));
}

/** Comma-separated list of Telegram admin chat IDs from env. */
export const ADMIN_IDS: string[] = (
  process.env.ADMIN_IDS ?? process.env.TG_CHAT_ID ?? ""
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// ── Unified user-handle formatting ─────────────────────────────────────────────

/** Minimal shape needed by {@link formatUserHandle}. */
export interface UserHandleSource {
  tgId?:     string | null;
  vkId?:     string | null;
  username?: string | null;
  name?:     string | null;
}

/**
 * Build the canonical user label for admin cards.
 *
 * TG priority:  `@username` (clickable) → display name → `tg:<id>`
 * VK priority:  display name → `vk:<id>`
 *
 * Returns plain text — caller wraps in HTML link as needed.
 */
export function formatUserHandle(u: UserHandleSource): string {
  // Display names are user-controlled and every current call site embeds the
  // result into an HTML message — escape here so a name like "<Вадим>" can't
  // break the Telegram card. @usernames are [A-Za-z0-9_] and need no escaping.
  if (u.tgId) {
    if (u.username) return `@${u.username}`;
    return u.name ? escapeHtml(u.name) : `tg:${u.tgId}`;
  }
  if (u.vkId) {
    return u.name ? escapeHtml(u.name) : `vk:${u.vkId}`;
  }
  return u.name ? escapeHtml(u.name) : "Неизвестен";
}

/**
 * Same as {@link formatUserHandle} but wrapped in an HTML link to the user's profile.
 * Suitable for HTML-formatted admin messages.
 */
export function formatUserHandleHtml(u: UserHandleSource): string {
  const label = formatUserHandle(u);
  if (u.tgId) {
    // @username links work natively in Telegram even without an explicit <a>,
    // but wrapping in tg://user?id=... gives a deterministic profile link
    // that works even if the handle is unavailable.
    if (u.username) return `<a href="https://t.me/${u.username}">${label}</a>`;
    return `<a href="tg://user?id=${u.tgId}">${label}</a>`;
  }
  if (u.vkId) {
    return `<a href="https://vk.com/id${u.vkId}">${label}</a>`;
  }
  return label;
}

// ── callback_data constants (≤ 64 bytes guaranteed with CUID ~25 chars) ────────
export const CB = {
  adminOk:    (orderId: string) => `admin_ok:${orderId}`,   // 34 b
  adminErr:   (orderId: string) => `admin_reject_init:${orderId}`,  // 43 b
  purchaseScript: (orderId: string) => `ps:${orderId}`,            // 28 b
  reviewOk:   (orderId: string, userId: string) => `review_ok:${orderId}:${userId}`, // 61 b
  reviewNo:   (orderId: string, userId: string) => `review_no:${orderId}:${userId}`, // 61 b

  // Safety confirmation steps
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
  orderView:       (id: string) => `admin_view:${id}`,
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
  wbDownload:      "wb_download",
  wbRefresh:       "wb_refresh",
  wbStocks:        "wb_stocks",
  wbDynamics:      "wb_dynamics",
  wbUnitEcon:      "wb_unit_econ",
  wbReviews:       "wb_reviews",
  wbAnswerReview:  (id: string) => `wb_ans_r:${id}`,
  wbAnswerQuestion: (id: string) => `wb_ans_q:${id}`,
  wbFbs:           "wb_fbs",
  wbEditAd:        (nmID: number) => `wb_ad:${nmID}`,
  wbEditDenom:     (nmID: number) => `wb_denom_ue:${nmID}`,
  wbUeSettings:    "wb_ue_settings",
  wbCalcWhatIf:    "wb_calc_whatif",
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

  // ── Direct order ──────────────────────────────────────────────────────────
  startDirect:         "start_direct",
  confirmDirect:       "confirm_direct",
  confirmDirectNb:     "confirm_direct_nb",
  cancelDirect:        "cancel_direct",
  customDirect:        "dp:custom",
  directPack:          (amount: number) => `dp:${amount}`,                                // 8 b max
  sendPaymentDetails:  (orderId: string) => `spd:${orderId}`,                             // 29 b
  sendQr:              (orderId: string) => `sqr:${orderId}`,                             // 29 b
  cancelDirectOrder:   (orderId: string) => `cdo:${orderId}`,                             // 29 b
  userCancelDirect:    (orderId: string) => `ucd:${orderId}`,                             // 29 b
  paymentOk:           (orderId: string, userId: string) => `pay_ok:${orderId}:${userId}`, // 59 b
  paymentNo:           (orderId: string, userId: string) => `pay_no:${orderId}:${userId}`, // 59 b

  // ── Direct intent (new pre-order flow) ─────────────────────────────────
  sendIntentQr:       (id: string) => `sqi:${id}`,              // ≤29 b
  sendIntentDetails:  (id: string) => `spi:${id}`,              // ≤29 b
  cancelIntent:       (id: string) => `cai:${id}`,              // ≤29 b
  userCancelIntent:   (id: string) => `uci:${id}`,              // ≤29 b
  directNickOk:       "dir_nick_ok",                             // 11 b
  directNickNew:      "dir_nick_new",                            // 12 b
  directGpPick:       (passId: string) => `dgp:${passId}`,      // ≤16 b
  directSubmit:       "dir_submit",                              // 10 b
  directCancel:       "dir_cancel",                              // 10 b
  editNick:           "edit_nick",                               // 9 b

  // User actions
  refreshStatus: "refresh_status",
  reviewHint:    "review_hint",
  buyerMenu:     "menu",                                     // buyer mini-profile hub

  // ── Gamepass search by Roblox nick (item 7) ──────────────────────────────
  // Client flow: user clicks "find by nick" → bot asks for nick → user types
  // it → bot lists matches as inline buttons. Pass IDs are numeric strings
  // up to ~12 digits, well under the 64-byte callback limit.
  findGpStart:   "find_gp",                                  // 7 b
  findGpRetry:   "find_gp_retry",                            // 13 b
  gpPick:        (passId: string) => `gp_pick:${passId}`,    // ≤ 22 b
  // "change my Roblox nick / gamepass" on an already-placed order (передумал)
  changeNick:    "change_nick",                              // 11 b

  // ── Support button tap (replaces the prior URL button so we can detect
  // *real* taps and fire the full SOS only then; show-time fires a much
  // smaller "user hurdle" heads-up instead). Suffix is the context key —
  // ctxKey alphabet is `[a-z_]+`, never close to the 64-byte limit. ──
  supTap:        (ctxKey: string) => `sup:${ctxKey}`,        // ≤ 30 b

  // ── FAQ / self-service (replaces support in the first 24h) ──
  faq:           "faq",                                       // 3 b
  faqItem:       (key: string) => `fq:${key}`,               // ≤ 20 b
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
  /** true when the customer picked this gamepass via the website nick-search (one-tap). */
  viaWebOneTap?:       boolean;
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

export interface DirectIntentCardPayload {
  intentId:             string;
  userId:               string;
  amount:               number;
  bonus:                number;
  totalAmount:          number;
  rublePrice:           number;
  robloxUsername:        string;
  gamepassUrl:          string;
  gamepassName?:        string;
  userDisplay:          string;
  tgId?:                string;
  platform:             "TG" | "VK";
  createdAt:            Date;
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

  const creatorLine    = order.creatorName    ? `🎮 Создатель ГП: <b>${escapeHtml(order.creatorName)}</b>\n`  : "";
  const ageRestrictLine = order.isAgeRestricted ? `🔞 <b>Игра 18+ — выкуп вручную</b>\n`           : "";

  const webOneTapLine = order.viaWebOneTap ? `🌐 <b>ONE-TAP С САЙТА</b>\n` : "";

  const text =
    `📦 <b>ЗАКАЗ #${shortId}</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    webOneTapLine +
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
    `🔗 <a href="${order.gamepassUrl}">Открыть Gamepass</a>` +
    (() => {
      const m = order.gamepassUrl.match(/game-pass(?:es)?\/(\d+)/);
      return m ? `\n🎫 Pass ID: <code>${m[1]}</code>` : "";
    })();

  // One-tap deep-link into the TWA Orders screen, prefocused on this order.
  // web_app inline buttons launch the Web App in personal chats with the given
  // URL — no Direct Link app name needed.
  const twaUrl = `https://robloxbank.ru/twa?q=${encodeURIComponent(shortId)}`;
  const reply_markup = {
    inline_keyboard: [
      [
        { text: "✅ ВЫКУПЛЕНО", callback_data: CB.adminOk(order.id)  },
        { text: "❌ ОШИБКА",    callback_data: CB.adminErr(order.id) },
      ],
      [
        { text: "📋 Скрипт выкупа", callback_data: CB.purchaseScript(order.id) },
        { text: "📊 Дашборд",       web_app: { url: twaUrl } },
      ],
    ],
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

  const paidRobux = payload.amount - payload.bonusApplied;
  const rublePrice = directPrice(paidRobux);

  const text =
    `🔷 <b>ПРЯМОЙ ЗАКАЗ #${shortId}</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    loyaltyLine +
    `📅 Время: <b>${dateStr}</b>\n` +
    `👤 Юзер: ${payload.userDisplay}\n` +
    bonusLine +
    `💰 К оплате: <b>${rublePrice} ₽</b>\n` +
    `💎 Выдать: <b>${payload.amount} R$</b> (Геймпасс: ${Math.ceil(payload.amount / 0.7)} R$)\n` +
    `📊 Статус: ⏳ Ожидаем реквизиты`;

  const twaUrl = `https://robloxbank.ru/twa?q=${encodeURIComponent(shortId)}`;
  const reply_markup = {
    inline_keyboard: [
      [
        { text: "📷 Отправить QR (СБП)", callback_data: CB.sendQr(payload.orderId) },
      ],
      [
        { text: "💳 Реквизиты текстом", callback_data: CB.sendPaymentDetails(payload.orderId) },
        { text: "❌ Отменить заказ",     callback_data: CB.cancelDirectOrder(payload.orderId) },
      ],
      [
        { text: "📊 Открыть в дашборде", web_app: { url: twaUrl } },
      ],
    ],
  };

  await Promise.allSettled(
    ADMIN_IDS.map((id) => tgSend(id, text, { reply_markup }))
  );
}

/**
 * Notify all admins about a new direct intent (pre-order).
 * Admin can send QR / payment details or reject.
 */
export async function sendAdminIntentCard(payload: DirectIntentCardPayload): Promise<void> {
  const shortId = payload.intentId.slice(-6).toUpperCase();
  const dateStr = new Date(payload.createdAt).toLocaleString("ru-RU", {
    timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit",
    year: "numeric", hour: "2-digit", minute: "2-digit",
  }) + " МСК";
  const bonusLine = payload.bonus > 0
    ? `🎁 Бонус: <b>+${payload.bonus} R$</b>\n`
    : "";

  const prev = payload.previousOrdersCount ?? 0;
  const loyaltyLine =
    prev >= 5 ? `👑 <b>VIP КЛИЕНТ (${prev} заказов)</b>\n` :
    prev >= 1 ? `🔄 <b>ПОВТОРНЫЙ КЛИЕНТ (${prev} заказ${prev === 1 ? "" : prev < 5 ? "а" : "ов"})</b>\n` :
    `🆕 <b>НОВЫЙ КЛИЕНТ</b>\n`;

  const passPrice = Math.ceil(payload.totalAmount / 0.7);
  const gpName = payload.gamepassName ? ` · "${escapeHtml(payload.gamepassName)}"` : "";

  const text =
    `🔷 <b>ЗАЯВКА #${shortId}</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    loyaltyLine +
    `📅 Время: <b>${dateStr}</b>\n` +
    `👤 Юзер: ${payload.userDisplay}\n` +
    bonusLine +
    `🎮 Ник: <b>${escapeHtml(payload.robloxUsername)}</b>\n` +
    `🎫 Геймпасс: <b>${passPrice} R$</b>${gpName}\n` +
    `🔗 <a href="${payload.gamepassUrl}">Открыть Gamepass</a>\n` +
    `💰 К оплате: <b>${payload.rublePrice} ₽</b>\n` +
    `💎 Выдать: <b>${payload.totalAmount} R$</b>\n` +
    `📊 Статус: ⏳ Ожидаем реквизиты`;

  const reply_markup = {
    inline_keyboard: [
      [
        { text: "📷 QR (СБП)", callback_data: CB.sendIntentQr(payload.intentId) },
      ],
      [
        { text: "💳 Реквизиты", callback_data: CB.sendIntentDetails(payload.intentId) },
        { text: "❌ Отклонить",  callback_data: CB.cancelIntent(payload.intentId) },
      ],
    ],
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
