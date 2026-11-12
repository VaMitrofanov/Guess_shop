/* ─────────────────────────────────────────────────────────────────────────────
   Беседа админов: порядок, «руки проекта» и утренняя сводка (12.11.2026).

   1. Защита. Бот стал админом беседы и видит в ней ВСЕ сообщения, а обычные
      обработчики бота не различают личку и группу — ответили бы на сообщения
      админов как покупателям. Поэтому в группах дальше этого модуля ничего
      не проходит: только команды поддержки, кнопки карточек и ассистент.
   2. Ассистент. Обращение к боту (@RobloxBankBot …, ответ на его сообщение или
      любое сообщение в теме «🤖 Ассистент») → Claude Haiku 5.5 с инструментами
      ТОЛЬКО на чтение базы: заказ по коду, поиск, очередь, цифры, риски.
   3. Порядок. `/support_setup` в беседе с включёнными темами создаёт темы
      «🆘 Поддержка», «🧪 Тест ИИ», «📊 Сводки», «🤖 Ассистент», закрепляет
      памятку и разводит карточки по темам.
   4. Сводка. Каждый день в 09:00 МСК — итоги вчера и что горит сейчас, в тему
      «📊 Сводки». По запросу — `/digest`.
   ───────────────────────────────────────────────────────────────────────── */

import Anthropic from "@anthropic-ai/sdk";
import type { Telegraf } from "telegraf";
import { db } from "../shared/db";
import { ADMIN_IDS } from "../shared/admin";
import { flagsOf } from "../shared/order-flags";
import { profileText, recentBadReviewsWithBuyers, whoIs } from "../shared/buyer-identity";
import { PA_AI_MODEL, plain } from "../shared/pa-ai-support";
import { card, loadSettings, saveSettings, type PaTopic } from "./pa-ai";

const isAdmin = (id: number | undefined) => id !== undefined && ADMIN_IDS.map(String).includes(String(id));
const MSK = 3 * 3600_000;
const DAY = 86_400_000;
const STATUS_RU: Record<string, string> = {
  PAYMENT_PENDING: "ждёт оплату", AWAITING_GAMEPASS: "ждём пасс", PENDING: "к выкупу",
  IN_PROGRESS: "выкупается", COMPLETED: "выкуплен", REJECTED: "отменён", ERROR: "ошибка выкупа",
};

let client: Anthropic | null = null;
const anthropic = () => (client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!.trim(), maxRetries: 1, timeout: 60_000 }));

/** Начало суток по Москве (UTC-время), со сдвигом в днях. */
function mskDayStart(offsetDays = 0, now = Date.now()): Date {
  const msk = now + MSK;
  return new Date(msk - (msk % DAY) - MSK + offsetDays * DAY);
}

// ── Инструменты ассистента (только чтение) ───────────────────────────────────

async function orderInfo(code: string) {
  const wbCode = code.trim().toUpperCase();
  const o = await db.wbOrder.findUnique({
    where: { wbCode },
    select: {
      wbCode: true, amount: true, status: true, createdAt: true, completedAt: true, heldAt: true, heldReason: true,
      robloxUsername: true, gamepassUrl: true, isDirectOrder: true, flags: true, rejectionReason: true,
      user: { select: { name: true, username: true, tgId: true, vkId: true } },
    },
  });
  const dbs = await db.wbMarketplaceOrder.findFirst({
    where: { wbCode: { code: wbCode } },
    select: { wbOrderId: true, buyerName: true, nmId: true, createdAt: true, completedAt: true, cancelledAt: true, claimOpenedAt: true, claimReason: true },
  });
  if (!o && !dbs) return { found: false };
  const risks = await db.riskEvent.findMany({
    where: { wbCode }, orderBy: { occurredAt: "desc" }, take: 5,
    select: { kind: true, stars: true, text: true, occurredAt: true, resolvedAt: true },
  });
  return {
    found: true,
    order: o && {
      code: o.wbCode, robux: o.amount, status: STATUS_RU[o.status] ?? o.status, created: o.createdAt, bought: o.completedAt,
      frozen: o.heldAt ? o.heldReason ?? "да" : null, nick: o.robloxUsername, pass: o.gamepassUrl, direct: o.isDirectOrder,
      flags: flagsOf(o).filter((f) => !f.ackAt).map((f) => `${f.kind}${f.detail ? `: ${f.detail}` : ""}`),
      rejection: o.rejectionReason,
      buyer: o.user ? { name: o.user.name, tg: o.user.username, channel: o.user.tgId ? "TG" : o.user.vkId ? "VK" : "сайт" } : null,
    },
    wb: dbs && {
      wbOrderId: dbs.wbOrderId, buyerName: dbs.buyerName, created: dbs.createdAt,
      deliveryClosed: dbs.completedAt, cancelled: dbs.cancelledAt, claim: dbs.claimOpenedAt ? dbs.claimReason ?? "есть" : null,
    },
    risks,
  };
}

