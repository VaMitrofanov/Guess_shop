import type { Telegraf } from "telegraf";
import { db } from "../shared/db";
import { ADMIN_IDS } from "../shared/admin";
import { adminTargets } from "../shared/admin-route";
import { formatAdminNotice, orderRef, orderStatusWord } from "../shared/notify-format";
import { escapeHtml, tgEdit, tgMessageId, tgSend } from "../shared/notify";
import { flagsOf, openFlags, type OrderFlag } from "../shared/order-flags";

/* ─────────────────────────────────────────────────────────────────────────────
   👁 «Под наблюдением» (15.11.2026, владелец: «папка-топик для таких клиентов,
   а то их даже не определишь никуда»).

   - `/watch КОД причина` — пометка WATCH на заказе (видна в TWA/на сайте как
     «👁 Под наблюдением»), `/unwatch КОД` — снять, `/watchlist` — список.
     Работают в беседах админов и в личке бота (только ADMIN_IDS).
   - Тема «Под наблюдением» в «Уведах»: закреплённый живой список заказов и
     раз в 5 минут — что нового сделал покупатель (чат WB, ник/пасс, обращения,
     статус заказа, заявка на возврат, отзыв).
   Курсоры — `WbSyncCursor` stream `watch-list`.
   ───────────────────────────────────────────────────────────────────────── */

const STREAM = "watch-list";
const isAdmin = (id: number | undefined) => id !== undefined && ADMIN_IDS.includes(String(id));

type WatchState = { rosterMessageId?: number | null; rosterChatKey?: string | null; seen: Record<string, string> };

async function loadState(): Promise<WatchState> {
  const row = await db.wbSyncCursor.findUnique({ where: { stream: STREAM } });
  const meta = (row?.metadata ?? {}) as Partial<WatchState>;
  return { rosterMessageId: meta.rosterMessageId ?? null, rosterChatKey: meta.rosterChatKey ?? null, seen: meta.seen ?? {} };
}

async function saveState(state: WatchState): Promise<void> {
  await db.wbSyncCursor.upsert({
    where: { stream: STREAM },
    create: { stream: STREAM, metadata: state as never },
    update: { metadata: state as never },
  });
}

const flaggedAtOf = (flags: OrderFlag[]) => {
  const open = flags.filter((f) => !f.ackAt).map((f) => new Date(f.at).getTime()).filter(Number.isFinite);
  return open.length ? new Date(Math.min(...open)) : null;
};

/** Поставить/снять наблюдение. Повторный /watch открывает погашенную пометку заново. */
async function setWatch(code: string, on: boolean, reason: string | null, actor: string): Promise<"ok" | "no_order" | "noop"> {
  const order = await db.wbOrder.findUnique({ where: { wbCode: code }, select: { id: true, flags: true } });
  if (!order) return "no_order";
  const flags = flagsOf(order);
  const current = flags.find((f) => f.kind === "WATCH");
  if (on) {
    const detail = reason ? reason.slice(0, 300) : current?.detail ?? null;
    if (current) { current.ackAt = null; current.ackBy = null; current.detail = detail; }
    else flags.push({ kind: "WATCH", detail, at: new Date().toISOString() });
  } else {
    if (!current || current.ackAt) return "noop";
    current.ackAt = new Date().toISOString();
    current.ackBy = actor;
  }
  await db.wbOrder.update({ where: { id: order.id }, data: { flags: flags as never, flaggedAt: flaggedAtOf(flags) } });
  return "ok";
}

type WatchedOrder = {
  id: string; wbCode: string | null; amount: number; status: string; heldAt: Date | null; flags: unknown; createdAt: Date;
  robloxUsername: string | null;
};

async function watchedOrders(): Promise<WatchedOrder[]> {
  const rows = await db.wbOrder.findMany({
    where: { flaggedAt: { not: null } },
    select: { id: true, wbCode: true, amount: true, status: true, heldAt: true, flags: true, createdAt: true, robloxUsername: true },
    take: 500,
  }) as WatchedOrder[];
  return rows.filter((o) => openFlags(o).some((f) => f.kind === "WATCH"));
}

function watchReason(order: WatchedOrder): string {
  return openFlags(order).find((f) => f.kind === "WATCH")?.detail ?? "";
}

function rosterText(orders: WatchedOrder[]): string {
  if (orders.length === 0) return "👀 <b>Под наблюдением — никого</b>\nПоставить: /watch КОД причина";
  const lines = orders.map((o) => {
    const reason = watchReason(o);
    return `• <code>${escapeHtml(o.wbCode ?? "")}</code> · ${o.amount} R$ · ${orderStatusWord(o.status)}${o.heldAt ? " · ❄️ заморожен" : ""}${reason ? ` — ${escapeHtml(reason)}` : ""}`;
  });
  return `👀 <b>Под наблюдением · ${orders.length}</b>\n${lines.join("\n")}\n\n<i>Снять: /unwatch КОД</i>`;
}

const NOISE = new Set(["GUIDE_OPENED", "ORDER_PIN", "ADMIN_CARD_ROOT"]);
const EVENT_WORD: Record<string, string> = {
  AUDIT_NICK_ENTERED: "ввёл ник",
  AUDIT_GAMEPASS_SUBMITTED: "прислал геймпасс",
  AUDIT_GAMEPASS_AUTOCREATED: "пасс создан по ключу",
  SUPPORT_REQUEST_DELIVERED: "написал в поддержку",
  ORDER_STATUS_CHANGED: "статус заказа изменился",
  BOT_NO_PLACE_HELP: "показали инструкцию по плейсу",
  BOT_DEAD_END: "застрял в боте",
  ROBUX_QUESTION_SELF_SERVED: "спросил, где робуксы",
};

