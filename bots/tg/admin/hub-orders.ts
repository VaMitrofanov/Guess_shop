/**
 * 📦 Orders Hub — admin dashboard module.
 *
 * Main widget shows active order count + today's stats.
 * Sub-views: active list, search, 24h history, batch fulfillment.
 * All navigation via editMessageText — zero message spam.
 */

import { Markup, type Telegraf, type Context } from "telegraf";
import { db } from "../../shared/db";
import { CB, ADMIN_IDS } from "../../shared/admin";
import { sendOrEditWidget, editWidget } from "./widgets";
import { pendingAdminSearch, pendingBatchFulfill } from "../session";
import { updateMainMenu } from "./menu";

// ── VK community ID for direct-message links ────────────────────────────────
const VK_GROUP_ID = process.env.VK_GROUP_ID ?? "";

// ── Helpers ──────────────────────────────────────────────────────────────────

function waitTime(createdAt: Date): string {
  const diff = Date.now() - new Date(createdAt).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins} мин`;
  const hrs = Math.floor(mins / 60);
  const rm = mins % 60;
  return `${hrs}ч ${rm}м`;
}

const STATUS_LABELS: Record<string, string> = {
  PENDING: "⏳ Ожидает",
  IN_PROGRESS: "🔧 В работе",
  COMPLETED: "✅ Выполнен",
  REJECTED: "❌ Отклонён",
};

// ── Main widget ──────────────────────────────────────────────────────────────

export async function showOrdersHub(ctx: Context): Promise<void> {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const [pendingCount, inProgressCount, todayDone] = await Promise.all([
    (db as any).wbOrder.count({ where: { status: "PENDING" } }),
    (db as any).wbOrder.count({ where: { status: "IN_PROGRESS" } }),
    (db as any).wbOrder.count({ where: { status: "COMPLETED", updatedAt: { gte: startOfDay } } }),
  ]);

  const activeTotal = pendingCount + inProgressCount;

  const text =
    `📦 <b>ЗАКАЗЫ</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `⏳ Ожидают: <b>${pendingCount}</b>\n` +
    `🔧 В работе: <b>${inProgressCount}</b>\n` +
    `📊 Сегодня выполнено: <b>${todayDone}</b>\n` +
    (activeTotal === 0 ? `\n✅ Все заказы обработаны!` : "");

  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback(`🔍 Активные (${activeTotal})`, CB.ordersActive),
      Markup.button.callback("🔎 Поиск", CB.ordersSearch),
    ],
    [
      Markup.button.callback("📜 История 24ч", CB.ordersHistory),
      Markup.button.callback("📋 Пакетный выкуп", CB.ordersBatch),
    ],
  ]);

  await sendOrEditWidget(ctx, text, keyboard);
}

// ── Active orders list ───────────────────────────────────────────────────────

export async function showActiveOrders(ctx: Context): Promise<void> {
  const orders = await (db as any).wbOrder.findMany({
    where: { status: { in: ["PENDING", "IN_PROGRESS"] } },
    include: { user: true },
    orderBy: { createdAt: "asc" },
    take: 15,
  });

  if (orders.length === 0) {
    await editWidget(ctx, "📦 Нет активных заказов.", Markup.inlineKeyboard([
      [Markup.button.callback("⬅️ Назад", CB.ordersBack)],
    ]));
    return;
  }

  let text = `📦 <b>АКТИВНЫЕ ЗАКАЗЫ (${orders.length})</b>\n━━━━━━━━━━━━━━━━\n\n`;
  const buttons: any[][] = [];

  for (const o of orders) {
    const shortId = o.id.slice(-6).toUpperCase();
    const statusIcon = o.status === "IN_PROGRESS" ? "🔧" : "⏳";
    const wait = waitTime(o.createdAt);
    text += `${statusIcon} <code>${shortId}</code> — <b>${o.amount} R$</b> · ⏱${wait}\n`;
    buttons.push([Markup.button.callback(`🔍 ${shortId} (${o.amount}R$)`, CB.orderView(o.id))]);
  }

  buttons.push([Markup.button.callback("⬅️ Назад", CB.ordersBack)]);
  await editWidget(ctx, text, Markup.inlineKeyboard(buttons));
}

// ── Extended order card ──────────────────────────────────────────────────────

export async function showOrderCard(ctx: Context, orderId: string): Promise<void> {
  const order = await (db as any).wbOrder.findUnique({
    where: { id: orderId },
    include: { user: true },
  });

  if (!order) {
    await ctx.answerCbQuery("Заказ не найден");
    return;
  }

  const { text, keyboard } = await renderExtendedCard(order);
  await editWidget(ctx, text, keyboard ? Markup.inlineKeyboard(keyboard) : undefined);
}