async function findOrders(query: string) {
  const q = query.trim().replace(/^@/, "");
  if (q.length < 2) return [];
  const rows = await db.wbOrder.findMany({
    where: {
      OR: [
        { robloxUsername: { contains: q, mode: "insensitive" } },
        { wbCode: { contains: q.toUpperCase() } },
        { user: { username: { equals: q, mode: "insensitive" } } },
        { user: { name: { contains: q, mode: "insensitive" } } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { wbCode: true, amount: true, status: true, createdAt: true, robloxUsername: true, heldAt: true, user: { select: { name: true } } },
  });
  const dbs = await db.wbMarketplaceOrder.findMany({
    where: { OR: [{ buyerName: { equals: q, mode: "insensitive" } }, { wbOrderId: q }] },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { wbOrderId: true, buyerName: true, createdAt: true, cancelledAt: true, wbCode: { select: { code: true } } },
  });
  return {
    orders: rows.map((r) => ({ code: r.wbCode, robux: r.amount, status: r.heldAt ? "заморожен" : STATUS_RU[r.status] ?? r.status, created: r.createdAt, nick: r.robloxUsername, buyer: r.user?.name })),
    wbByBuyerName: dbs.map((d) => ({ wbOrderId: d.wbOrderId, buyer: d.buyerName, code: d.wbCode?.code ?? null, created: d.createdAt, cancelled: Boolean(d.cancelledAt) })),
  };
}

async function queueOverview() {
  const now = Date.now();
  const active = await db.wbOrder.groupBy({
    by: ["status"],
    where: { status: { in: ["PAYMENT_PENDING", "AWAITING_GAMEPASS", "PENDING", "IN_PROGRESS", "ERROR"] }, isTest: false },
    _count: true,
  });
  const held = await db.wbOrder.count({ where: { heldAt: { not: null }, status: { notIn: ["COMPLETED", "REJECTED"] }, isTest: false } });
  // Свежие застрявшие (2–30 дней) — их ещё можно спасти; старше — счётчиком.
  const stuckWhere = { status: "AWAITING_GAMEPASS" as const, heldAt: null, isTest: false };
  const [stuck, stuckRecentCount, stuckOld] = await Promise.all([
    db.wbOrder.findMany({
      where: { ...stuckWhere, createdAt: { lt: new Date(now - 2 * DAY), gte: new Date(now - 30 * DAY) } },
      orderBy: { createdAt: "desc" }, take: 10,
      select: { wbCode: true, amount: true, createdAt: true },
    }),
    db.wbOrder.count({ where: { ...stuckWhere, createdAt: { lt: new Date(now - 2 * DAY), gte: new Date(now - 30 * DAY) } } }),
    db.wbOrder.count({ where: { ...stuckWhere, createdAt: { lt: new Date(now - 30 * DAY) } } }),
  ]);
  const oldestPending = await db.wbOrder.findFirst({
    where: { status: "PENDING", heldAt: null, isTest: false }, orderBy: { createdAt: "asc" },
    select: { wbCode: true, amount: true, createdAt: true },
  });
  return {
    byStatus: Object.fromEntries(active.map((a) => [STATUS_RU[a.status] ?? a.status, a._count])),
    frozen: held,
    waitingPass2to30Days: { count: stuckRecentCount, freshest: stuck.map((s) => ({ code: s.wbCode, robux: s.amount, days: Math.floor((now - s.createdAt.getTime()) / DAY) })) },
    waitingPassOver30DaysCount: stuckOld,
    oldestInQueue: oldestPending && { code: oldestPending.wbCode, robux: oldestPending.amount, hours: Math.floor((now - oldestPending.createdAt.getTime()) / 3600_000) },
  };
}

async function stats(days: number) {
  const from = days <= 1 ? mskDayStart(0) : new Date(Date.now() - days * DAY);
  const [created, done, rejected, dbs] = await Promise.all([
    db.wbOrder.aggregate({ where: { createdAt: { gte: from }, isTest: false }, _count: true, _sum: { amount: true } }),
    db.wbOrder.aggregate({ where: { completedAt: { gte: from }, status: "COMPLETED", isTest: false }, _count: true, _sum: { amount: true } }),
    db.wbOrder.count({ where: { updatedAt: { gte: from }, status: "REJECTED", isTest: false } }),
    db.wbMarketplaceOrder.count({ where: { createdAt: { gte: from }, isTest: false } }),
  ]);
  return {
    period: days <= 1 ? "сегодня (МСК)" : `последние ${days} дн.`,
    ordersCreated: created._count, robuxOrdered: created._sum.amount ?? 0,
    bought: done._count, robuxBought: done._sum.amount ?? 0,
    rejected, wbDbsOrders: dbs,
  };
}

async function openRisks() {
  const rows = await db.riskEvent.findMany({
    where: { resolvedAt: null }, orderBy: { occurredAt: "desc" }, take: 15,
    select: { kind: true, wbCode: true, buyerName: true, amount: true, stars: true, text: true, occurredAt: true },
  });
  return rows.map((r) => ({ ...r, text: r.text?.slice(0, 200) ?? null }));
}

const TOOLS: Anthropic.Tool[] = [
  { name: "who_is", description: "КТО ЭТО: единый профиль покупателя по чему угодно — код заказа, номер заказа WB, ник Roblox, @username Telegram, имя на WB или в боте. Возвращает его Telegram/ВК, все заказы (WB и прямые), имена на WB, ники Roblox, отзывы/заявки/жалобы на WB. Связь WB↔наш клиент помечена: точно / вероятно / тёзки.", input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false }, strict: true },
  { name: "order_info", description: "Всё о заказе по коду (7 символов, например ZT8BW8D, или DIR-...): статус, ник, пасс, заморозка, пометки, данные Wildberries, события рисков.", input_schema: { type: "object", properties: { code: { type: "string" } }, required: ["code"], additionalProperties: false }, strict: true },
  { name: "find_orders", description: "Поиск заказов по нику Roblox, имени покупателя, @username Telegram, части кода или номеру заказа WB. До 10 свежих.", input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false }, strict: true },
  { name: "queue_overview", description: "Что сейчас в работе: заказы по статусам, сколько заморожено, кто ждёт пасс 2–30 дней (самые свежие коды) и сколько висит дольше 30 дней, самый старый в очереди на выкуп.", input_schema: { type: "object", properties: {}, required: [], additionalProperties: false }, strict: true },
  { name: "stats", description: "Цифры за период: заказы, робуксы заказано/выкуплено, отмены, заказы DBS с WB. days=1 — сегодня по Москве.", input_schema: { type: "object", properties: { days: { type: "integer", enum: [1, 7, 30] } }, required: ["days"], additionalProperties: false }, strict: true },
  { name: "open_risks", description: "Открытые записи раздела «Риски»: плохие отзывы, возвраты, продажи без кода, жалобы в вопросах WB.", input_schema: { type: "object", properties: {}, required: [], additionalProperties: false }, strict: true },
];

async function runTool(name: string, input: Record<string, unknown>) {
  switch (name) {
    case "who_is": return whoIs(db, String(input.query ?? ""));
    case "order_info": return orderInfo(String(input.code ?? ""));
    case "find_orders": return findOrders(String(input.query ?? ""));
    case "queue_overview": return queueOverview();
    case "stats": return stats(Number(input.days ?? 1));
    case "open_risks": return openRisks();
    default: return { error: "нет такого инструмента" };
  }
}

const ASSISTANT_SYSTEM = `Ты — ассистент команды магазина RobloxBank (робуксы через геймпассы, продажи на Wildberries и в Telegram/VK-ботах). Тебе пишут админы в рабочей беседе. Отвечай по-русски, коротко и по делу, как коллега: цифры, коды заказов, что делать. Суммы заказов (robux) — в робуксах, пиши «R$», не рубли. Данные бери ТОЛЬКО из инструментов (они читают нашу базу); если данных нет — так и скажи, не выдумывай. Ты ничего не меняешь в заказах — только смотришь и подсказываешь; если просят действие (выкупить, разморозить, вернуть деньги), объясни, где это сделать в админке (TWA/сайт), и дай нужные данные. Время в данных — UTC, админам называй по Москве (UTC+3). Без markdown-разметки (звёздочки, решётки) — обычный текст и эмодзи по делу.`;

export async function askAssistant(question: string): Promise<string> {
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: question }];
  for (let step = 0; step < 6; step++) {
    const res = await anthropic().messages.create({
      model: PA_AI_MODEL,
      max_tokens: 3000,
      system: [{ type: "text", text: ASSISTANT_SYSTEM, cache_control: { type: "ephemeral" } }],
      tools: TOOLS,
      messages,
      output_config: { effort: "medium" },
    });
    if (res.stop_reason === "tool_use") {
      messages.push({ role: "assistant", content: res.content });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const block of res.content) {
        if (block.type !== "tool_use") continue;
        try {
          const out = await runTool(block.name, block.input as Record<string, unknown>);
          results.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(out).slice(0, 12_000) });
        } catch (error) {
          results.push({ type: "tool_result", tool_use_id: block.id, is_error: true, content: error instanceof Error ? error.message : "ошибка" });
        }
      }
      messages.push({ role: "user", content: results });
      continue;
    }
    if (res.stop_reason === "refusal") return "Не могу ответить на это.";
    const text = plain(res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n"));
    return text || "Пустой ответ — переформулируйте вопрос.";
  }
  return "Слишком долго ищу — уточните вопрос (например, код заказа).";
}

