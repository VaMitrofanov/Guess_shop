/**
 * 🤖 AutoBuy Hub — manage auto-buy settings + Boss Robux LK.
 *
 * AutoBuy: bot writes autoBuyEnabled/autoBuyRate to GlobalSettings.
 * buyer.py on X280 polls DB every 60s and buys when conditions are met.
 *
 * Boss Robux: direct purchase via bossrobux.com API.
 * Admin searches gamepass by name, verifies details, confirms purchase.
 */
import { Markup, type Context } from "telegraf";
import { db } from "../../shared/db";
import { CB } from "../../shared/admin";
import { sendOrEditWidget, editWidget } from "./widgets";
import { pendingAutoBuyRateInput, pendingBossrobuxSearch, bossrobuxSearchCache } from "../session";
import { getRate, searchGamepass, purchaseGamepass, type BossrobuxGamepass } from "../../shared/bossrobux";

// ── AutoBuy main widget ───────────────────────────────────────────────────────

export async function showAutoBuyHub(ctx: Context): Promise<void> {
  const text = await buildAutoBuyText();
  await sendOrEditWidget(ctx, text, buildAutoBuyKeyboard());
}

function buildAutoBuyKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("🔄 Вкл/Выкл", CB.autoBuyToggle),
      Markup.button.callback("💰 Установить курс", CB.autoBuySetRate),
    ],
    [Markup.button.callback("🔍 Выкупить ГП (Boss)", CB.bossrobuxSearch)],
    [Markup.button.callback("🔄 Обновить", CB.autoBuyRefresh)],
  ]);
}

async function buildAutoBuyText(): Promise<string> {
  const [settings, pendingCount, bestRate, bossRate] = await Promise.all([
    (db as any).globalSettings.findUnique({ where: { id: "global" } }),
    (db as any).wbOrder.count({ where: { status: "PENDING" } }),
    (db as any).marketRate.findFirst({
      orderBy: { rateUSD: "asc" },
      where: { inventory: { gt: 0 } },
    }),
    getRate(),
  ]);

  const enabled      = settings?.autoBuyEnabled ?? false;
  const rate         = settings?.autoBuyRate    ?? 4.0;
  const statusEmoji  = enabled ? "🟢" : "🔴";
  const conditionMet = bestRate && bestRate.rateUSD <= rate;
  const rateEmoji    = conditionMet ? "✅" : "⏳";

  const autobuyBlock =
    `🤖 <b>АВТОБАЙ</b>\n` +
    `━━━━━━━━━━━━━━━━\n\n` +
    `${statusEmoji} Статус: <b>${enabled ? "ВКЛЮЧЁН" : "ВЫКЛЮЧЕН"}</b>\n` +
    `🎯 Целевой курс: <b>≤ $${rate}/1K R$</b>\n` +
    `${rateEmoji} Лучший сейчас: <b>${bestRate ? `$${bestRate.rateUSD} (${bestRate.provider})` : "нет данных"}</b>\n\n` +
    `📦 В очереди: <b>${pendingCount} заказов</b>\n\n` +
    `<i>buyer.py на X280 проверяет каждые 60 сек.</i>`;

  let bossBlock: string;
  if (!bossRate) {
    bossBlock = `\n\n🛒 <b>BOSS ROBUX ЛК</b>\n───────────────\n⚠️ Нет соединения с API`;
  } else {
    bossBlock =
      `\n\n🛒 <b>BOSS ROBUX ЛК</b>\n` +
      `───────────────\n` +
      `💰 Курс: <b>${bossRate.rate}</b> / R$\n` +
      `📦 Доступно: <b>${bossRate.robux_total} R$</b>\n` +
      `🔢 Макс/ордер: <b>${bossRate.robux_max} R$</b>`;
  }

  return autobuyBlock + bossBlock;
}

export async function toggleAutoBuy(ctx: Context): Promise<void> {
  const settings   = await (db as any).globalSettings.findUnique({ where: { id: "global" } });
  const newEnabled = !(settings?.autoBuyEnabled ?? false);
  await (db as any).globalSettings.upsert({
    where:  { id: "global" },
    update: { autoBuyEnabled: newEnabled },
    create: { id: "global", usdToRub: 90, autoBuyEnabled: newEnabled, autoBuyRate: 4.0 },
  });
  const text = await buildAutoBuyText();
  await editWidget(ctx, text, buildAutoBuyKeyboard());
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
  await editWidget(ctx, text, buildAutoBuyKeyboard());
  await ctx.answerCbQuery("Обновлено");
}

// ── Boss Robux: search ────────────────────────────────────────────────────────

export async function enterBossrobuxSearch(ctx: Context): Promise<void> {
  pendingBossrobuxSearch.set(ctx.from!.id, true);
  await ctx.answerCbQuery();
  await ctx.reply(
    "🔍 <b>Выкуп через Boss Robux</b>\n\n" +
    "Введи <b>Roblox-ник клиента</b> (он указан в карточке заказа как «Создатель ГП»).\n\n" +
    "<i>Бот найдёт все геймпассы этого пользователя на bossrobux и покажет для выбора.</i>",
    { parse_mode: "HTML" }
  );
}

