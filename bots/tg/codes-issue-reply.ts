import { Markup, type Context, type Telegraf } from "telegraf";
import { ADMIN_IDS } from "../shared/admin";
import { escapeHtml } from "../shared/notify";
import { mskTime } from "../shared/notify-format";
import { fetchCodesQueue, issueCodeViaWeb, type CodeIssueStatus } from "../shared/codes-bot-api";

/* ─────────────────────────────────────────────────────────────────────────────
   🎟 Выдача кода прямо из темы «Коды» (16.11.2026). Раньше — только через
   Claude (`scripts/codes-issue.mjs`), а алерт об оплате не доходил вовсе
   (CODE-827TX8XJ). Теперь:

   1. Под алертом «оплачен — выдать код вручную» — кнопка «🎟 Выдать код».
   2. Нажал — бот просит код (поле ответа открывается само, `force_reply`).
   3. Ответ кодом (или ответ кодом прямо на алерт, или `/issue CODE-… код`) —
      бот выдаёт через сайт (`/api/internal/codes/issue`: письмо / кабинет /
      чат бота) и переписывает алерт в «🟢 код выдан · код под спойлером · кто ·
      когда · письмо ушло», кнопку снимает. Сообщение админа с кодом бот
      заменяет своей копией с кодом под спойлером (кто, какой заказ, выдан ли)
      — код виден, но не светится (владелец 16.11).
   4. `/codes` — очередь оплаченных без кода, по кнопке на заказ.

   Только ADMIN_IDS. Регистрируется до беседы админов (`registerPaGroup`).
   ───────────────────────────────────────────────────────────────────────── */

const ORDER_RE = /\bCODE-[A-Z0-9]{8}\b/i;
const CODE_SHAPE = /^[A-Z0-9]{6,40}$/;
const CB_RE = /^cdi:(CODE-[A-Z0-9]{8})$/;

export function normalizeGiftCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[\s-]+/g, "");
}

/** Текст похож на сам код: латиница и цифры, без слов вокруг. */
export function looksLikeGiftCode(text: string): boolean {
  const t = text.trim();
  if (!t || t.split(/\s+/).length > 4 || t.startsWith("/")) return false;
  return CODE_SHAPE.test(normalizeGiftCode(t)) && /\d/.test(t);
}

/** `/issue CODE-XXXXXXXX код` → части; иначе null. */
export function parseIssueCommand(text: string): { publicId: string; code: string } | null {
  const m = /^\/issue(?:@\w+)?\s+(CODE-[A-Z0-9]{8})\s+(.+)$/i.exec(text.trim());
  return m ? { publicId: m[1].toUpperCase(), code: m[2].trim() } : null;
}

const REASON: Record<Exclude<CodeIssueStatus, "issued">, string> = {
  not_found: "заказа нет",
  not_paid: "заказ не оплачен",
  already: "код по этому заказу уже выдан — второй не выдаём",
  refunded: "деньги по заказу возвращены",
  duplicate_code: "этот код уже есть в базе (выдан раньше) — нужен другой",
  bad_code: "код странной формы — пришлите только сам код",
  denomination_mismatch: "номинал не совпал с заказом",
  bad_request: "проверьте номер заказа",
  error: "сайт не ответил — попробуйте ещё раз",
};

export const EMAIL_WORD: Record<string, string> = {
  sent: "📬 письмо ушло",
  scheduled: "🎁 открытка уйдёт в выбранный день",
  no_address: "📭 почты нет — код в кабинете/чате",
  failed: "⚠️ письмо НЕ ушло — переотправить со страницы заказа",
  exhausted: "⚠️ письмо НЕ ушло — переотправить со страницы заказа",
};

/** Текст алерта после выдачи — заменяет «оплачен — выдать код вручную». */
export function issuedAlertText(input: { publicId: string; amountLine: string | null; code?: string; actor: string; at: Date; email?: string; chat?: boolean | null }): string {
  const delivery = [
    input.email ? EMAIL_WORD[input.email] ?? input.email : null,
    input.chat === true ? "💬 в чат бота ✓" : input.chat === false ? "💬 в чат бота ✗" : null,
  ].filter(Boolean).join(" · ");
  return [
    `🟢 <b>САЙТ · код активации: выдан</b>`,
    input.amountLine ? `🎟 ${input.amountLine}` : `🎟 <code>${input.publicId}</code>`,
    input.code ? `🔑 Код: <tg-spoiler><code>${escapeHtml(input.code)}</code></tg-spoiler>` : null,
    `✅ ${escapeHtml(input.actor)} · ${mskTime(input.at)}${delivery ? ` · ${delivery}` : ""}`,
  ].filter(Boolean).join("\n");
}