// ── Утренняя сводка ──────────────────────────────────────────────────────────

async function digestData() {
  const y0 = mskDayStart(-1);
  const y1 = mskDayStart(0);
  const [created, bought, rejected, dbsNew, risksNew, risksOpen, queue] = await Promise.all([
    db.wbOrder.aggregate({ where: { createdAt: { gte: y0, lt: y1 }, isTest: false }, _count: true, _sum: { amount: true } }),
    db.wbOrder.aggregate({ where: { completedAt: { gte: y0, lt: y1 }, status: "COMPLETED", isTest: false }, _count: true, _sum: { amount: true } }),
    db.wbOrder.count({ where: { updatedAt: { gte: y0, lt: y1 }, status: "REJECTED", isTest: false } }),
    db.wbMarketplaceOrder.count({ where: { createdAt: { gte: y0, lt: y1 }, isTest: false } }),
    db.riskEvent.groupBy({ by: ["kind"], where: { createdAt: { gte: y0, lt: y1 } }, _count: true }),
    db.riskEvent.count({ where: { resolvedAt: null } }),
    queueOverview(),
  ]);
  return {
    yesterday: {
      ordersCreated: created._count, robuxOrdered: created._sum.amount ?? 0,
      bought: bought._count, robuxBought: bought._sum.amount ?? 0,
      rejected, wbDbsOrders: dbsNew,
      newRisks: Object.fromEntries(risksNew.map((r) => [r.kind, r._count])),
    },
    now: { ...queue, openRisks: risksOpen },
  };
}

