/**
 * 📈 Stats Hub — admin dashboard module.
 *
 * Shows daily/weekly sales stats, current purchase rate,
 * estimated profit, and manual rate adjustment.
 */

import { Markup, type Context } from "telegraf";
import { db } from "../../shared/db";
import { CB } from "../../shared/admin";
import { sendOrEditWidget, editWidget } from "./widgets";
import { pendingRateInput } from "../session";

// ── Main widget ──────────────────────────────────────────────────────────────

export async function showStatsHub(ctx: Context): Promise<void> {
  const text = await buildStatsText();

  await sendOrEditWidget(ctx, text, Markup.inlineKeyboard([
    [Markup.button.callback("💱 Изменить курс закупа", CB.statsChangeRate)],
    [Markup.button.callback("🔄 Обновить", CB.statsRefresh)],
  ]));
}

export async function refreshStats(ctx: Context): Promise<void> {
  const text = await buildStatsText();
  await editWidget(ctx, text, Markup.inlineKeyboard([
    [Markup.button.callback("💱 Изменить курс закупа", CB.statsChangeRate)],
    [Markup.button.callback("🔄 Обновить", CB.statsRefresh)],
  ]));
}

async function buildStatsText(): Promise<string> {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [dayStats, weekStats, settings] = await Promise.all([
    (db as any).wbOrder.aggregate({
      _count: true,
      _sum: { amount: true },
      where: { status: "COMPLETED", updatedAt: { gte: startOfDay } },
    }),
    (db as any).wbOrder.aggregate({
      _count: true,
      _sum: { amount: true },
      where: { status: "COMPLETED", updatedAt: { gte: startOfWeek } },
    }),
    (db as any).globalSettings.findUnique({ where: { id: "global" } }),
  ]);

  const purchaseRate = settings?.purchaseRate ?? null;
  const sellRate = 3.5; // placeholder — will integrate parser later

  const dayAmount = dayStats._sum.amount || 0;
  const dayRevenue = dayAmount * sellRate;
  const dayProfit = purchaseRate ? dayAmount * (sellRate - purchaseRate) : null;

  const rateLine = purchaseRate !== null
    ? `💵 Курс закупа: <b>${purchaseRate} ₽/R$</b> (ручной)\n`
    : `💵 Курс закупа: <b>не задан</b>\n`;

  const marginLine = purchaseRate !== null
    ? `📊 Маржа: <b>~${Math.round(((sellRate - purchaseRate) / sellRate) * 100)}%</b>\n`
    : "";

  const profitLine = dayProfit !== null
    ? `💰 Прибыль: <b>~${Math.round(dayProfit)} ₽</b>\n`
    : `💰 Прибыль: <i>задайте курс закупа</i>\n`;

  return (
    `📈 <b>СТАТИСТИКА</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `💰 Курс выкупа: <b>${sellRate} ₽/R$</b> <i>(заглушка)</i>\n` +
    rateLine +
    marginLine +
    `\n📅 <b>СЕГОДНЯ:</b>\n` +
    `• Заказов: <b>${dayStats._count}</b>\n` +
    `• Сумма: <b>${dayAmount} R$</b> (~${Math.round(dayRevenue)} ₽)\n` +
    profitLine +
    `\n📅 <b>ЗА 7 ДНЕЙ:</b>\n` +
    `• Заказов: <b>${weekStats._count}</b>\n` +
    `• Сумма: <b>${weekStats._sum.amount || 0} R$</b>`
  );
}

// ── Change purchase rate ─────────────────────────────────────────────────────

export async function enterRateInput(ctx: Context): Promise<void> {
  pendingRateInput.set(ctx.from!.id, true);
  await editWidget(
    ctx,
    `💱 <b>ИЗМЕНЕНИЕ КУРСА ЗАКУПА</b>\n━━━━━━━━━━━━━━━━\n\n` +
    `Введи новый курс в формате числа (например: <code>2.8</code>).\n` +
    `Это цена в рублях за 1 R$ при закупке.\n\n` +
    `<i>Ожидаю ввод…</i>`,
    Markup.inlineKeyboard([[Markup.button.callback("⬅️ Отмена", CB.hubStats)]])
  );
  await ctx.answerCbQuery();
}

export async function handleRateInput(ctx: Context, text: string): Promise<boolean> {
  if (!pendingRateInput.has(ctx.from!.id)) return false;
  pendingRateInput.delete(ctx.from!.id);

  const rate = parseFloat(text.replace(",", "."));
  if (isNaN(rate) || rate <= 0 || rate > 100) {
    await ctx.reply("❌ Некорректное значение. Введите число от 0.1 до 100.");
    return true;
  }

  await (db as any).globalSettings.upsert({
    where: { id: "global" },
    update: { purchaseRate: rate },
    create: { id: "global", usdToRub: 0, purchaseRate: rate },
  });

  await ctx.reply(`✅ Курс закупа обновлён: <b>${rate} ₽/R$</b>`, { parse_mode: "HTML" });
  return true;
}
