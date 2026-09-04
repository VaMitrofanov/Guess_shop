import { formatOrderAge } from "@/lib/order-age";
import { prisma } from "@/lib/prisma";
import { sendTelegramMessage, telegramAdminRecipients } from "@/lib/telegram";
import { resolveWbOrderRef } from "../../bots/shared/wb-order-source";
import { orderCardRoots } from "../../bots/shared/order-thread";
import { formatAdminNotice, orderRef } from "../../bots/shared/notify-format";

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
 * picked their gamepass on the site, not in the bot. Когда поиск по нику не
 * нашёл геймпасс и покупатель вставил ссылку руками, маркер меняется на 🔗:
 * такой заказ стоит глянуть глазами — плейс у него, скорее всего, скрытый.
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
  createdAt: Date | string;
  /** Покупатель вставил ссылку/ID геймпасса руками — поиск по нику его не нашёл. */
  manualLink?: boolean;
  /**
   * Заказ закрывается несколькими пассами. Админу это надо видеть в первой же
   * строке: цена одного пасса в шапке к такому заказу не относится, а части
   * покупаются РАЗНЫМИ донорами.
   */
  splitParts?: { gamepassId: string; amount: number }[];
}

export function buildWebOrderCardText(
  order: WebOrderCard,
  now: Date | number = Date.now(),
  wbOrderId: string | null = null,
): string {
  const passPrice = Math.ceil(order.amount / 0.7);
  const dateStr =
    new Date(order.createdAt).toLocaleString("ru-RU", {
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

  const parts = order.splitParts ?? [];
  const splitLines = parts.length > 1
    ? [
        `🧩 <b>РАЗБИВКА: ${parts.length} ${parts.length === 1 ? "часть" : parts.length < 5 ? "части" : "частей"}</b> — каждую покупать с ОТДЕЛЬНОГО донора`,
        ...parts.map((part, index) =>
          `   ${index + 1}. <code>${part.gamepassId}</code> · ${part.amount} R$ · пасс ${Math.ceil(part.amount / 0.7)} R$`),
      ]
    : [];

  const passIdLine = (() => {
    const m = order.gamepassUrl.match(/game-pass(?:es)?\/(\d+)/);
    return m ? `🎫 Pass ID: <code>${m[1]}</code>` : null;
  })();

  // Единый язык уведомлений админам — тот же, что у карточки из ботов
  // (`sendAdminOrderCard`) и у сообщений DBS. Заказ готов к выкупу, это ручное
  // действие: 🟠 «action».
  return formatAdminNotice({
    marker: "action",
    zone: "WB",
    title: "заказ ждёт выкупа",
    lines: [
      orderRef(
        { wbOrderId, code: order.wbCode, denomination: order.amount },
        [parts.length > 1 ? `${parts.length} пасса на ${passPrice} R$ суммарно` : `геймпасс ${passPrice} R$`],
      ),
      order.manualLink
        ? `🔗 <b>ССЫЛКА ВРУЧНУЮ С САЙТА</b> — поиск по нику не нашёл геймпасс`
        : `🌐 <b>ONE-TAP С САЙТА</b>`,
      loyaltyLine.trim() || null,
      `${platformEmoji} Источник: <b>${order.platform} (сайт)</b>`,
      `👤 Юзер: ${order.userDisplay}`,
      creatorLine.trim() || null,
      `📅 Время: <b>${dateStr}</b>`,
      // Возраст — отдельной строкой: у недельного заказа это и есть тревога,
      // и в хвосте строки с датой её глаз пропускает.
      `⏳ Возраст заказа: <b>${formatOrderAge(order.createdAt, now)}</b>`,
      ...splitLines,
      `🔗 <a href="${order.gamepassUrl}">Открыть Gamepass</a>`,
      parts.length > 1 ? null : passIdLine,
    ],
    next: parts.length > 1
      ? "выкупить части с разных доноров (карточка заказа ведёт по одной) и нажать «ВЫКУПЛЕНО»"
      : "скопировать Pass ID, купить в доноре и нажать «ВЫКУПЛЕНО»",
  });
}

export async function sendWebOrderCard(order: WebOrderCard): Promise<void> {
  const token = process.env.TG_TOKEN;
  const adminIds = telegramAdminRecipients();

  if (!token || adminIds.length === 0) {
    console.warn("[admin-card] TG_TOKEN or admin IDs missing — web order card not sent");
    return;
  }

  const wbRef = await resolveWbOrderRef(prisma, order.wbCode);
  // У DBS-заказа корень ветки — живая карточка; у обычного WB-заказа её нет, и
  // корнем становится карточка активации кода («⌛ Ожидаем ссылку»).
  const threadRoots = wbRef.cardMessages ? null : await orderCardRoots(prisma, order.wbCode);
  const text = buildWebOrderCardText(order, Date.now(), wbRef.wbOrderId);

  const twaUrl = `https://robloxbank.ru/twa?q=${encodeURIComponent(order.wbCode)}`;
  const reply_markup = {
    inline_keyboard: [
      [
        { text: "✅ ВЫКУПЛЕНО", callback_data: `admin_ok:${order.id}` },
        { text: "❌ ОШИБКА", callback_data: `admin_reject_init:${order.id}` },
      ],
      [{ text: "📊 Открыть в дашборде", web_app: { url: twaUrl } }],
    ],
  };

  // Ответ на корень ветки — карточка выкупа встаёт в ту же нить заказа.
  await Promise.allSettled(adminIds.map((id) => {
    const rootId = wbRef.cardMessages?.[id] ?? threadRoots?.[id];
    return sendTelegramMessage(token, id, text, {
      reply_markup,
      ...(rootId ? { reply_to_message_id: rootId, allow_sending_without_reply: true } : {}),
    });
  }));
}
