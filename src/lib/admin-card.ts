import { sendTelegramMessage } from "@/lib/telegram";

/**
 * Web-side admin order card.
 *
 * Mirrors `sendAdminOrderCard` in `bots/shared/admin.ts` (the source of truth)
 * — kept in sync by hand because the web app cannot import from `bots/`
 * (separate tsconfig + Prisma client). The inline-button `callback_data` strings
 * MUST match `CB.adminOk` / `CB.adminErr` there, because the TG bot is what
 * actually handles those button presses.
 *
 * Used when an order is materialised straight from the website nick-search
 * (one-tap) — the card carries a 🌐 marker so the manager knows the customer
 * picked their gamepass on the site, not in the bot.
 */

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export interface WebOrderCard {
  id: string;
  amount: number;
  gamepassUrl: string;
  platform: "TG" | "VK";
  wbCode: string;
  userDisplay: string; // pre-escaped HTML
  creatorName?: string;
  previousOrderCount?: number;
}

export async function sendWebOrderCard(order: WebOrderCard): Promise<void> {
  const token = process.env.TG_TOKEN;
  const adminIds = (process.env.ADMIN_IDS ?? process.env.TG_CHAT_ID ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!token || adminIds.length === 0) {
    console.warn("[admin-card] TG_TOKEN or admin IDs missing — web order card not sent");
    return;
  }

  const passPrice = Math.ceil(order.amount / 0.7);
  const shortId = order.id.slice(-6).toUpperCase();
  const dateStr =
    new Date().toLocaleString("ru-RU", {
      timeZone: "Europe/Moscow",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }) + " МСК";

  const platformEmoji = order.platform === "VK" ? "📘" : "📱";

  const prev = order.previousOrderCount ?? 0;
  const loyaltyLine =
    prev >= 5 ? `👑 <b>VIP КЛИЕНТ (${prev} заказов)</b>\n` : prev >= 1 ? `🔄 <b>ПОВТОРНЫЙ КЛИЕНТ</b>\n` : "";

  const creatorLine = order.creatorName
    ? `🎮 Создатель ГП: <b>${escapeHtml(order.creatorName)}</b>\n`
    : "";

  const text =
    `📦 <b>ЗАКАЗ #${shortId}</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `🌐 <b>ONE-TAP С САЙТА</b>\n` +
    loyaltyLine +
    `${platformEmoji} Источник: <b>${order.platform} (сайт)</b>\n` +
    `📅 Время: <b>${dateStr}</b>\n` +
    `👤 Юзер: ${order.userDisplay}\n` +
    creatorLine +
    `💎 Сумма: <b>${order.amount} R$</b> (Геймпасс: ${passPrice} R$)\n` +
    `🔑 Код ВБ: <code>${order.wbCode}</code>\n` +
    `📊 Статус: ⏳ В обработке\n\n` +
    `🔗 <a href="${order.gamepassUrl}">Открыть Gamepass</a>` +
    (() => {
      const m = order.gamepassUrl.match(/game-pass(?:es)?\/(\d+)/);
      return m ? `\n🎫 Pass ID: <code>${m[1]}</code>` : "";
    })();

  const twaUrl = `https://robloxbank.ru/twa?q=${encodeURIComponent(shortId)}`;
  const reply_markup = {
    inline_keyboard: [
      [
        { text: "✅ ВЫКУПЛЕНО", callback_data: `admin_ok:${order.id}` },
        { text: "❌ ОШИБКА", callback_data: `admin_reject_init:${order.id}` },
      ],
      [{ text: "📊 Открыть в дашборде", web_app: { url: twaUrl } }],
    ],
  };

  await Promise.allSettled(adminIds.map((id) => sendTelegramMessage(token, id, text, { reply_markup })));
}