/** Копия сообщения админа с кодом: код под спойлером, кто прислал, выдан ли. */
export function codeCopyText(input: { publicId: string; code: string; actor: string; at: Date; issued: boolean; reason?: string }): string {
  return [
    input.issued
      ? `🔑 <b>Код выдан</b> · <code>${input.publicId}</code>`
      : `⚠️ <b>Код НЕ выдан</b> · <code>${input.publicId}</code> — ${escapeHtml(input.reason ?? "ошибка")}`,
    `<tg-spoiler><code>${escapeHtml(input.code)}</code></tg-spoiler>`,
    `прислал ${escapeHtml(input.actor)} · ${mskTime(input.at)}${input.issued ? "" : " · код покупателю не ушёл, можно прислать другой"}`,
  ].join("\n");
}

/** Строка «CODE-… · 1 000 R$ · 1 199 ₽» из простого текста алерта (Telegram отдаёт его без разметки). */
export function amountLineFrom(plain: string | undefined, publicId: string): string | null {
  const line = (plain ?? "").split("\n").find((l) => l.includes(publicId));
  if (!line) return null;
  return escapeHtml(line.replace(/^🎟\s*/, "")).replace(publicId, `<code>${publicId}</code>`);
}

const isAdmin = (id: number | undefined) => id !== undefined && ADMIN_IDS.includes(String(id));
const actorOf = (from: { id: number; username?: string; first_name?: string }) =>
  from.username ? `@${from.username}` : from.first_name || String(from.id);

/** Подсказка «пришлите код» → алерт, который надо переписать после выдачи. */
type Pending = { publicId: string; chatId: number; alertId: number | null; amountLine: string | null; at: number };
const prompts = new Map<string, Pending>();
const promptKey = (chatId: number, messageId: number) => `${chatId}:${messageId}`;
function prunePrompts(now = Date.now()): void {
  for (const [k, p] of prompts) if (now - p.at > 6 * 3600_000) prompts.delete(k);
}

async function askForCode(ctx: Context, publicId: string, alert: { id: number; text?: string } | null, threadId?: number): Promise<void> {
  prunePrompts();
  const sent = await ctx.reply(
    `🎟 Код для <code>${publicId}</code> — ответьте на это сообщение самим кодом.`,
    {
      parse_mode: "HTML",
      disable_notification: true,
      reply_markup: { force_reply: true, selective: true, input_field_placeholder: "Код Roblox, например ABCD-1234-EFGH" },
      ...(alert ? { reply_parameters: { message_id: alert.id, allow_sending_without_reply: true } } : {}),
      ...(threadId ? { message_thread_id: threadId } : {}),
    },
  ).catch(() => null);
  if (sent && ctx.chat) {
    prompts.set(promptKey(ctx.chat.id, sent.message_id), {
      publicId, chatId: ctx.chat.id, alertId: alert?.id ?? null, amountLine: amountLineFrom(alert?.text, publicId), at: Date.now(),
    });
  }
}