function eventLine(type: string, payload: Record<string, unknown>): string {
  const word = EVENT_WORD[type] ?? type.toLowerCase();
  const extra = typeof payload.text === "string" ? `: «${payload.text.slice(0, 120)}»`
    : typeof payload.nick === "string" ? `: ${payload.nick}`
    : typeof payload.to === "string" ? `: ${orderStatusWord(payload.to)}`
    : "";
  return escapeHtml(`${word}${extra}`);
}

/** Раз в 5 минут: новые события по каждому заказу под наблюдением + живой список. */
async function sweep(bot: Telegraf): Promise<void> {
  const targets = await adminTargets("watch", { loud: true });
  const group = targets.find((t) => t.key.includes("#"));
  if (!group) return;
  const state = await loadState();
  const orders = await watchedOrders();

  for (const order of orders) {
    const since = new Date(state.seen[order.id] ?? Date.now() - 60 * 60 * 1000);
    const [events, chats] = await Promise.all([
      db.orderEvent.findMany({ where: { orderId: order.id, createdAt: { gt: since } }, orderBy: { createdAt: "asc" }, take: 20, select: { type: true, payload: true, createdAt: true } }),
      db.wbBuyerChatEvent.findMany({
        where: { sender: "client", sentAt: { gt: since }, marketplaceOrder: { wbCode: { code: order.wbCode ?? "" } } },
        orderBy: { sentAt: "asc" }, take: 20, select: { textRedacted: true, sentAt: true },
      }).catch(() => [] as { textRedacted: string | null; sentAt: Date }[]),
    ]);
    const lines = [
      ...chats.filter((c) => c.textRedacted).map((c) => ({ at: c.sentAt, text: `💬 в чат WB: «${escapeHtml((c.textRedacted ?? "").slice(0, 160))}»` })),
      ...events.filter((e) => !NOISE.has(e.type)).map((e) => ({ at: e.createdAt, text: `• ${eventLine(e.type, (e.payload ?? {}) as Record<string, unknown>)}` })),
    ].sort((a, b) => a.at.getTime() - b.at.getTime());
    const latest = [...events.map((e) => e.createdAt), ...chats.map((c) => c.sentAt)].sort((a, b) => b.getTime() - a.getTime())[0];
    if (latest) state.seen[order.id] = latest.toISOString();
    else if (!state.seen[order.id]) state.seen[order.id] = new Date().toISOString();
    if (lines.length === 0) continue;
    const text = formatAdminNotice({
      marker: "waiting",
      zone: "ПОДДЕРЖКА",
      title: "под наблюдением — новое",
      lines: [orderRef({ code: order.wbCode, denomination: order.amount }, [order.heldAt ? "❄️ заморожен" : orderStatusWord(order.status)]), ...lines.map((l) => l.text)],
    });
    await tgSend(group.chatId, text, { parse_mode: "HTML", ...group.extra });
  }

  // Живой список — одно закреплённое сообщение, правится на месте.
  const roster = rosterText(orders);
  let messageId = state.rosterChatKey === group.key ? state.rosterMessageId ?? null : null;
  if (!messageId || !(await tgEdit(group.chatId, messageId, roster, { parse_mode: "HTML" }))) {
    messageId = tgMessageId(await tgSend(group.chatId, roster, { parse_mode: "HTML", ...group.extra, disable_notification: true }));
    if (messageId) await bot.telegram.pinChatMessage(group.chatId, messageId, { disable_notification: true }).catch(() => undefined);
  }
  state.rosterMessageId = messageId;
  state.rosterChatKey = group.key;
  for (const id of Object.keys(state.seen)) if (!orders.some((o) => o.id === id)) delete state.seen[id];
  await saveState(state);
}

export function registerWatchList(bot: Telegraf): void {
  bot.command("watch", async (ctx) => {
    if (!isAdmin(ctx.from?.id)) return;
    const [, codeRaw, ...rest] = ctx.message.text.trim().split(/\s+/);
    const code = (codeRaw ?? "").toUpperCase();
    if (!/^[A-Z0-9-]{5,20}$/.test(code)) { await ctx.reply("Формат: /watch КОД причина — например /watch Z9PZWAJ 1★ отзыв и возврат"); return; }
    const actor = ctx.from.username ? `@${ctx.from.username}` : String(ctx.from.id);
    const result = await setWatch(code, true, rest.join(" ").trim() || null, actor);
    await ctx.reply(result === "no_order" ? `Заказа ${code} нет.` : `👁 ${code} под наблюдением — всё по нему пойдёт в тему «Под наблюдением».`);
    void sweep(bot).catch(() => undefined);
  });
  bot.command("unwatch", async (ctx) => {
    if (!isAdmin(ctx.from?.id)) return;
    const code = (ctx.message.text.trim().split(/\s+/)[1] ?? "").toUpperCase();
    const actor = ctx.from.username ? `@${ctx.from.username}` : String(ctx.from.id);
    const result = await setWatch(code, false, null, actor);
    await ctx.reply(result === "ok" ? `Снято: ${code} больше не под наблюдением.` : result === "no_order" ? `Заказа ${code} нет.` : `${code} и так не под наблюдением.`);
    void sweep(bot).catch(() => undefined);
  });
  bot.command("watchlist", async (ctx) => {
    if (!isAdmin(ctx.from?.id)) return;
    await ctx.reply(rosterText(await watchedOrders()), { parse_mode: "HTML" });
  });
  if (process.env.NODE_ENV !== "test") {
    setTimeout(() => { void sweep(bot).catch((e) => console.warn("[watch-list]", (e as Error)?.message)); }, 90_000);
    setInterval(() => { void sweep(bot).catch((e) => console.warn("[watch-list]", (e as Error)?.message)); }, 5 * 60_000);
  }
}
