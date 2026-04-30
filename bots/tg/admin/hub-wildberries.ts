/**
 * 🟣 Wildberries Hub — admin dashboard module.
 *
 * Shows WB code inventory with stock level indicators,
 * code addition via text parser, activation analytics,
 * and unused codes download.
 */

import { Markup, type Context } from "telegraf";
import { db } from "../../shared/db";
import { CB } from "../../shared/admin";
import { sendOrEditWidget, editWidget } from "./widgets";
import { pendingCodesInput } from "../session";

// ── Stock level indicators ───────────────────────────────────────────────────

function stockIcon(count: number): string {
  if (count >= 10) return "🟢";
  if (count >= 3)  return "🟡";
  return "🔴";
}

// ── Main widget ──────────────────────────────────────────────────────────────

export async function showWildberriesHub(ctx: Context): Promise<void> {
  const text = await buildWbText();

  await sendOrEditWidget(ctx, text, Markup.inlineKeyboard([
    [Markup.button.callback("➕ Добавить коды", CB.wbAddCodes)],
    [
      Markup.button.callback("📊 Аналитика", CB.wbAnalytics),
      Markup.button.callback("📥 Выгрузить", CB.wbDownload),
    ],
    [Markup.button.callback("🔄 Обновить", CB.wbRefresh)],
  ]));
}

export async function refreshWb(ctx: Context): Promise<void> {
  const text = await buildWbText();
  await editWidget(ctx, text, Markup.inlineKeyboard([
    [Markup.button.callback("➕ Добавить коды", CB.wbAddCodes)],
    [
      Markup.button.callback("📊 Аналитика", CB.wbAnalytics),
      Markup.button.callback("📥 Выгрузить", CB.wbDownload),
    ],
    [Markup.button.callback("🔄 Обновить", CB.wbRefresh)],
  ]));
}

