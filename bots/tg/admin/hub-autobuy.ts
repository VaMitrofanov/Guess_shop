/**
 * 🤖 AutoBuy Hub — manage auto-buy settings.
 * Bot writes autoBuyEnabled/autoBuyRate to GlobalSettings.
 * buyer.py on X280 polls DB every 60s and buys when conditions are met.
 */
import { Markup, type Context } from "telegraf";
import { db } from "../../shared/db";
import { CB } from "../../shared/admin";
import { sendOrEditWidget, editWidget } from "./widgets";
import { pendingAutoBuyRateInput } from "../session";

export async function showAutoBuyHub(ctx: Context): Promise<void> {
  const text = await buildAutoBuyText();
  await sendOrEditWidget(ctx, text, Markup.inlineKeyboard([
    [
      Markup.button.callback("🔄 Вкл/Выкл", CB.autoBuyToggle),
      Markup.button.callback("💰 Установить курс", CB.autoBuySetRate),
    ],
    [Markup.button.callback("🔄 Обновить", CB.autoBuyRefresh)],
  ]));
}

async function buildAutoBuyText(): Promise<string> {
  const [settings, pendingCount, bestRate] = await Promise.all([
    (db as any).globalSettings.findUnique({ where: { id: "global" } }),
    (db as any).wbOrder.count({ where: { status: "PENDING" } }),
    (db as any).marketRate.findFirst({
      orderBy: { rateUSD: "asc" },
      where: { inventory: { gt: 0 } },
    }),
  ]);

  const enabled = settings?.autoBuyEnabled ?? false;
  const rate    = settings?.autoBuyRate    ?? 4.0;

  const statusEmoji  = enabled ? "🟢" : "🔴";
  const conditionMet = bestRate && bestRate.rateUSD <= rate;
  const rateEmoji    = conditionMet ? "✅" : "⏳";

  return (
    `🤖 <b>АВТОБАЙ</b>\n` +
    `━━━━━━━━━━━━━━━━\n\n` +
    `${statusEmoji} Статус: <b>${enabled ? "ВКЛЮЧЁН" : "ВЫКЛЮЧЕН"}</b>\n` +
    `🎯 Целевой курс: <b>≤ $${rate}/1K R$</b>\n` +
    `${rateEmoji} Лучший сейчас: <b>${bestRate ? `$${bestRate.rateUSD} (${bestRate.provider})` : "нет данных"}</b>\n\n` +
    `📦 В очереди: <b>${pendingCount} заказов</b>\n\n` +
    `<i>buyer.py на X280 проверяет каждые 60 сек.\nВыкупает все PENDING заказы при срабатывании.</i>`
  );
}

export async function toggleAutoBuy(ctx: Context): Promise<void> {
  const settings = await (db as any).globalSettings.findUnique({ where: { id: "global" } });
  const newEnabled = !(settings?.autoBuyEnabled ?? false);
  await (db as any).globalSettings.upsert({
    where:  { id: "global" },
    update: { autoBuyEnabled: newEnabled },
    create: { id: "global", usdToRub: 90, autoBuyEnabled: newEnabled, autoBuyRate: 4.0 },
  });
  const text = await buildAutoBuyText();
  await editWidget(ctx, text, Markup.inlineKeyboard([
    [
      Markup.button.callback("🔄 Вкл/Выкл", CB.autoBuyToggle),
      Markup.button.callback("💰 Установить курс", CB.autoBuySetRate),
    ],
    [Markup.button.callback("🔄 Обновить", CB.autoBuyRefresh)],
  ]));
  await ctx.answerCbQuery(newEnabled ? "✅ Автобай включён" : "🔴 Автобай выключен");
}

export async function enterAutoBuyRateInput(ctx: Context): Promise<void> {
  pendingAutoBuyRateInput.set(ctx.from!.id, true);
  await ctx.answerCbQuery();
  await ctx.reply(
    "💰 Введи целевой курс для автобая\n(например: <b>3.8</b>)\n\nВыкуп запустится когда рыночный курс ≤ этого значения.",
    { parse_mode: "HTML" }
  );
}

export async function handleAutoBuyRateInput(ctx: Context, text: string): Promise<boolean> {
  if (!pendingAutoBuyRateInput.has(ctx.from!.id)) return false;
  const rate = parseFloat(text.replace(",", "."));
  if (isNaN(rate) || rate < 1 || rate > 20) {
    await ctx.reply("❌ Некорректное значение. Введи число от 1 до 20 (например: 3.8)");
    return true;
  }
  await (db as any).globalSettings.upsert({
    where:  { id: "global" },
    update: { autoBuyRate: rate },
    create: { id: "global", usdToRub: 90, autoBuyEnabled: false, autoBuyRate: rate },
  });
  pendingAutoBuyRateInput.delete(ctx.from!.id);
  await ctx.reply(`✅ Целевой курс: <b>≤ $${rate}/1K R$</b>`, { parse_mode: "HTML" });
  await showAutoBuyHub(ctx);
  return true;
}

export async function refreshAutoBuy(ctx: Context): Promise<void> {
  const text = await buildAutoBuyText();
  await editWidget(ctx, text, Markup.inlineKeyboard([
    [
      Markup.button.callback("🔄 Вкл/Выкл", CB.autoBuyToggle),
      Markup.button.callback("💰 Установить курс", CB.autoBuySetRate),
    ],
    [Markup.button.callback("🔄 Обновить", CB.autoBuyRefresh)],
  ]));
  await ctx.answerCbQuery("Обновлено");
}
