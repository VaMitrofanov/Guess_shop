/**
 * Admin Reply Keyboard — single big web_app launch button.
 *
 * As of sprint 2 (item 1), the TG bot is the notifications channel only:
 * order/payment/review/support cards are still posted by the bot (with
 * inline action buttons like ✅ ВЫКУПЛЕНО / ❌ ОШИБКА). Everything else —
 * browsing, search, stats, codes, system — lives inside the TWA.
 *
 * The Reply Keyboard now renders one big "🚀 Launch Dashboard" button
 * on the full width (Telegram renders web_app reply buttons in the brand
 * blue). The Menu Button left of the input (`setupMenuButton` in `index.ts`)
 * stays as a second entry point.
 */

import { Markup } from "telegraf";

/** TWA URL used by the Launch button. Coolify sets NEXT_PUBLIC_APP_URL. */
function twaUrl(uid?: string | number): string {
  const base = `${process.env.NEXT_PUBLIC_APP_URL ?? "https://robloxbank.ru"}/twa`;
  return uid ? `${base}?uid=${uid}` : base;
}

/**
 * Build the admin Reply Keyboard with a single full-width Launch button.
 *
 * Telegram renders inline `web_app` reply-keyboard buttons with the
 * platform-native blue gradient — no styling tricks needed on our side.
 * The button closes the chat and opens the TWA in the standard Mini App
 * frame; admin authenticates via initData (HMAC over TG_TOKEN).
 *
 * `uid` is appended as `?uid=<tgId>` — iOS Telegram v9.6+ omits
 * tgWebAppData from the hash, so the TWA needs the admin ID in the URL.
 */
export async function buildAdminKeyboard(uid?: string | number) {
  return Markup.keyboard([
    [Markup.button.webApp("🚀 Launch Dashboard", twaUrl(uid))],
  ]).resize().persistent();
}
