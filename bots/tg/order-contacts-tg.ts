/* ─────────────────────────────────────────────────────────────────────────────
   Контакты заказа в Telegram (17.11.2026): чат поддержки @RobloxBank_PA и бот.

   • `offerFromSupport` — человек написал в поддержку код / ссылку / пасс / ник,
     а заказ оформлен с другого аккаунта → вопрос с кнопками прямо в чате
     поддержки (Telegram Business разрешает боту инлайн-кнопки, нажатие
     приходит боту обычным callback_query).
   • `offerInBot` — тот же вопрос в самом боте, когда код занят другим
     аккаунтом на этой же площадке (раньше — тупик «уже активирован»).
   • `registerOrderContactActions` — кнопки «да» / «не мой» / «убрать».

   Правила и слова — в `bots/shared/order-contacts.ts`, здесь только доставка.
   ───────────────────────────────────────────────────────────────────────── */

import type { Telegraf } from "telegraf";
import { db } from "../shared/db";
import { escapeHtml } from "../shared/notify";
import { heldLabel } from "../shared/notify-format";
import { notifyContactOwner } from "../shared/order-contacts-notify";
import {
  CONTACT_CB, DECLINE_LABEL, STALE_OFFER_TEXT,
  addOrderContact, addedText, blockedText, cluesFromOcr, declinedText, extractOrderClues, findOrdersByClues, hasClues, ocrLooksUseful,
  offerButtonLabel, offerKey, offerText, parseContactCallback, planContactOffer,
  recordContactDeclined, rememberOffer, removeOrderContact, supportVia, takeOffer, dropOffer,
  type FoundOrder,
} from "../shared/order-contacts";
import { card } from "./pa-ai";
import { ocrImageText } from "../shared/pending-ocr";
import { paRecentCustomerText, pinPaOrdersNow } from "./pa-desk-worker";

const BOT_URL = "https://t.me/RobloxBankBot?start=order";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Api = (method: string, payload: Record<string, unknown>) => Promise<any>;

interface Who { id: number; first_name?: string; last_name?: string; username?: string }

function tgLabel(from: Who): string {
  const name = [from.first_name, from.last_name].filter(Boolean).join(" ").trim();
  return (name || (from.username ? `@${from.username}` : `id ${from.id}`)) + (name && from.username ? ` (@${from.username})` : "");
}

function offerKeyboard(orders: FoundOrder[]) {
  const many = orders.length > 1;
  return [
    ...orders.map((o) => [{ text: offerButtonLabel(o, many), callback_data: `${CONTACT_CB.add}:${o.id}` }]),
    [{ text: DECLINE_LABEL, callback_data: `${CONTACT_CB.no}:${orders[0].id}` }],
  ];
}

/* ── Поддержка @RobloxBank_PA ───────────────────────────────────────────── */

/**
 * Вопрос «добавить этот аккаунт к заказу?» в чате поддержки.
 * `true` — сообщение обработано здесь (ИИ и шаблон молчат).
 */
export async function offerFromSupport(bot: Telegraf, api: Api, m: {
  connId: string; chatId: number; messageId: number; from: Who; text: string;
  /** file_id фото, если прислали скриншот (17.11.2026: код часто только на скрине чата WB). */
  photoFileId?: string | null;
  /** Запустил оператор командой `/привязать`: улики уже собраны, отчёт — в беседу админов. */
  operator?: { clues: ReturnType<typeof extractOrderClues> };
}): Promise<boolean> {
  let clues = m.operator?.clues ?? (m.text ? extractOrderClues(m.text) : { codes: [], passIds: [], nicks: [] });
  const sender = await db.user.findUnique({ where: { tgId: String(m.from.id) }, select: { id: true } });
  const miss = async (why: string) => {
    if (m.operator) await card(bot, `🔗 /привязать в чате <b>${escapeHtml(tgLabel(m.from))}</b>: ${why}.`).catch(() => undefined);
    return false;
  };

  // 📸 Улик в тексте нет, но есть скриншот — читаем его Tesseract'ом. Только
  // для тех, у кого своих заказов нет: свои скрины (Pending, пасс) разбирает ИИ,
  // и держать его ответ ради OCR незачем.
  if (!m.operator && !hasClues(clues) && m.photoFileId) {
    const own = sender ? await db.wbOrder.count({ where: { userId: sender.id } }) : 0;
    if (own > 0) return false;
    const url = await bot.telegram.getFileLink(m.photoFileId).then(String).catch(() => null);
    const text = url ? await ocrImageText(url, ocrLooksUseful) : null;
    clues = text ? cluesFromOcr(text) : clues;
    console.log(`[order-contacts] скрин: ${text ? `${text.length} симв., кандидатов кода ${clues.codes.length}` : "не прочитался"}`);
  }

  if (!hasClues(clues)) return miss("в переписке нет ни кода, ни ссылки, ни пасса, ни ника");
  const orders = await findOrdersByClues(db, clues);
  if (!orders.length) return miss("по тому, что прислал клиент, заказ не найден");
  const plan = await planContactOffer(db, { senderUserId: sender?.id ?? null, orders });

  const send = (text: string, keyboard?: unknown[][]) => api("sendMessage", {
    business_connection_id: m.connId, chat_id: m.chatId, text, parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
  });
  const read = () => api("readBusinessMessage", { business_connection_id: m.connId, chat_id: m.chatId, message_id: m.messageId }).catch(() => undefined);

  if (plan.kind === "none") return miss("заказ не найден");
  if (plan.kind === "known") return miss(`заказ ${orders[0].wbCode} уже привязан к этому аккаунту`);
  if (plan.kind === "old") return miss(`заказ ${orders[0].wbCode} выкуплен больше месяца назад — подключать незачем`);

  if (plan.kind === "blocked") {
    await send(blockedText(plan.reason));
    await read();
    if (plan.reason !== "ambiguous") {
      const o = plan.orders[0];
      await card(bot,
        `🔗 <b>${escapeHtml(tgLabel(m.from))}</b> пишет в поддержку с другого аккаунта и назвал заказ <b>${o.wbCode}</b> (${o.amount} R$).\n` +
        `Подключить сам бот не смог: ${plan.reason === "held" ? heldLabel(o.heldReason) : plan.reason === "revoked" ? "по коду возврат WB" : "у заказа уже 5 аккаунтов"}.\n` +
        (m.text ? `💬 «${escapeHtml(m.text.slice(0, 300))}»` : "📸 по скриншоту"),
      ).catch(() => undefined);
    }
    console.log(`[order-contacts] поддержка: не подключаем (${plan.reason})`);
    return true;
  }

  rememberOffer(offerKey("TG", m.from.id), plan.orders);
  await send(offerText(plan.orders, "TG"), offerKeyboard(plan.orders));
  await read();
  console.log(`[order-contacts] поддержка: предложили ${plan.orders.length} заказ(а) по «${plan.orders[0].clue}»`);
  return true;
}

