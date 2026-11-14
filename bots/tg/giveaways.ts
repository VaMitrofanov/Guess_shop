import { Markup, type Telegraf } from "telegraf";
import { db } from "../shared/db";
import { ADMIN_IDS } from "../shared/admin";
import { adminTargets } from "../shared/admin-route";
import { formatAdminNotice } from "../shared/notify-format";
import { tgSend } from "../shared/notify";
import {
  GIVEAWAY_CB,
  GIVEAWAY_DEFAULT_PRIZE,
  GIVEAWAY_JOIN_RE,
  GIVEAWAY_STREAM,
  giveawayButtonLabel,
  giveawayPostText,
  giveawayResultText,
  joinGiveaway,
  newGiveawayId,
  pickWinner,
  type Giveaway,
  type GiveawayState,
} from "../shared/giveaway";

/* 🎁 Розыгрыши в TG-канале — Telegram и база (логика — `bots/shared/giveaway.ts`).
   Команды — в личке бота, только админам:
     /giveaway 48 [номинал]  — запустить (часы до итогов, приз по умолчанию 100 R$)
     /giveaway               — статус текущего
     /giveaway_cancel        — отменить текущий */

const CODE_PRIZES = [100, 200, 800];

async function load(): Promise<GiveawayState> {
  const row = await db.wbSyncCursor.findUnique({ where: { stream: GIVEAWAY_STREAM } });
  const meta = (row?.metadata ?? null) as GiveawayState | null;
  return { active: meta?.active ?? null, history: meta?.history ?? [] };
}

async function save(state: GiveawayState): Promise<void> {
  await db.wbSyncCursor.upsert({
    where: { stream: GIVEAWAY_STREAM },
    create: { stream: GIVEAWAY_STREAM, metadata: state as never },
    update: { metadata: state as never },
  });
}

/** Изменения состояния — строго по одному: нажатия сыплются одновременно. */
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => undefined);
  return next;
}

async function isSubscribed(bot: Telegraf, channel: string, tgId: string): Promise<boolean> {
  try {
    const member = await bot.telegram.getChatMember(channel, Number(tgId));
    return ["member", "administrator", "creator", "restricted"].includes(member.status);
  } catch {
    return false;
  }
}

const isAdmin = (id: number | undefined) => id !== undefined && ADMIN_IDS.includes(String(id));

function joinKeyboard(g: Giveaway) {
  return Markup.inlineKeyboard([[Markup.button.callback(giveawayButtonLabel(g), GIVEAWAY_CB.join(g.id))]]);
}

const buttonRefresh = new Map<string, NodeJS.Timeout>();