export function registerCodesIssueReply(bot: Telegraf): void {
  // 1. Кнопка под алертом / в очереди.
  bot.action(CB_RE, async (ctx) => {
    if (!isAdmin(ctx.from?.id)) return ctx.answerCbQuery("Только для админов").catch(() => undefined);
    const publicId = CB_RE.exec((ctx.callbackQuery as { data?: string }).data ?? "")![1];
    await ctx.answerCbQuery("Пришлите код ответом").catch(() => undefined);
    const message = (ctx.callbackQuery as { message?: { message_id: number; text?: string; message_thread_id?: number } }).message;
    // Кнопка из очереди `/codes` — алерта под рукой нет, переписывать нечего.
    const isAlert = Boolean(message?.text?.includes("выдать код") || message?.text?.includes("кода на складе нет"));
    await askForCode(ctx, publicId, message && isAlert ? { id: message.message_id, text: message.text } : null, message?.message_thread_id);
  });

  // 2. Очередь.
  // `/codes` в личке — витрина кодов для покупателей (`codes-shop.ts`); очередь
  // отвечает на него только в беседе. `/codes_queue` — где угодно.
  bot.command(["codes", "codes_queue"], async (ctx, next) => {
    if (!isAdmin(ctx.from?.id)) return next();
    const cmd = (ctx.message.text.split(/[\s@]/)[0] ?? "").toLowerCase();
    if (cmd === "/codes" && ctx.chat.type === "private") return next();
    const queue = await fetchCodesQueue();
    if (queue === null) {
      await ctx.reply("⚠️ Сайт не ответил — очередь кодов не получить. Попробуйте ещё раз.").catch(() => undefined);
      return;
    }
    if (queue.length === 0) {
      await ctx.reply("🟢 Все оплаченные коды выданы — очередь пуста.", { disable_notification: true }).catch(() => undefined);
      return;
    }
    const lines = queue.slice(0, 20).map((o) => {
      const paid = o.paidAt ? new Date(o.paidAt).toLocaleString("ru-RU", { timeZone: "Europe/Moscow", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
      const where = o.deliveryMode === "GIFT" ? "🎁 открытка" : o.deliveryMode === "EMAIL" ? "📬 почта" : "👤 кабинет";
      return `• <code>${o.publicId}</code> · ${o.denomination.toLocaleString("ru-RU")} R$ · ${(o.finalAmountKopecks / 100).toLocaleString("ru-RU")} ₽ · ${where} · оплачен ${paid}`;
    });
    await ctx.reply(`🎟 <b>Ждут код: ${queue.length}</b>\n${lines.join("\n")}`, {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard(queue.slice(0, 10).map((o) => [Markup.button.callback(`🎟 Выдать ${o.publicId} · ${o.denomination.toLocaleString("ru-RU")} R$`, `cdi:${o.publicId}`)])),
    }).catch(() => undefined);
  });

  // 3. Сам код.
  bot.on("message", async (ctx, next) => {
    const msg = ctx.message as {
      text?: string; message_id: number; message_thread_id?: number;
      reply_to_message?: { message_id: number; text?: string; from?: { id: number } };
    };
    if (!msg.text || !isAdmin(ctx.from?.id)) return next();

    let job = parseIssueCommand(msg.text);
    let pending: Pending | null = null;
    if (!job) {
      const replyTo = msg.reply_to_message;
      if (!replyTo || replyTo.from?.id !== ctx.botInfo?.id) return next();
      pending = prompts.get(promptKey(ctx.chat.id, replyTo.message_id)) ?? null;
      const publicId = pending?.publicId ?? ORDER_RE.exec(replyTo.text ?? "")?.[0]?.toUpperCase();
      if (!publicId) return next();
      if (!looksLikeGiftCode(msg.text)) {
        // Ответили на подсказку не кодом — подсказать, а не молчать.
        if (pending) await ctx.reply("Пришлите только сам код (латиница и цифры), ответом на подсказку выше.", { disable_notification: true }).catch(() => undefined);
        return pending ? undefined : next();
      }
      job = { publicId, code: msg.text.trim() };
      if (!pending) pending = { publicId, chatId: ctx.chat.id, alertId: replyTo.message_id, amountLine: amountLineFrom(replyTo.text, publicId), at: Date.now() };
    }

    const result = await issueCodeViaWeb(job.publicId, job.code);
    const actor = actorOf(ctx.from);
    const issued = result.status === "issued";
    const promptId = msg.reply_to_message && prompts.has(promptKey(ctx.chat.id, msg.reply_to_message.message_id))
      ? msg.reply_to_message.message_id : null;
    const thread = msg.message_thread_id ? { message_thread_id: msg.message_thread_id } : {};

    // Сообщение админа с кодом → наше, с кодом под спойлером (владелец 16.11:
    // «код не удаляй, его нужно видеть… просто пусть станет спойлером»). Своё
    // сообщение бот спрятать не может — меняем его на копию от бота: кто, по
    // какому заказу, выдан ли, и сам код под спойлером. Оригинал убираем
    // только ПОСЛЕ того, как копия встала, — код не теряется ни при каком сбое.
    const copy = await ctx.reply(codeCopyText({
      publicId: job.publicId, code: job.code, actor, at: new Date(), issued,
      reason: issued ? undefined : REASON[result.status as Exclude<CodeIssueStatus, "issued">] ?? result.status,
    }), {
      parse_mode: "HTML",
      disable_notification: true,
      ...(pending?.alertId ? { reply_parameters: { message_id: pending.alertId, allow_sending_without_reply: true } } : {}),
      ...thread,
    }).catch(() => null);
    if (copy) {
      await ctx.deleteMessage(msg.message_id).catch(() => undefined);
      // Подсказка «пришлите код» своё отработала — копия встаёт на её место.
      if (promptId && issued) await ctx.telegram.deleteMessage(ctx.chat.id, promptId).catch(() => undefined);
    }
    if (promptId && issued) prompts.delete(promptKey(ctx.chat.id, promptId));
    if (!issued) return;

    const text = issuedAlertText({ publicId: job.publicId, amountLine: pending?.amountLine ?? null, code: job.code, actor, at: new Date(), email: result.email, chat: result.chat });
    const edited = pending?.alertId
      ? await ctx.telegram.editMessageText(ctx.chat.id, pending.alertId, undefined, text, { parse_mode: "HTML", reply_markup: { inline_keyboard: [] } }).then(() => true).catch(() => false)
      : false;
    if (!edited) {
      await ctx.reply(text, { parse_mode: "HTML", disable_notification: true, ...thread }).catch(() => undefined);
    }
  });
}