async function buildWbText(): Promise<string> {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const [groups, todayUsed, totalUsed] = await Promise.all([
    (db as any).wbCode.groupBy({
      by: ["denomination"],
      _count: { _all: true },
      where: { isUsed: false },
    }),
    (db as any).wbCode.count({
      where: { isUsed: true, usedAt: { gte: startOfDay } },
    }),
    (db as any).wbCode.count({ where: { isUsed: true } }),
  ]);

  groups.sort((a: any, b: any) => a.denomination - b.denomination);

  let stockLines = "";
  let totalAvailable = 0;

  for (const g of groups) {
    const count = g._count._all;
    totalAvailable += count;
    stockLines += `• <b>${g.denomination} R$</b>: ${count} шт. ${stockIcon(count)}\n`;
  }

  if (groups.length === 0) {
    stockLines = "⚠️ <b>Коды закончились!</b>\n";
  }

  return (
    `🟣 <b>WILDBERRIES</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `📦 Остатки кодов:\n` +
    stockLines +
    `\n📊 Всего доступно: <b>${totalAvailable} шт.</b>\n` +
    `📈 Активировано сегодня: <b>${todayUsed}</b>\n` +
    `📈 Активировано всего: <b>${totalUsed}</b>`
  );
}

// ── Add codes — denomination picker ──────────────────────────────────────────

export async function showAddCodesDenom(ctx: Context): Promise<void> {
  await editWidget(
    ctx,
    `➕ <b>ДОБАВЛЕНИЕ КОДОВ</b>\n━━━━━━━━━━━━━━━━\n\n` +
    `Выбери номинал для добавляемых кодов:`,
    Markup.inlineKeyboard([
      [
        Markup.button.callback("100 R$", CB.wbAddDenom(100)),
        Markup.button.callback("200 R$", CB.wbAddDenom(200)),
      ],
      [
        Markup.button.callback("500 R$", CB.wbAddDenom(500)),
        Markup.button.callback("1000 R$", CB.wbAddDenom(1000)),
      ],
      [Markup.button.callback("⬅️ Назад", CB.hubWildberries)],
    ])
  );
  await ctx.answerCbQuery();
}

export async function enterCodesInput(ctx: Context, denomination: number): Promise<void> {
  pendingCodesInput.set(ctx.from!.id, { denomination });
  await editWidget(
    ctx,
    `➕ <b>ДОБАВЛЕНИЕ КОДОВ (${denomination} R$)</b>\n━━━━━━━━━━━━━━━━\n\n` +
    `Отправь коды — каждый на новой строке:\n\n` +
    `<code>ABC123\nDEF456\nGHI789</code>\n\n` +
    `<i>Ожидаю ввод…</i>`,
    Markup.inlineKeyboard([[Markup.button.callback("⬅️ Отмена", CB.hubWildberries)]])
  );
  await ctx.answerCbQuery();
}

export async function handleCodesInput(ctx: Context, text: string): Promise<boolean> {
  const state = pendingCodesInput.get(ctx.from!.id);
  if (!state) return false;
  pendingCodesInput.delete(ctx.from!.id);

  const lines = text
    .split(/[\n,;]+/)
    .map((l) => l.trim().toUpperCase())
    .filter((l) => l.length >= 3 && l.length <= 30);

  if (lines.length === 0) {
    await ctx.reply("❌ Не удалось распознать коды. Каждый код — на отдельной строке.");
    return true;
  }

  // Check for duplicates in DB
  const existing = await (db as any).wbCode.findMany({
    where: { code: { in: lines } },
    select: { code: true },
  });
  const existingSet = new Set(existing.map((e: any) => e.code));
  const newCodes = lines.filter((c) => !existingSet.has(c));
  const dupeCount = lines.length - newCodes.length;

  if (newCodes.length === 0) {
    await ctx.reply(`⚠️ Все ${lines.length} кодов уже существуют в базе.`);
    return true;
  }

  // Bulk create
  await (db as any).wbCode.createMany({
    data: newCodes.map((code) => ({
      code,
      denomination: state.denomination,
    })),
    skipDuplicates: true,
  });

  let msg = `✅ Добавлено: <b>${newCodes.length}</b> кодов (${state.denomination} R$)`;
  if (dupeCount > 0) msg += `\n⚠️ Пропущено дубликатов: ${dupeCount}`;

  await ctx.reply(msg, { parse_mode: "HTML" });
  return true;
}

// ── Analytics ────────────────────────────────────────────────────────────────

export async function showAnalytics(ctx: Context): Promise<void> {
  const now = new Date();

  // Last 7 days histogram
  const days: string[] = [];
  const counts: number[] = [];

  for (let i = 6; i >= 0; i--) {
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    const count = await (db as any).wbCode.count({
      where: { isUsed: true, usedAt: { gte: dayStart, lt: dayEnd } },
    });

    const label = dayStart.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
    days.push(label);
    counts.push(count);
  }

  const maxCount = Math.max(...counts, 1);

  let chart = "";
  for (let i = 0; i < days.length; i++) {
    const barLen = Math.round((counts[i] / maxCount) * 10);
    const bar = "█".repeat(barLen) + "░".repeat(10 - barLen);
    chart += `${days[i]} ${bar} ${counts[i]}\n`;
  }

  const text =
    `📊 <b>АНАЛИТИКА АКТИВАЦИЙ (7 дней)</b>\n` +
    `━━━━━━━━━━━━━━━━\n\n` +
    `<code>${chart}</code>`;

  await editWidget(ctx, text, Markup.inlineKeyboard([
    [Markup.button.callback("⬅️ Назад", CB.hubWildberries)],
  ]));
  await ctx.answerCbQuery();
}

// ── Download unused codes ────────────────────────────────────────────────────

export async function downloadUnusedCodes(ctx: Context): Promise<void> {
  const codes = await (db as any).wbCode.findMany({
    where: { isUsed: false },
    orderBy: [{ denomination: "asc" }, { createdAt: "asc" }],
    select: { code: true, denomination: true },
  });

  if (codes.length === 0) {
    await ctx.answerCbQuery("Нет неиспользованных кодов");
    return;
  }

  let text = "";
  let currentDenom = 0;

  for (const c of codes) {
    if (c.denomination !== currentDenom) {
      currentDenom = c.denomination;
      text += `\n--- ${currentDenom} R$ ---\n`;
    }
    text += `${c.code}\n`;
  }

  // Send as a text message (not editable into the widget)
  await ctx.reply(
    `📥 <b>Неиспользованные коды (${codes.length}):</b>\n<code>${text.trim()}</code>`,
    { parse_mode: "HTML" }
  );
  await ctx.answerCbQuery();
}
