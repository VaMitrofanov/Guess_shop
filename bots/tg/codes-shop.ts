import { Markup, type Context, type Telegraf } from "telegraf";
import { db } from "../shared/db";
import { ADMIN_IDS } from "../shared/admin";
import {
  CODES_CB,
  CODES_MENU_BTN,
  CODES_PICK_RE,
  codePickScreen,
  codesStoreScreen,
  inviteScreen,
  parseReferralStart,
  REFERRAL_START_PREFIX,
  type CodesButton,
  type CodesScreen,
} from "../shared/codes-shop";
import { botAttachReferral, botCodeOrder, botCodesView, botOrderKey, codesTick, siteUrl } from "../shared/codes-bot-api";
import { storeReviews } from "../shared/wb-reviews-feed";
import { fetchGateFeedbacks } from "../shared/wb-delivery-api";

/* ─────────────────────────────────────────────────────────────────────────────
   🎟 Коды Roblox и приглашения в Telegram-боте (15.11.2026).

   Регистрируется в `bot.ts` ДО `registerStart`/`registerText`: перехватывает
   только своё (кнопки нижнего меню, /codes, /invite, callback `codes*`,
   `/start r_<код>`), всё остальное отдаёт дальше через `next()`.

   Плюс два фоновых дела, которым нужен TG-хост:
   - тик кодов раз в минуту (отложенные подарки, недоставленные сообщения);
   - лента отзывов WB для сайта раз в час (`WB_API_TOKEN` живёт здесь).
   ───────────────────────────────────────────────────────────────────────── */

const BOT_USERNAME = "RobloxBankBot";

function keyboard(rows: CodesButton[][]) {
  return Markup.inlineKeyboard(rows.map((row) => row.map((button) => (button.url
    ? Markup.button.url(button.label, button.url)
    : Markup.button.callback(button.label, button.command ?? CODES_CB.open)))));
}

async function show(ctx: Context, screen: CodesScreen, edit: boolean) {
  const extra = { parse_mode: "HTML" as const, link_preview_options: { is_disabled: true }, ...keyboard(screen.rows) };
  if (edit) {
    try {
      await ctx.editMessageText(screen.html, extra);
      return;
    } catch (error) {
      // «message is not modified» — тот же экран, это успех.
      if (String((error as Error)?.message ?? "").includes("not modified")) return;
    }
  }
  await ctx.reply(screen.html, extra);
}

async function sorry(ctx: Context, text = "Не получилось загрузить витрину кодов. Попробуй через минуту или напиши @RobloxBank_PA.") {
  await ctx.reply(text, { link_preview_options: { is_disabled: true } });
}

export async function openCodesStore(ctx: Context, edit = false): Promise<void> {
  const tgId = String(ctx.from?.id ?? "");
  if (!tgId) return;
  const view = await botCodesView("TG", tgId).catch(() => null);
  if (!view?.ok) return sorry(ctx);
  await show(ctx, codesStoreScreen(view, siteUrl()), edit);
}

export async function openInvite(ctx: Context, edit = false): Promise<void> {
  const tgId = String(ctx.from?.id ?? "");
  if (!tgId) return;
  const view = await botCodesView("TG", tgId).catch(() => null);
  if (!view?.ok) return sorry(ctx);
  await show(ctx, inviteScreen({
    invitedCount: view.invitedCount,
    discountPercent: view.discountPercent,
    siteLink: view.siteLink,
    botLink: `https://t.me/${BOT_USERNAME}?start=${REFERRAL_START_PREFIX}${view.referralCode}`,
  }), edit);
}

async function pick(ctx: Context, denomination: number): Promise<void> {
  const tgId = String(ctx.from?.id ?? "");
  const order = await botCodeOrder("TG", tgId, denomination, botOrderKey("TG", tgId, denomination)).catch(() => null);
  if (!order) return sorry(ctx);
  if (!order.ok) {
    await ctx.reply(order.code === "SALES_CLOSED"
      ? "⏳ Продажа кодов откроется совсем скоро — цены уже в витрине. Пока можно купить Robux через геймпасс: «💎 Купить напрямую»."
      : `⚠️ ${order.error ?? "Не получилось оформить заказ."}`);
    return;
  }
  await show(ctx, codePickScreen({
    denomination: order.denomination,
    discountPercent: order.discountPercent,
    instant: order.instant,
    payUrl: order.payUrl,
    shareUrl: order.payUrl,
    publicId: order.publicId,
  }), true);
}