export async function renderExtendedCard(order: any) {
  const shortId = order.id.slice(-6).toUpperCase();
  const passPrice = Math.ceil(order.amount / 0.7);
  const wait = waitTime(order.createdAt);

  const dateStr = new Date(order.createdAt).toLocaleString("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  }) + " МСК";

  // User profile link
  let userLabel = "Неизвестен";
  let contactButtons: any[] = [];

  if (order.user) {
    if (order.user.tgId) {
      const name = order.user.name || "Пользователь";
      userLabel = `<a href="tg://user?id=${order.user.tgId}">${name}</a> (ID: ${order.user.tgId})`;
      contactButtons.push(
        Markup.button.callback("💬 ТГ", CB.orderContact(order.id, "tg"))
      );
    }
    if (order.user.vkId) {
      const vkName = order.user.name || "VK Пользователь";
      userLabel = `<a href="https://vk.com/id${order.user.vkId}">${vkName}</a>`;
      contactButtons.push(
        Markup.button.callback("💬 ВК", CB.orderContact(order.id, "vk"))
      );
    }
  }

  // Loyalty
  const totalOrders = await (db as any).wbOrder.count({ where: { userId: order.userId } }).catch(() => 1);
  const prev = Math.max(0, totalOrders - 1);
  const loyaltyLine =
    prev >= 5 ? `👑 <b>VIP КЛИЕНТ (${prev} заказов)</b>\n` :
    prev >= 1 ? `🔄 <b>ПОВТОРНЫЙ КЛИЕНТ</b>\n` : "";

  // Bonus
  const wbCode = await (db as any).wbCode.findFirst({
    where: { code: { equals: order.wbCode, mode: "insensitive" } },
  });
  const bonus = wbCode && order.amount > wbCode.denomination ? order.amount - wbCode.denomination : 0;
  const bonusLine = bonus > 0 ? `🎁 Бонус: <b>${bonus} R$</b>\n` : "";
  const reviewLine = wbCode?.reviewBonusClaimed
    ? `🌟 Отзыв: <b>Оставлен (+50 R$)</b>\n`
    : `🌟 Отзыв: <b>Нет</b>\n`;

  const reasonLine = order.status === "REJECTED" && order.rejectionReason
    ? `\n💬 Причина: <i>${order.rejectionReason}</i>` : "";

  const platformEmojis: Record<string, string> = { TG: "📱", VK: "📘" };
  const pe = platformEmojis[order.platform] || "📦";

  const text =
    `📦 <b>ЗАКАЗ #${shortId}</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    loyaltyLine +
    `${pe} Источник: <b>${order.platform}</b>\n` +
    `📅 Время: <b>${dateStr}</b>\n` +
    `⏱ Ожидание: <b>${wait}</b>\n` +
    `👤 Юзер: ${userLabel}\n` +
    bonusLine + reviewLine +
    `💎 Сумма: <b>${order.amount} R$</b> (Геймпасс: ${passPrice} R$)\n` +
    `🔑 Код ВБ: <code>${order.wbCode}</code>\n` +
    `📊 Статус: <b>${STATUS_LABELS[order.status] || order.status}</b>${reasonLine}\n\n` +
    `🔗 <a href="${order.gamepassUrl}">Открыть Gamepass</a>`;

  // Build keyboard based on status
  let keyboard: any[][] | undefined;

  if (order.status === "PENDING") {
    keyboard = [
      [Markup.button.callback("🔧 В работу", CB.orderTakeWork(order.id))],
      [
        Markup.button.callback("✅ Выполнил", CB.adminOk(order.id)),
        Markup.button.callback("❌ Отклонить", CB.adminErr(order.id)),
      ],
      [...contactButtons, Markup.button.callback("⬅️ Назад", CB.ordersBack)],
    ];
  } else if (order.status === "IN_PROGRESS") {
    keyboard = [
      [
        Markup.button.callback("✅ Выполнил", CB.adminOk(order.id)),
        Markup.button.callback("❌ Отклонить", CB.adminErr(order.id)),
      ],
      [...contactButtons, Markup.button.callback("⬅️ Назад", CB.ordersBack)],
    ];
  } else {
    keyboard = [
      [...contactButtons, Markup.button.callback("⬅️ Назад", CB.ordersBack)],
    ];
  }

  return { text, keyboard };
}

// ── Take order "in work" ─────────────────────────────────────────────────────

export async function takeOrderInWork(
  bot: Telegraf,
  ctx: Context,
  orderId: string
): Promise<void> {
  const adminId = String(ctx.from!.id);

  try {
    const order = await (db as any).wbOrder.update({
      where: { id: orderId },
      data: { status: "IN_PROGRESS", adminId },
      include: { user: true },
    });

    // Notify user
    if (order.user?.tgId) {
      try {
        await bot.telegram.sendMessage(
          order.user.tgId,
          `🔧 Ваш заказ #${orderId.slice(-6).toUpperCase()} взят в работу! Ожидайте выкупа.`,
          { parse_mode: "HTML" }
        );
      } catch { /* non-fatal */ }
    }

    await showOrderCard(ctx, orderId);
    await ctx.answerCbQuery("🔧 Взято в работу");
  } catch {
    await ctx.answerCbQuery("Ошибка при обновлении");
  }
}

