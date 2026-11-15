import type { Telegraf } from "telegraf";
import { ADMIN_IDS } from "../shared/admin";
import { escapeHtml } from "../shared/notify";
import { issueCodeViaWeb, type CodeIssueStatus } from "../shared/codes-bot-api";

/* ─────────────────────────────────────────────────────────────────────────────
   🎟 Выдать код из беседы (16.11.2026). Раньше выдача шла только через Claude
   (`scripts/codes-issue.mjs`), а алерт об оплате не доходил вовсе
   (CODE-827TX8XJ). Теперь в теме «Коды»:
   - ответ на увед «оплачен — выдать код вручную» самим кодом — бот выдаёт его;
   - или `/issue CODE-XXXXXXXX <код>` — где угодно, только ADMIN_IDS.
   Сообщение с кодом бот удаляет СРАЗУ (и при отказе) — код не висит в беседе.
   Регистрируется до беседы админов (`registerPaGroup`), как `wb-reply`.
   ───────────────────────────────────────────────────────────────────────── */

const ORDER_RE = /\bCODE-[A-Z0-9]{8}\b/i;
const CODE_SHAPE = /^[A-Z0-9]{6,40}$/;

export function normalizeGiftCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[\s-]+/g, "");
}

/** Текст похож на сам код (одна «строка», без пробелов внутри слова). */
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
  duplicate_code: "этот код уже есть в базе (выдан раньше)",
  bad_code: "код странной формы",
  denomination_mismatch: "номинал не совпал с заказом",
  bad_request: "проверьте номер заказа",
  error: "сайт не ответил — попробуйте ещё раз",
};

const EMAIL: Record<string, string> = {
  sent: "письмо ушло",
  scheduled: "открытка уйдёт по расписанию",
  no_address: "почты нет — код в кабинете/чате",
  failed: "письмо НЕ ушло — переотправить со страницы заказа",
  exhausted: "письмо НЕ ушло — переотправить со страницы заказа",
};

const isAdmin = (id: number | undefined) => id !== undefined && ADMIN_IDS.includes(String(id));
const actorOf = (from: { id: number; username?: string; first_name?: string }) =>
  from.username ? `@${from.username}` : from.first_name || String(from.id);

export function registerCodesIssueReply(bot: Telegraf): void {
  bot.on("message", async (ctx, next) => {
    const msg = ctx.message as {
      text?: string; message_id: number; message_thread_id?: number;
      reply_to_message?: { message_id: number; text?: string; from?: { id: number } };
    };
    if (!msg.text || !isAdmin(ctx.from?.id)) return next();

    let job = parseIssueCommand(msg.text);
    if (!job) {
      const replyTo = msg.reply_to_message;
      const orderId = replyTo?.from?.id === ctx.botInfo?.id ? ORDER_RE.exec(replyTo?.text ?? "")?.[0] : undefined;
      if (!orderId || !looksLikeGiftCode(msg.text)) return next();
      job = { publicId: orderId.toUpperCase(), code: msg.text.trim() };
    }

    // Код не должен висеть в беседе — удаляем до ответа сайта.
    await ctx.deleteMessage(msg.message_id).catch(() => undefined);
    const result = await issueCodeViaWeb(job.publicId, job.code);
    const actor = escapeHtml(actorOf(ctx.from));
    const text = result.status === "issued"
      ? `✅ <code>${job.publicId}</code> — код выдан · ${actor}${result.email ? ` · ${EMAIL[result.email] ?? result.email}` : ""}${result.chat === true ? " · в чат бота ✓" : result.chat === false ? " · в чат бота ✗" : ""}`
      : `⚠️ <code>${job.publicId}</code> — не выдан: ${REASON[result.status] ?? result.status} · ${actor}`;
    await ctx.reply(text, {
      parse_mode: "HTML",
      disable_notification: result.status === "issued",
      ...(msg.reply_to_message ? { reply_parameters: { message_id: msg.reply_to_message.message_id, allow_sending_without_reply: true } } : {}),
      ...(msg.message_thread_id ? { message_thread_id: msg.message_thread_id } : {}),
    }).catch(() => undefined);
  });
}