/* ── Бот ────────────────────────────────────────────────────────────────── */

/**
 * Код в боте занят другим аккаунтом на этой же площадке. Вместо тупика —
 * тот же вопрос. `false` — предложить нечего (пусть работает старый ответ).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function offerInBot(ctx: any, code: string): Promise<boolean> {
  const tgId = String(ctx.from.id);
  const orders = await findOrdersByClues(db, { codes: [code], passIds: [], nicks: [] });
  if (!orders.length) return false;
  const sender = await db.user.findUnique({ where: { tgId }, select: { id: true } });
  const plan = await planContactOffer(db, { senderUserId: sender?.id ?? null, orders });
  if (plan.kind === "blocked") {
    await ctx.reply(blockedText(plan.reason));
    return true;
  }
  if (plan.kind !== "offer") return false;
  rememberOffer(offerKey("TG", tgId), plan.orders);
  await ctx.reply(offerText(plan.orders, "TG"), { parse_mode: "HTML", reply_markup: { inline_keyboard: offerKeyboard(plan.orders) } });
  return true;
}

/* ── Кнопки ─────────────────────────────────────────────────────────────── */

export function registerOrderContactActions(bot: Telegraf): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const api: Api = (method, payload) => (bot.telegram as any).callApi(method, payload);

  bot.action(/^oc_(add|no|rm):/, async (ctx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cq = ctx.callbackQuery as any;
    const parsed = parseContactCallback(cq?.data ?? "");
    await ctx.answerCbQuery().catch(() => undefined);
    if (!parsed) return;
    const from = ctx.from as Who;
    const msg = cq?.message;
    const connId: string | undefined = msg?.business_connection_id;
    const chatId = msg?.chat?.id;

    // Ответ туда же, откуда нажали: чат поддержки (через Business) или бот.
    const reply = (html: string, keyboard?: unknown[][]) => connId
      ? api("sendMessage", {
          business_connection_id: connId, chat_id: chatId, text: html, parse_mode: "HTML",
          link_preview_options: { is_disabled: true },
          ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
        })
      : ctx.reply(html, { parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}) } as never);
    // Кнопки вопроса убираем, чтобы не нажали дважды.
    const dropKeyboard = () => msg?.message_id
      ? api("editMessageReplyMarkup", {
          ...(connId ? { business_connection_id: connId } : {}),
          chat_id: chatId, message_id: msg.message_id, reply_markup: { inline_keyboard: [] },
        }).catch(() => undefined)
      : Promise.resolve();

    try {
      if (parsed.action === "rm") {
        const presser = await db.user.findUnique({ where: { tgId: String(from.id) }, select: { id: true } });
        const res = await removeOrderContact(db, { contactId: parsed.id, pressedByUserId: presser?.id ?? null, by: "owner" });
        const self = !res.ok && res.reason === "forbidden"
          ? await removeOrderContact(db, { contactId: parsed.id, pressedByUserId: presser?.id ?? null, by: "self" })
          : res;
        await dropKeyboard();
        if (self.ok) await reply("Готово, этот аккаунт больше не получает уведомления о заказе.");
        else if (self.reason === "already") await reply("Этот аккаунт уже убран.");
        return;
      }

      const key = offerKey("TG", from.id);
      const offer = takeOffer(key, parsed.id);
      if (!offer) {
        await dropKeyboard();
        await reply(STALE_OFFER_TEXT);
        return;
      }

      if (parsed.action === "no") {
        dropOffer(key);
        await dropKeyboard();
        await recordContactDeclined(db, parsed.id, { platform: "TG", label: tgLabel(from), clue: offer.clue });
        await reply(declinedText());
        return;
      }

      // «Да»: профиль отправителя появляется в базе здесь, если его ещё не было.
      const tgId = String(from.id);
      const name = [from.first_name, from.last_name].filter(Boolean).join(" ") || null;
      const user = await db.user.upsert({
        where: { tgId },
        create: { tgId, name, username: from.username ?? null },
        update: from.username ? { username: from.username } : {},
        select: { id: true },
      });
      const label = tgLabel(from);
      const res = await addOrderContact(db, {
        orderId: parsed.id, userId: user.id,
        via: connId ? supportVia(offer.clue) : "bot_code",
        evidence: offer.evidence, platform: "TG", label,
      });
      dropOffer(key);
      await dropKeyboard();
      if (!res.ok) {
        await reply(blockedText(res.reason));
        return;
      }
      const inBot = !connId;
      await reply(addedText(res.order, { inBot }), inBot ? undefined : [[{ text: "🔔 Получать уведомления", url: BOT_URL }]]);
      if (res.created) {
        await notifyContactOwner(res.order.user, res.order, res.contactId, { platform: "TG", label: from.first_name || label });
      }
      // 📌 Закреп заказа в чате поддержки — сразу, как у своих заказов (17.11.2026).
      // Только по коду: в закрепе виден код, а по нику его не показываем.
      if (connId && res.order.clue === "code") {
        void pinPaOrdersNow(tgId).catch((e) => console.warn("[pa-pin] сразу после привязки:", e instanceof Error ? e.message : e));
      }
      console.log(`[order-contacts] подключён TG-аккаунт к заказу ${res.order.wbCode} (${connId ? "поддержка" : "бот"}, ${offer.clue})`);
    } catch (err) {
      console.warn("[order-contacts] кнопка упала:", err instanceof Error ? err.message : err);
      await reply("Не получилось — менеджер посмотрит и ответит здесь.").catch(() => undefined);
    }
  });
}