const DIGEST_SYSTEM = `Ты пишешь утреннюю сводку для команды магазина RobloxBank в Telegram. По данным (JSON) напиши 6–12 коротких строк по-русски: сначала итоги вчера (заказы, сколько робуксов выкуплено, заказы с WB), потом «что горит сейчас» — очередь, кто ждёт пасс больше 2 дней (коды), заморозки, открытые риски с расшифровкой (BAD_REVIEW — плохие отзывы, REFUND_OPEN — WB вернул деньги, не выкупать, SALE_NO_CODE — оплачен, код не выдан, SALE_UNMATCHED — продажа без заказа, REFUND_AFTER_DELIVERY — возврат после выкупа, REVIEW_FIXED — отзыв исправлен, REVIEW_DELETED — плохой отзыв удалён, CLAIM_OPENED — заявка на возврат, BUYER_QUESTION — вопрос на WB, BUYER_HELP и BUYER_CANCEL — обращения покупателей в чатах). Ждущих пасс больше 30 дней называй одним числом — это старые брошенные заказы. В конце одна строка «на что посмотреть первым». Только факты из данных, без воды, эмодзи по делу, без markdown-звёздочек.`;

export async function buildDigest(): Promise<string> {
  const data = await digestData();
  try {
    const res = await anthropic().messages.create({
      model: PA_AI_MODEL,
      max_tokens: 1500,
      system: DIGEST_SYSTEM,
      messages: [{ role: "user", content: JSON.stringify(data) }],
      output_config: { effort: "low" },
    });
    const text = plain(res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n"));
    if (text) return text;
  } catch (error) {
    console.warn(`[pa-group] сводка без ИИ: ${error instanceof Error ? error.message : error}`);
  }
  const y = data.yesterday;
  return `📊 Вчера: заказов ${y.ordersCreated}, выкуплено ${y.bought} (${y.robuxBought} R$), с WB ${y.wbDbsOrders}.\nСейчас: заморожено ${data.now.frozen}, ждут пасс 2–30 дн.: ${data.now.waitingPass2to30Days.count}, открытых рисков ${data.now.openRisks}.`;
}

/** Раз в 10 минут: после 09:00 МСК, если сегодня ещё не слали, — сводка. */
export function startPaDigest(bot: Telegraf) {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) return;
  const tick = async () => {
    const s = await loadSettings(true);
    if (!s.chatId || s.mode === "off") return;
    const msk = new Date(Date.now() + MSK);
    const today = msk.toISOString().slice(0, 10);
    if (msk.getUTCHours() < 9 || s.digestDay === today) return;
    await saveSettings({ digestDay: today });
    const text = await buildDigest();
    await card(bot, `☀️ <b>Сводка за ${new Date(mskDayStart(-1).getTime() + MSK).toISOString().slice(5, 10).split("-").reverse().join(".")}</b>\n\n${escape(text)}`, undefined, "digest");
  };
  setTimeout(() => void tick().catch((e) => console.error("[pa-group] сводка:", e)), 180_000);
  setInterval(() => void tick().catch((e) => console.error("[pa-group] сводка:", e)), 10 * 60_000);
}

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ── Регистрация ──────────────────────────────────────────────────────────────