// ── Search mode ──────────────────────────────────────────────────────────────

export async function enterSearchMode(ctx: Context): Promise<void> {
  pendingAdminSearch.set(ctx.from!.id, true);
  await editWidget(
    ctx,
    `🔎 <b>ПОИСК ЗАКАЗА</b>\n━━━━━━━━━━━━━━━━\n\n` +
    `Введи одно из:\n` +
    `• Последние символы ID заказа\n` +
    `• Код Wildberries\n` +
    `• Ник пользователя\n\n` +
    `<i>Ожидаю ввод…</i>`,
    Markup.inlineKeyboard([[Markup.button.callback("⬅️ Отмена", CB.ordersBack)]])
  );
  await ctx.answerCbQuery();
}

export async function handleSearchQuery(ctx: Context, query: string): Promise<void> {
  pendingAdminSearch.delete(ctx.from!.id);
  const q = query.trim();
  const upper = q.toUpperCase();
  const lower = q.toLowerCase();

  // Search by order ID suffix
  let order = await (db as any).wbOrder.findFirst({
    where: { OR: [{ id: lower }, { id: { endsWith: lower } }] },
    include: { user: true },
    orderBy: { createdAt: "desc" },
  });

  // Search by WB code
  if (!order) {
    const wbCode = await (db as any).wbCode.findFirst({
      where: { code: { equals: upper, mode: "insensitive" } },
    });
    if (wbCode) {
      order = await (db as any).wbOrder.findFirst({
        where: { wbCode: wbCode.code },
        include: { user: true },
        orderBy: { createdAt: "desc" },
      });
    }
  }

  // Search by user name/tgId
  if (!order) {
    const user = await (db as any).user.findFirst({
      where: {
        OR: [
          { tgId: q },
          { name: { contains: q, mode: "insensitive" } },
        ],
      },
    });
    if (user) {
      order = await (db as any).wbOrder.findFirst({
        where: { userId: user.id },
        include: { user: true },
        orderBy: { createdAt: "desc" },
      });
    }
  }

  if (order) {
    const { text, keyboard } = await renderExtendedCard(order);
    await sendOrEditWidget(ctx, text, keyboard ? Markup.inlineKeyboard(keyboard) : undefined);
  } else {
    await sendOrEditWidget(
      ctx,
      `🔎 Ничего не найдено по запросу «<code>${q}</code>»`,
      Markup.inlineKeyboard([[Markup.button.callback("⬅️ Назад", CB.ordersBack)]])
    );
  }
}

// ── 24h History ──────────────────────────────────────────────────────────────

export async function showHistory24h(ctx: Context): Promise<void> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const orders = await (db as any).wbOrder.findMany({
    where: { status: "COMPLETED", updatedAt: { gte: since } },
    include: { user: true },
    orderBy: { updatedAt: "desc" },
    take: 20,
  });

  if (orders.length === 0) {
    await editWidget(ctx, "📜 За последние 24 часа выполненных заказов нет.", Markup.inlineKeyboard([
      [Markup.button.callback("⬅️ Назад", CB.ordersBack)],
    ]));
    return;
  }

  let text = `📜 <b>ИСТОРИЯ 24ч (${orders.length})</b>\n━━━━━━━━━━━━━━━━\n\n`;
  const buttons: any[][] = [];

  for (const o of orders) {
    const shortId = o.id.slice(-6).toUpperCase();
    const time = new Date(o.updatedAt).toLocaleString("ru-RU", {
      timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit",
    });
    text += `✅ <code>${shortId}</code> — <b>${o.amount} R$</b> · ${time}\n`;
    buttons.push([Markup.button.callback(`🔍 ${shortId}`, CB.orderView(o.id))]);
  }

  buttons.push([Markup.button.callback("⬅️ Назад", CB.ordersBack)]);
  await editWidget(ctx, text, Markup.inlineKeyboard(buttons));
}

