import { formatOrderAge } from "@/lib/order-age";
import { prisma } from "@/lib/prisma";
import { sendTelegramMessage } from "@/lib/telegram";
import { adminTargets, groupSafeMarkup, replyToRootFor } from "../../bots/shared/admin-route";
import { resolveWbOrderRef } from "../../bots/shared/wb-order-source";
import { orderCardRoots } from "../../bots/shared/order-thread";
import { refreshDbsCardByCode } from "../../bots/shared/wb-dbs-thread";
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
 * А если пасс создан нашим ботом по ключу покупателя, маркер становится 🔑:
 * цену и «в продаже» выставляли мы, и проверять их — тоже нам.
 */

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

interface WebOrderCard {
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
   * Пасс создал НАШ бот по Open Cloud-ключу покупателя (инструкция V2).
   * Админу это надо видеть до выкупа: цену и «в продаже» выставляли мы, и
   * спрашивать за них тоже с нас. Признак берётся из событий заказа
   * (`AUDIT_GAMEPASS_AUTOCREATED`), а не со слов клиента.
   */
  viaKey?: boolean;
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
  /* 16.11.2026 (владелец, вариант A): та же короткая карточка, что у ботов
     (`sendAdminOrderCard`): кто/откуда/возраст — одной строкой, пасс или части
     — одной строкой с повтором «×N», «Выкуплено» — только в TWA. */
  const passPrice = Math.ceil(order.amount / 0.7);
  const platformEmoji = order.platform === "VK" ? "📘" : "📱";
  const prev = order.previousOrderCount ?? 0;
  const loyaltyLine =
    prev >= 5 ? `👑 <b>VIP КЛИЕНТ (${prev} заказов)</b>` : prev >= 1 ? `🔄 <b>ПОВТОРНЫЙ КЛИЕНТ</b>` : null;

  const parts = order.splitParts ?? [];
  const splitGross = parts.reduce((sum, part) => sum + Math.ceil(part.amount / 0.7), 0);
  const partIds = parts.map((part) => part.gamepassId);
  const partGroups = [...new Set(partIds)].map((id) => {
    const count = partIds.filter((x) => x === id).length;
    return `<code>${id}</code>${count > 1 ? ` ×${count}` : ""}`;
  });
  const passId = order.gamepassUrl.match(/game-pass(?:es)?\/(\d+)/)?.[1] ?? null;
  const passLine = parts.length > 1
    ? `🧩 ${parts.length} ${parts.length < 5 ? "части" : "частей"} на ${splitGross} R$ — с разных аккаунтов · ${partGroups.join(", ")} · ${parts.map((part) => `${Math.ceil(part.amount / 0.7)} R$`).join(" + ")}`
    : `🎫 Pass ID: <code>${passId ?? "—"}</code> · пасс ${passPrice} R$ · <a href="${order.gamepassUrl}">открыть</a>`;
  const whoLine = [
    `${platformEmoji} ${order.platform} (сайт)`,
    order.userDisplay,
    order.creatorName ? `🎮 ${escapeHtml(order.creatorName)}` : null,
    `⏳ ${formatOrderAge(order.createdAt, now)}`,
  ].filter(Boolean).join(" · ");

  return formatAdminNotice({
    marker: "action",
    zone: "WB",
    title: "ждёт выкупа",
    lines: [
      orderRef({ wbOrderId, code: order.wbCode, denomination: order.amount }),
      order.viaKey
        ? `🔑 <b>ПАСС СОЗДАН ПО API-КЛЮЧУ</b> — цену и «в продаже» выставили мы`
        : order.manualLink
          ? `🔗 <b>ССЫЛКА ВРУЧНУЮ С САЙТА</b> — поиск по нику не нашёл геймпасс`
          : `🌐 <b>ONE-TAP С САЙТА</b>`,
      loyaltyLine,
      whoLine,
      passLine,
    ],
    next: "скопировать ID → купить в аккаунте → «Выкуплено» в TWA",
  });
}

export async function sendWebOrderCard(order: WebOrderCard): Promise<void> {
  const token = process.env.TG_TOKEN;
  const wbRef = await resolveWbOrderRef(prisma, order.wbCode);
  // Карточка с сайта — только у заказов WB (прямых здесь нет): «💸 К выкупу».
  const targets = await adminTargets("buyout", { loud: true });

  if (!token || targets.length === 0) {
    console.warn("[admin-card] TG_TOKEN or admin IDs missing — web order card not sent");
    return;
  }

  // У DBS-заказа корень ветки — живая карточка; у обычного WB-заказа её нет, и
  // корнем становится карточка активации кода («⌛ Ожидаем ссылку»).
  const threadRoots = wbRef.cardMessages ? null : await orderCardRoots(prisma, order.wbCode);
  const text = buildWebOrderCardText(order, Date.now(), wbRef.wbOrderId);

  const twaUrl = `https://robloxbank.ru/twa?q=${encodeURIComponent(order.wbCode)}`;
  // Копия ID — кнопкой Telegram (copy_text), без бота; «Открыть в TWA» в беседе
  // становится ссылкой `t.me/<бот>?startapp=<код>` (groupSafeMarkup).
  const parts = order.splitParts ?? [];
  const copyIds = parts.length > 1
    ? parts.map((part) => part.gamepassId).join("\n")
    : order.gamepassUrl.match(/game-pass(?:es)?\/(\d+)/)?.[1] ?? null;
  const reply_markup = {
    inline_keyboard: [[
      ...(copyIds ? [{ text: parts.length > 1 ? `📋 ID ×${parts.length}` : `📋 ${copyIds}`, copy_text: { text: copyIds } }] : []),
      { text: "📱 Открыть в TWA", web_app: { url: twaUrl } },
    ]],
  };

  // Ответ на корень ветки — карточка выкупа встаёт в ту же нить заказа.
  await Promise.allSettled(targets.map((t) => {
    const rootId = wbRef.cardMessages?.[t.key] ?? threadRoots?.[t.key];
    return sendTelegramMessage(token, t.chatId, text, {
      reply_markup: groupSafeMarkup(reply_markup, t),
      ...(rootId ? { reply_to_message_id: rootId, allow_sending_without_reply: true } : {}),
      ...t.extra,
    });
  }));

  // Живая карточка DBS обязана догнать заказ: ссылка получена — значит её
  // заголовок больше не «покупатель активирует код в боте».
  if (wbRef.source === "WB_DBS") await refreshDbsCardByCode(prisma, order.wbCode);
}