/* ── /привязать — оператор в чате с клиентом (17.11.2026) ──────────────────
   Оператор пишет в чате с клиентом `/привязать` (можно с кодом/ником после
   пробела). Бот удаляет команду и задаёт клиенту тот же вопрос с кнопками. Без
   аргумента — сам читает последние 30 сообщений клиента и его свежий скриншот
   (через аккаунт поддержки, `paRecentCustomerText`). Итог, если вопрос не ушёл, —
   строкой в тему поддержки беседы админов.
   ───────────────────────────────────────────────────────────────────────── */

export const OPERATOR_LINK_RE = /^\/(?:привязать|link)(?:@\w+)?(?:\s+([\s\S]*))?$/i;

export async function operatorLinkCommand(bot: Telegraf, api: Api, m: {
  connId: string; chatId: number; messageId: number; customer: Who; arg: string;
}): Promise<void> {
  await api("deleteBusinessMessages", { business_connection_id: m.connId, message_ids: [m.messageId] })
    .catch((e: unknown) => console.warn("[order-contacts] /привязать не удалилась:", e instanceof Error ? e.message : e));
  let clues = extractOrderClues(m.arg);
  if (!m.arg.trim()) {
    const recent = await paRecentCustomerText(String(m.customer.id)).catch(() => ({ text: "", ocr: null }));
    const fromText = extractOrderClues(recent.text);
    // Ник из «одного слова» работает построчно — склейка всех строк его теряет.
    const perLine = recent.text.split("\n").map(extractOrderClues);
    const fromOcr = recent.ocr ? cluesFromOcr(recent.ocr) : { codes: [], passIds: [], nicks: [] };
    clues = {
      codes: [...new Set([...fromText.codes, ...perLine.flatMap((c) => c.codes), ...fromOcr.codes])],
      passIds: [...new Set([...fromText.passIds, ...perLine.flatMap((c) => c.passIds), ...fromOcr.passIds])],
      nicks: [...new Set(perLine.flatMap((c) => c.nicks))],
    };
    console.log(`[order-contacts] /привязать: прочитано ${recent.text.length} симв.${recent.ocr ? " + скрин" : ""}, кодов-кандидатов ${clues.codes.length}, ников ${clues.nicks.length}`);
  }
  await offerFromSupport(bot, api, {
    connId: m.connId, chatId: m.chatId, messageId: m.messageId, from: m.customer, text: m.arg, operator: { clues },
  });
}