const TOPICS: Array<{ key: PaTopic; name: string; color: number; hello: string }> = [
  { key: "support", name: "🆘 Поддержка", color: 0xff93b2, hello: "Сюда бот присылает обращения из @RobloxBank_PA, где нужен человек: карточка с сутью, заказом и черновиком ответа. «📤 Отправить черновик» — ответ уйдёт покупателю от имени поддержки." },
  { key: "test", name: "🧪 Тест ИИ", color: 0xffd67e, hello: "Тестовый режим: что бот ответил бы покупателю или передал бы вам. Покупателям в этом режиме ничего не уходит. Нравится — /support_mode on." },
  { key: "digest", name: "📊 Сводки", color: 0x6fb9f0, hello: "Каждое утро в 09:00 МСК — итоги вчера и что горит сейчас. По запросу — /digest." },
  { key: "assistant", name: "🤖 Ассистент", color: 0x8eee98, hello: "Спрашивайте здесь обычным текстом — отвечу по базе: «что с ZT8BW8D», «кто ждёт пасс больше 2 дней», «сколько выкупили вчера», «найди заказы Анны», «открытые риски». Я только смотрю — ничего не меняю. В других темах зовите через @RobloxBankBot." },
];

export function registerPaGroup(bot: Telegraf): void {
  bot.command("support_setup", async (ctx) => {
    if (!isAdmin(ctx.from?.id) || !ctx.chat || ctx.chat.type === "private") return;
    await saveSettings({ chatId: ctx.chat.id });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chat = await ctx.telegram.getChat(ctx.chat.id).catch(() => null) as any;
    if (!chat?.is_forum) {
      await ctx.reply("Беседа назначена чатом поддержки ✅\n\nЧтобы навести порядок по темам: настройки беседы → «Темы» (Topics) → включить, потом снова /support_setup. Бот создаст темы «🆘 Поддержка», «🧪 Тест ИИ», «📊 Сводки», «🤖 Ассистент» и разложит всё по ним.");
      return;
    }
    const s = await loadSettings(true);
    const topics = { ...s.topics };
    for (const t of TOPICS) {
      if (topics[t.key]) continue;
      try {
        const created = await ctx.telegram.createForumTopic(ctx.chat.id, t.name, { icon_color: t.color as never });
        topics[t.key] = created.message_thread_id;
        const hello = await ctx.telegram.sendMessage(ctx.chat.id, t.hello, { message_thread_id: created.message_thread_id });
        await ctx.telegram.pinChatMessage(ctx.chat.id, hello.message_id, { disable_notification: true }).catch(() => undefined);
      } catch (error) {
        await ctx.reply(`Тема «${t.name}» не создалась: ${error instanceof Error ? error.message : error}. Проверьте, что у бота есть право «Управление темами».`);
      }
    }
    await saveSettings({ topics });
    await ctx.telegram.setChatDescription(ctx.chat.id, "Команда RobloxBank. 🆘 Поддержка — обращения, где нужен человек · 🧪 Тест ИИ · 📊 Сводки — каждое утро · 🤖 Ассистент — вопросы по базе.").catch(() => undefined);
    await ctx.reply(`✅ Готово. Темы: ${TOPICS.map((t) => t.name).join(", ")}. Режим ИИ-поддержки: ${s.mode}.`);
  });

  // Без ИИ: работают всегда, где бы ни жил сервер.
  bot.command("reviews", async (ctx) => {
    if (!isAdmin(ctx.from?.id)) return;
    const n = Math.min(20, Math.max(1, Number((ctx.message?.text ?? "").split(/\s+/)[1]) || 8));
    const list = await recentBadReviewsWithBuyers(db, n);
    if (list.length === 0) return void ctx.reply("Плохих отзывов не найдено.");
    const blocks = list.map((r) => [
      `${"★".repeat(r.stars ?? 0)}${"☆".repeat(5 - (r.stars ?? 0))} ${r.at.toISOString().slice(0, 10)} · на WB: ${r.wbName ?? "?"}${r.open ? "" : " · разобран"}`,
      `📦 ${r.code ?? "—"}${r.wbOrderId ? ` · WB #${r.wbOrderId}` : ""}`,
      ...r.who,
      r.text ? `💬 «${r.text.slice(0, 160)}»` : null,
    ].filter(Boolean).join("\n"));
    for (let i = 0; i < blocks.length; i += 5) {
      await ctx.reply(`Плохие отзывы WB и кто это у нас:\n\n${blocks.slice(i, i + 5).join("\n\n")}`.slice(0, 4000), { link_preview_options: { is_disabled: true } });
    }
  });

  bot.command("who", async (ctx) => {
    if (!isAdmin(ctx.from?.id)) return;
    const query = (ctx.message?.text ?? "").split(/\s+/).slice(1).join(" ").trim();
    if (!query) return void ctx.reply("Кого искать? /who КОД | номер WB | ник Roblox | @username | имя");
    const res = await whoIs(db, query);
    if (res.found.length === 0 && res.notes.length === 0) return void ctx.reply(`По «${query}» никого не нашёл.`);
    const text = [...res.notes, ...res.found.map(profileText), res.more ? `…и ещё ${res.more}` : null].filter(Boolean).join("\n\n");
    await ctx.reply(text.slice(0, 4000), { link_preview_options: { is_disabled: true } });
  });

  bot.command("digest", async (ctx) => {
    if (!isAdmin(ctx.from?.id) || !process.env.ANTHROPIC_API_KEY?.trim()) return;
    await ctx.sendChatAction("typing").catch(() => undefined);
    const text = await buildDigest();
    await ctx.reply(text);
  });

  // Всё прочее из групп — сюда и дальше не пускаем (см. шапку: защита).
  bot.use(async (ctx, next) => {
    const chatType = ctx.chat?.type;
    if (!chatType || chatType === "private" || chatType === "channel") return next();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const u = ctx.update as any;
    if (u.chat_member || u.my_chat_member) return next();
    const msg = u.message;
    if (!msg?.text || !isAdmin(ctx.from?.id) || !process.env.ANTHROPIC_API_KEY?.trim()) return;
    const s = await loadSettings();
    if (!s.chatId || ctx.chat!.id !== s.chatId) return;
    const me = ctx.botInfo?.username ?? "RobloxBankBot";
    const mentioned = msg.text.includes(`@${me}`);
    const replyToBot = msg.reply_to_message?.from?.id === ctx.botInfo?.id && !msg.reply_to_message?.forum_topic_created;
    const inAssistant = Boolean(s.topics.assistant) && msg.message_thread_id === s.topics.assistant;
    if (!mentioned && !replyToBot && !inAssistant) return;
    if (msg.text.startsWith("/")) return;
    const question = msg.text.replace(new RegExp(`@${me}`, "g"), "").trim();
    if (!question) return;
    await ctx.sendChatAction("typing", { message_thread_id: msg.message_thread_id }).catch(() => undefined);
    try {
      const answer = await askAssistant(question);
      await ctx.reply(answer.slice(0, 4000), { reply_parameters: { message_id: msg.message_id } });
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      const blocked = /403|forbidden|not allowed/i.test(text);
      await ctx.reply(blocked
        ? "ИИ недоступен: Anthropic не принимает запросы с нашего сервера (регион). Пока работают команды без ИИ: /who КОД|ник|имя, /reviews, /digest."
        : `Не получилось: ${text.slice(0, 200)}`, { reply_parameters: { message_id: msg.message_id } });
    }
  });
}