// ── Batch fulfillment ────────────────────────────────────────────────────────

export async function showBatchView(ctx: Context): Promise<void> {
  const pending = await (db as any).wbOrder.findMany({
    where: { status: { in: ["PENDING", "IN_PROGRESS"] } },
    orderBy: { createdAt: "asc" },
  });

  if (pending.length === 0) {
    await editWidget(ctx, "📋 Нет заказов для пакетного выкупа.", Markup.inlineKeyboard([
      [Markup.button.callback("⬅️ Назад", CB.ordersBack)],
    ]));
    return;
  }

  let text = `📋 <b>ПАКЕТНЫЙ ВЫКУП</b>\n━━━━━━━━━━━━━━━━\n\n`;
  text += `Заказов: <b>${pending.length}</b>\n\n`;
  text += `<b>Ссылки для выкупа:</b>\n`;

  for (const o of pending) {
    const shortId = o.id.slice(-6).toUpperCase();
    text += `• <a href="${o.gamepassUrl}">#${shortId}</a> — ${o.amount} R$\n`;
  }

  text += `\n<i>Откройте все ссылки, выкупите геймпассы, затем нажмите «Подтвердить».</i>`;

  await editWidget(ctx, text, Markup.inlineKeyboard([
    [Markup.button.callback(`✅ Подтвердить выполнение (${pending.length})`, CB.ordersBatchConfirm)],
    [Markup.button.callback("⬅️ Назад", CB.ordersBack)],
  ]));
}

export async function confirmBatchFulfill(
  bot: Telegraf,
  ctx: Context
): Promise<void> {
  const adminId = String(ctx.from!.id);

  const orders = await (db as any).wbOrder.findMany({
    where: { status: { in: ["PENDING", "IN_PROGRESS"] } },
    include: { user: true },
  });

  if (orders.length === 0) {
    await ctx.answerCbQuery("Нет заказов");
    return;
  }

  // Get current purchase rate for snapshot
  const settings = await (db as any).globalSettings.findUnique({ where: { id: "global" } });
  const currentRate = settings?.purchaseRate ?? null;

  const ids = orders.map((o: any) => o.id);
  await (db as any).wbOrder.updateMany({
    where: { id: { in: ids } },
    data: { status: "COMPLETED", adminId, purchaseRate: currentRate },
  });

  // Notify users (non-fatal)
  for (const order of orders) {
    if (order.user?.tgId) {
      try {
        await bot.telegram.sendMessage(
          order.user.tgId,
          `✅ Заказ #${order.id.slice(-6).toUpperCase()} выкуплен! Робуксы придут через 5-7 дней.`,
          { parse_mode: "HTML" }
        );
      } catch { /* non-fatal */ }
    }
  }

  await editWidget(
    ctx,
    `✅ <b>Пакетный выкуп завершён!</b>\n\nВыполнено заказов: <b>${orders.length}</b>`,
    Markup.inlineKeyboard([[Markup.button.callback("⬅️ К заказам", CB.ordersBack)]])
  );

  await updateMainMenu(bot);
  await ctx.answerCbQuery(`✅ ${orders.length} заказов выполнено`);
}

// ── Contact link generator ───────────────────────────────────────────────────

export async function showContactLink(ctx: Context, orderId: string, platform: string): Promise<void> {
  const order = await (db as any).wbOrder.findUnique({
    where: { id: orderId },
    include: { user: true },
  });

  if (!order?.user) {
    await ctx.answerCbQuery("Пользователь не найден");
    return;
  }

  let link = "";
  if (platform === "tg" && order.user.tgId) {
    link = `tg://user?id=${order.user.tgId}`;
  } else if (platform === "vk" && order.user.vkId) {
    link = VK_GROUP_ID
      ? `https://vk.com/gim${VK_GROUP_ID}?sel=${order.user.vkId}`
      : `https://vk.com/id${order.user.vkId}`;
  }

  if (link) {
    await ctx.answerCbQuery();
    await ctx.reply(`💬 <a href="${link}">Открыть диалог</a>`, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
  } else {
    await ctx.answerCbQuery("Контакт недоступен");
  }
}