export function registerCodesShop(bot: Telegraf): void {
  // /start r_<код> — приглашение. Привязка только НОВОМУ профилю (правило сайта),
  // дальше человек видит витрину кодов, а не общий велком.
  bot.start(async (ctx, next) => {
    // `?start=codes` — кнопка «Коды в боте» из поста в канале.
    if ((ctx.startPayload ?? "").trim().toLowerCase() === "codes") return openCodesStore(ctx);
    const code = parseReferralStart(ctx.startPayload);
    if (!code) return next();
    const tgId = String(ctx.from.id);
    const result = await botAttachReferral("TG", tgId, code).catch(() => null);
    if (result === "attached") {
      await ctx.reply("🤝 Тебя пригласил друг — добро пожаловать! Ниже коды Roblox: Robux сразу на баланс, а со скидкой 1% — уже сейчас.");
    }
    await openCodesStore(ctx);
  });

  bot.command("codes", (ctx) => openCodesStore(ctx));
  bot.command("invite", (ctx) => openInvite(ctx));

  bot.hears(CODES_MENU_BTN.codes, (ctx) => openCodesStore(ctx));
  bot.hears(CODES_MENU_BTN.invite, (ctx) => openInvite(ctx));

  bot.action(CODES_CB.open, async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    await openCodesStore(ctx, true);
  });
  bot.action(CODES_CB.invite, async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    await openInvite(ctx, true);
  });
  bot.action(CODES_PICK_RE, async (ctx) => {
    await ctx.answerCbQuery("Собираю заказ…").catch(() => undefined);
    await pick(ctx, Number(ctx.match[1]));
  });

  // ⭐ Скрыть отзыв с витрины сайта — только админы.
  bot.command("review_hide", async (ctx) => {
    if (!ADMIN_IDS.includes(String(ctx.from.id))) return;
    const id = ctx.message.text.split(/\s+/)[1]?.trim();
    if (!id) {
      const last = await db.wbReview.findMany({ where: { eligible: true, hidden: false }, orderBy: { wbCreatedAt: "desc" }, take: 10 });
      await ctx.reply(last.length
        ? `На витрине сейчас (новые сверху):\n\n${last.map((review) => `${review.id} · ${review.authorName}: ${review.text.slice(0, 80)}`).join("\n\n")}\n\nСкрыть: /review_hide <id>`
        : "На витрине пока нет отзывов.");
      return;
    }
    const updated = await db.wbReview.updateMany({ where: { id }, data: { hidden: true } });
    await ctx.reply(updated.count ? `🙈 Отзыв ${id} скрыт с сайта (обновится в течение минуты). Вернуть: /review_show ${id}` : "Такого отзыва нет.");
  });
  bot.command("review_show", async (ctx) => {
    if (!ADMIN_IDS.includes(String(ctx.from.id))) return;
    const id = ctx.message.text.split(/\s+/)[1]?.trim();
    if (!id) return;
    const updated = await db.wbReview.updateMany({ where: { id }, data: { hidden: false } });
    await ctx.reply(updated.count ? `👀 Отзыв ${id} снова на сайте.` : "Такого отзыва нет.");
  });

  startCodesWorkers();
}

let workersStarted = false;

function startCodesWorkers(): void {
  if (workersStarted || process.env.NODE_ENV === "test") return;
  workersStarted = true;

  // Тик кодов: отложенные подарки и сообщения в чат, не ушедшие с первого раза.
  const tick = async () => {
    try {
      await codesTick();
    } catch (error) {
      console.warn("[codes-tick]", (error as Error)?.message);
    }
  };
  setTimeout(tick, 30_000);
  setInterval(tick, 60_000);

  // Лента отзывов WB для витрины — раз в час, первый прогон через 2 минуты после старта.
  const reviews = async () => {
    if (!process.env.WB_API_TOKEN) return;
    try {
      const { feedbacks } = await fetchGateFeedbacks();
      const result = await storeReviews(db as never, feedbacks);
      console.log(`[wb-reviews-feed] сохранено ${result.stored}, на витрину ${result.eligible}`);
    } catch (error) {
      console.warn("[wb-reviews-feed]", (error as Error)?.message);
    }
  };
  setTimeout(reviews, 2 * 60_000);
  setInterval(reviews, 60 * 60_000);
}