export async function handleBossrobuxSearchInput(ctx: Context, name: string): Promise<boolean> {
  if (!pendingBossrobuxSearch.has(ctx.from!.id)) return false;
  pendingBossrobuxSearch.delete(ctx.from!.id);

  const results = await searchGamepass(name.trim());

  if ("error" in results) {
    await ctx.reply(
      `❌ <b>Ошибка поиска:</b> ${esc(results.error)}`,
      { parse_mode: "HTML" }
    );
    return true;
  }

  if (results.length === 0) {
    await ctx.reply(
      `🔍 Ничего не найдено по запросу: <b>${esc(name)}</b>`,
      { parse_mode: "HTML" }
    );
    return true;
  }

  bossrobuxSearchCache.set(ctx.from!.id, results);

  const visible = results.slice(0, 5);
  let text = `🔍 <b>Геймпассы пользователя</b> <code>${esc(name)}</code>:\n\n`;
  visible.forEach((gp, i) => {
    text +=
      `<b>#${i + 1}</b> ${esc(gp.name)}\n` +
      `   💎 <b>${gp.robux} R$</b>  ·  👤 ${esc(gp.sellerName)}\n` +
      `   🆔 GP: <code>${gp.gamepassId}</code>  Place: <code>${gp.placeId}</code>\n\n`;
  });
  if (results.length > 5) text += `<i>Показаны первые 5 из ${results.length}</i>\n`;

  const buttons = visible.map((gp, i) => [
    Markup.button.callback(
      `#${i + 1} · ${gp.robux} R$ · @${gp.sellerName}`,
      CB.bossrobuxBuy(i)
    ),
  ]);
  buttons.push([Markup.button.callback("⬅️ Назад", CB.hubAutoBuy)]);

  await ctx.reply(text, {
    parse_mode: "HTML",
    ...Markup.inlineKeyboard(buttons),
  });

  return true;
}

// ── Boss Robux: buy confirmation ──────────────────────────────────────────────

export async function handleBossrobuxBuy(ctx: Context, index: number): Promise<void> {
  const results = bossrobuxSearchCache.get(ctx.from!.id);
  if (!results || index >= results.length) {
    await ctx.answerCbQuery("❌ Результаты устарели — поищи снова");
    return;
  }

  const gp = results[index];
  const text =
    `⚠️ <b>Подтверди выкуп</b>\n\n` +
    `📌 Геймпасс: <b>${esc(gp.name)}</b>\n` +
    `💎 Сумма: <b>${gp.robux} R$</b>\n` +
    `👤 Продавец: @${esc(gp.sellerName)}\n` +
    `🆔 GamepassID: <code>${gp.gamepassId}</code>\n` +
    `🆔 PlaceID: <code>${gp.placeId}</code>\n` +
    `🆔 ProductID: <code>${gp.productId}</code>\n\n` +
    `Убедись что это нужный геймпасс, затем нажми ✅.`;

  try {
    await ctx.editMessageText(text, {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("✅ Выкупить", CB.bossrobuxConfirm(index))],
        [Markup.button.callback("⬅️ Назад", CB.hubAutoBuy)],
      ]),
    });
  } catch {
    await ctx.reply(text, {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("✅ Выкупить", CB.bossrobuxConfirm(index))],
        [Markup.button.callback("⬅️ Назад", CB.hubAutoBuy)],
      ]),
    });
  }
  await ctx.answerCbQuery();
}

// ── Boss Robux: confirm purchase ──────────────────────────────────────────────

export async function handleBossrobuxConfirm(ctx: Context, index: number): Promise<void> {
  const results = bossrobuxSearchCache.get(ctx.from!.id);
  if (!results || index >= results.length) {
    await ctx.answerCbQuery("❌ Результаты устарели");
    return;
  }

  const gp = results[index];
  await ctx.answerCbQuery("⏳ Выкупаю...");

  const result = await purchaseGamepass(gp);

  if (result.success) {
    bossrobuxSearchCache.delete(ctx.from!.id);
    try {
      await ctx.editMessageText(
        `✅ <b>Выкуп успешен!</b>\n\n` +
        `📌 ${esc(gp.name)}\n` +
        `💎 ${gp.robux} R$\n\n` +
        `📋 ${esc(result.msg)}`,
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([[Markup.button.callback("⬅️ В меню", CB.hubAutoBuy)]]),
        }
      );
    } catch {
      await ctx.reply(`✅ Выкуп успешен! ${gp.robux} R$ — ${result.msg}`);
    }
  } else {
    try {
      await ctx.editMessageText(
        `❌ <b>Ошибка выкупа</b>\n\n${esc(result.msg)}`,
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([
            [Markup.button.callback("🔄 Попробовать снова", CB.bossrobuxBuy(index))],
            [Markup.button.callback("⬅️ В меню", CB.hubAutoBuy)],
          ]),
        }
      );
    } catch {
      await ctx.reply(`❌ Ошибка выкупа: ${result.msg}`);
    }
  }
}

// ── Util ──────────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