export function registerGiveaways(bot: Telegraf): void {
  const channel = process.env.TG_CHANNEL_ID;

  bot.command("giveaway", async (ctx) => {
    if (ctx.chat.type !== "private" || !isAdmin(ctx.from.id)) return;
    const [, hoursRaw, prizeRaw] = ctx.message.text.trim().split(/\s+/);
    const state = await load();
    if (!hoursRaw) {
      const g = state.active;
      await ctx.reply(g
        ? `🎁 Идёт розыгрыш кода ${g.prize} R$: ${g.participants.length} участников, итоги ${new Date(g.endsAt).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })} МСК.\nОтменить: /giveaway_cancel`
        : "Розыгрыша сейчас нет. Запустить: /giveaway 48 — итоги через 48 часов, приз код 100 R$ (можно /giveaway 48 200).");
      return;
    }
    if (!channel) { await ctx.reply("TG_CHANNEL_ID не задан — некуда постить."); return; }
    if (state.active) { await ctx.reply("Уже идёт розыгрыш — сначала дождись итогов или /giveaway_cancel."); return; }
    const hours = Number(hoursRaw);
    const prize = prizeRaw ? Number(prizeRaw) : GIVEAWAY_DEFAULT_PRIZE;
    if (!Number.isFinite(hours) || hours < 1 || hours > 24 * 14) { await ctx.reply("Часы — от 1 до 336. Пример: /giveaway 48"); return; }
    if (!CODE_PRIZES.includes(prize)) { await ctx.reply(`Приз — номинал кода: ${CODE_PRIZES.join(", ")}.`); return; }
    const now = new Date();
    const g: Giveaway = {
      id: newGiveawayId(), prize, createdAt: now.toISOString(), endsAt: new Date(now.getTime() + hours * 3_600_000).toISOString(),
      createdBy: ctx.from.username ? `@${ctx.from.username}` : String(ctx.from.id), channelMessageId: null, participants: [], status: "active",
    };
    const sent = await bot.telegram.sendMessage(channel, giveawayPostText(g), { parse_mode: "HTML", ...joinKeyboard(g) });
    g.channelMessageId = sent.message_id;
    await serial(async () => save({ ...(await load()), active: g }));
    await ctx.reply(`✅ Розыгрыш запущен: код ${prize} R$, итоги через ${hours} ч. Пост в канале — с кнопкой «Участвовать».`);
  });

  bot.command("giveaway_cancel", async (ctx) => {
    if (ctx.chat.type !== "private" || !isAdmin(ctx.from.id)) return;
    const done = await serial(async () => {
      const state = await load();
      if (!state.active) return null;
      const g = { ...state.active, status: "cancelled" as const };
      await save({ active: null, history: [g, ...state.history].slice(0, 20) });
      return g;
    });
    if (!done) { await ctx.reply("Розыгрыша сейчас нет."); return; }
    if (channel && done.channelMessageId) {
      await bot.telegram.editMessageText(channel, done.channelMessageId, undefined, `${giveawayPostText(done)}\n\n<b>Розыгрыш отменён.</b>`, { parse_mode: "HTML" }).catch(() => undefined);
    }
    await ctx.reply("Отменён.");
  });

  bot.action(GIVEAWAY_JOIN_RE, async (ctx) => {
    const id = (ctx.match as RegExpExecArray)[1];
    const tgId = String(ctx.from?.id ?? "");
    if (!channel || !tgId) { await ctx.answerCbQuery().catch(() => undefined); return; }
    if (!(await isSubscribed(bot, channel, tgId))) {
      await ctx.answerCbQuery("Сначала подпишись на канал — и нажми ещё раз 💜", { show_alert: true }).catch(() => undefined);
      return;
    }
    const name = [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(" ") || (ctx.from?.username ? `@${ctx.from.username}` : "Участник");
    const result = await serial(async () => {
      const state = await load();
      if (!state.active || state.active.id !== id) return { status: "over" as const };
      const joined = joinGiveaway(state.active, { tgId, name });
      if (!joined.added) return { status: "already" as const, g: state.active };
      await save({ ...state, active: joined.giveaway });
      return { status: "added" as const, g: joined.giveaway };
    });
    if (result.status === "over") { await ctx.answerCbQuery("Этот розыгрыш уже закончился").catch(() => undefined); return; }
    await ctx.answerCbQuery(result.status === "added" ? "🎉 Ты участвуешь! Итоги — в канале" : "Ты уже участвуешь 💜").catch(() => undefined);
    // Счётчик на кнопке — не чаще раза в 20 секунд (лимиты Telegram на правки).
    if (result.status === "added" && result.g.channelMessageId && !buttonRefresh.has(id)) {
      buttonRefresh.set(id, setTimeout(async () => {
        buttonRefresh.delete(id);
        const fresh = (await load()).active;
        if (fresh?.id === id && fresh.channelMessageId) {
          await bot.telegram.editMessageReplyMarkup(channel, fresh.channelMessageId, undefined, joinKeyboard(fresh).reply_markup).catch(() => undefined);
        }
      }, 20_000));
    }
  });

  // Итоги — проверка раз в минуту.
  if (process.env.NODE_ENV !== "test") {
    setInterval(() => { void finishIfDue(bot).catch((error) => console.warn("[giveaway]", (error as Error)?.message)); }, 60_000);
  }
}

async function finishIfDue(bot: Telegraf): Promise<void> {
  const channel = process.env.TG_CHANNEL_ID;
  const state = await load();
  const g = state.active;
  if (!g || !channel || new Date(g.endsAt).getTime() > Date.now()) return;
  const winner = await pickWinner(g, (tgId) => isSubscribed(bot, channel, tgId));
  const finished: Giveaway = { ...g, status: "finished", winner };
  await serial(async () => {
    const fresh = await load();
    if (fresh.active?.id !== g.id) return;
    await save({ active: null, history: [finished, ...fresh.history].slice(0, 20) });
  });
  if (g.channelMessageId) {
    await bot.telegram.editMessageText(channel, g.channelMessageId, undefined, `${giveawayPostText(finished)}\n\n✅ <b>Розыгрыш завершён</b> — итоги ниже.`, { parse_mode: "HTML" }).catch(() => undefined);
  }
  await bot.telegram.sendMessage(channel, giveawayResultText(finished), {
    parse_mode: "HTML",
    ...(g.channelMessageId ? { reply_parameters: { message_id: g.channelMessageId } } : {}),
  }).catch(() => undefined);

  let dm = false;
  if (winner) {
    dm = await bot.telegram.sendMessage(Number(winner.tgId),
      `🎉 <b>Ты выиграл код Roblox на ${g.prize} Robux!</b>\n\nПоздравляем! Код пришлём сюда в ближайшее время. Активировать: roblox.com/redeem.`,
      { parse_mode: "HTML" }).then(() => true).catch(() => false);
  }
  const text = formatAdminNotice({
    marker: winner ? "action" : "waiting",
    zone: "ПОДДЕРЖКА",
    title: winner ? `розыгрыш: выдать код ${g.prize} R$` : "розыгрыш: победителя нет",
    lines: winner
      ? [`🏆 ${winner.name} · tg <code>${winner.tgId}</code> · <a href="tg://user?id=${winner.tgId}">написать</a>`,
        `Участников: ${g.participants.length}`,
        dm ? "Победителю написали в бот." : "⚠️ Бот не смог написать победителю (не запускал бота) — написать с @RobloxBank_PA."]
      : [`Участников: ${g.participants.length} — подписанных среди проверенных не нашлось.`],
    next: winner ? "отправить код победителю с @RobloxBank_PA (или в бот)" : null,
  });
  const targets = await adminTargets("action", { loud: Boolean(winner) });
  await Promise.allSettled(targets.map((t) => tgSend(t.chatId, text, { parse_mode: "HTML", ...t.extra })));
}
