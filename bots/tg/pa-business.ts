/* ─────────────────────────────────────────────────────────────────────────────
   @RobloxBankBot как «секретарь» аккаунта поддержки @RobloxBank_PA (12.11.2026).

   Telegram Business присылает боту `business_message` — сообщения из личных
   чатов аккаунта (и входящие, и те, что пишет оператор). Telegraf 4.16 таких
   обновлений не знает, поэтому разбираем их сырыми, до остальных обработчиков,
   и дальше не пропускаем: обычные ветки бота отвечать в чужие чаты не должны.

   Отвечаем только на «где мой заказ» и только тем, что знаем из базы
   (`paOrderReply`). Оператор писал в чат за последние 30 минут — молчим: идёт
   живой разговор. Тот же вопрос второй раз за 10 минут — молчим.
   Выключатель — `PA_BUSINESS_REPLY=off`.
   ───────────────────────────────────────────────────────────────────────── */

import { registerAiTeacher } from "./ai-teacher";
import { registerNickProposals } from "./support-ai-nick";
import type { Telegraf } from "telegraf";
import { db } from "../shared/db";
import { isRepeatEtaQuestion } from "../shared/robux-eta";
import { isOrderStatusQuestion, paBotRedirectReply, paOrderReply } from "../shared/pa-business-reply";
import { handleWithAi, handledDuringHandoff, operatorReplied, paAiMode, registerPaAiAdmin, rememberTurn } from "./pa-ai";
import { registerPaGroup } from "./pa-group";
import { registerReleaseNotes } from "./release-notes";
import { registerWatchList } from "./watch-list";
import { registerWbReply } from "./wb-reply";
import { registerWbReviewCards } from "./wb-review-cards";
import { registerAiJudge } from "./ai-judge";
import { registerCodesIssueReply } from "./codes-issue-reply";
import { registerWbMorningDigest } from "./wb-morning-digest";
import { registerNoticeStatsReport } from "./notice-stats-report";
import { OPERATOR_LINK_RE, offerFromSupport, operatorLinkCommand, registerOrderContactActions } from "./order-contacts-tg";
import { attachPassFromSupport } from "./pa-gamepass";
import { setPaRatingSender } from "./pa-desk-worker";
import { RATING_KEYBOARD, RATING_TEXT, ratingThanks, recordRatingVote } from "../shared/pa-rating";
import { CODE_VIAS } from "../shared/order-contacts";

const OPERATOR_QUIET_MS = 30 * 60_000;

/** Чат → когда в нём последний раз писал оператор (память процесса). */
const operatorAt = new Map<number, number>();
/** Подключение → id владельца аккаунта (оператор = он). */
const ownerOf = new Map<string, number>();

/**
 * 🪪 Профиль каждому, кто написал в поддержку (17.11.2026).
 *
 * У многих покупателей нет @username («Ви💗чка»): найти их потом можно только
 * по числовому Telegram ID, а он приходил нам лишь в самом сообщении и нигде не
 * оставался. Теперь первое же сообщение в @RobloxBank_PA заводит профиль
 * (`User.tgId` + имя), а смена @username подхватывается. Заказов это не создаёт;
 * воркер разметки обращается с профилем без заказов так же, как с «нет в базе».
 * Реферальное правило «не новый» с этого дня смотрит на заказы, а не на дату
 * профиля (`src/lib/codes/referral.ts`).
 */
const profiled = new Set<string>();
/** Последнее подключение Business — по нему бот пишет в чаты аккаунта по своей инициативе (оценка). */
let lastConnId: string | null = null;
async function ensurePaProfile(from: BusinessMessage["from"]): Promise<void> {
  if (!from?.id || from.is_bot) return;
  const tgId = String(from.id);
  if (profiled.has(tgId)) return;
  const name = [from.first_name, from.last_name].filter(Boolean).join(" ").trim() || null;
  const row = await db.user.findUnique({ where: { tgId }, select: { id: true, username: true } });
  if (!row) {
    await db.user.create({ data: { tgId, name, username: from.username ?? null } }).catch(() => undefined);
    console.log("[pa-business] новый профиль из поддержки");
  } else if (from.username && row.username !== from.username) {
    await db.user.update({ where: { id: row.id }, data: { username: from.username } }).catch(() => undefined);
  }
  profiled.add(tgId);
  if (profiled.size > 20_000) profiled.clear();
}

interface BusinessMessage {
  business_connection_id: string;
  message_id: number;
  chat: { id: number; first_name?: string; last_name?: string; username?: string };
  from?: { id: number; is_bot?: boolean; first_name?: string; last_name?: string; username?: string };
  text?: string;
  caption?: string;
  photo?: unknown[];
  document?: unknown;
  video?: unknown;
  voice?: unknown;
  sender_business_bot?: { id: number };
}

export function paBusinessReplyEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.PA_BUSINESS_REPLY ?? "").trim().toLowerCase() !== "off";
}

export function registerPaBusiness(bot: Telegraf): void {
  // Команды беседы админов и кнопки карточек ИИ-поддержки — раньше общих обработчиков.
  registerPaAiAdmin(bot);
  registerAiTeacher(bot);
  registerNickProposals(bot);
  registerAiJudge(bot);
  // 🔗 Контакты заказа (17.11.2026): «да / не мой / убрать» — и из чата
  // поддержки, и из бота, и у владельца. До защиты беседы админов.
  registerOrderContactActions(bot);
  // Тема «Апдейты» + публикация клиентам по кнопке (14.11.2026). ДО защиты
  // беседы: она пропускает нажатия кнопок только из «Уведов», а «Апдейты»
  // живут в беседе админов — «Опубликовать» молча отбрасывалось (15.11.2026).
  // Права проверяет сам обработчик (только ADMIN_IDS).
  registerReleaseNotes(bot);
  // 👁 «Под наблюдением» (15.11.2026): /watch, /unwatch, /watchlist — тоже до защиты беседы.
  registerWatchList(bot);
  // 💬 Ответ в чат WB из Telegram и ☀️ утренняя сводка WB (15.11.2026) — до беседы админов.
  registerCodesIssueReply(bot);
  registerWbReply(bot);
  registerWbReviewCards(bot);
  registerWbMorningDigest(bot);
  registerNoticeStatsReport(bot);
  // Беседа админов: защита от ответов в группе, ассистент, темы, сводка.
  registerPaGroup(bot);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const api = (method: string, payload: Record<string, unknown>) => (bot.telegram as any).callApi(method, payload);

  // ⭐ Тихая оценка поддержки (17.11.2026): воркер решает «когда», бот — отправляет.
  setPaRatingSender(async (tgId: string) => {
    if (!lastConnId) return false;
    try {
      await api("sendMessage", {
        business_connection_id: lastConnId, chat_id: Number(tgId), text: RATING_TEXT,
        disable_notification: true, reply_markup: { inline_keyboard: RATING_KEYBOARD },
      });
      return true;
    } catch (error) {
      console.warn(`[pa-rating] вопрос не ушёл: ${error instanceof Error ? error.message : error}`);
      return false;
    }
  });
  bot.action(/^pr:(up|dn)$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => undefined);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cq = ctx.callbackQuery as any;
    const vote = cq?.data === "pr:up" ? "up" : "down";
    const msg = cq?.message;
    await recordRatingVote(db, vote).catch(() => undefined);
    if (msg?.message_id) {
      await api("editMessageText", {
        ...(msg.business_connection_id ? { business_connection_id: msg.business_connection_id } : {}),
        chat_id: msg.chat?.id, message_id: msg.message_id, text: ratingThanks(vote),
      }).catch(() => undefined);
    }
    console.log(`[pa-rating] оценка ${vote === "up" ? "👍" : "👎"}`);
  });

  async function ownerId(connId: string): Promise<number | null> {
    const cached = ownerOf.get(connId);
    if (cached) return cached;
    try {
      const conn = await api("getBusinessConnection", { business_connection_id: connId });
      const id = Number(conn?.user?.id);
      if (!id) return null;
      ownerOf.set(connId, id);
      console.log(`[pa-business] подключение: аккаунт ${id}, ответы ${conn?.rights?.can_reply ? "разрешены" : "ЗАПРЕЩЕНЫ"}, enabled=${conn?.is_enabled}`);
      return id;
    } catch (error) {
      console.warn(`[pa-business] getBusinessConnection: ${error instanceof Error ? error.message : error}`);
      return null;
    }
  }

  bot.use(async (ctx, next) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const update = ctx.update as any;
    if (update.business_connection) {
      const c = update.business_connection;
      if (c?.id && c?.user?.id) ownerOf.set(c.id, Number(c.user.id));
      if (c?.id && c?.is_enabled !== false) lastConnId = c.id;
      console.log(`[pa-business] подключение обновлено: enabled=${c?.is_enabled}, ответы ${c?.rights?.can_reply ? "разрешены" : "запрещены"}`);
      return;
    }
    if (update.edited_business_message || update.deleted_business_messages) return;
    const msg: BusinessMessage | undefined = update.business_message;
    if (!msg) return next();
    lastConnId = msg.business_connection_id;

    try {
      const owner = await ownerId(msg.business_connection_id);
      const fromId = msg.from?.id ?? 0;
      // Пишет сам аккаунт (оператор) или бот от его имени — это не вопрос.
      if (msg.sender_business_bot || (owner && fromId === owner)) {
        // 🔗 `/привязать [код|ник]` — оператор просит бота подключить клиента к
        // заказу (17.11.2026). Команду бот удаляет, клиенту уходит вопрос с кнопками.
        const linkCmd = !msg.sender_business_bot ? (msg.text ?? "").trim().match(OPERATOR_LINK_RE) : null;
        if (linkCmd) {
          await operatorLinkCommand(bot, api, {
            connId: msg.business_connection_id, chatId: msg.chat.id, messageId: msg.message_id,
            customer: { id: msg.chat.id, first_name: msg.chat.first_name, last_name: msg.chat.last_name, username: msg.chat.username },
            arg: linkCmd[1] ?? "",
          }).catch((e) => console.warn("[order-contacts] /привязать:", e instanceof Error ? e.message : e));
          return;
        }
        // 📌 Закреп заказа ставит воркер от имени аккаунта — это не живой ответ оператора.
        const isOrderPin = /^📌 Ваш(и)? заказ/.test(msg.text ?? "");
        if (!msg.sender_business_bot && !isOrderPin) {
          operatorAt.set(msg.chat.id, Date.now());
          operatorReplied(msg.chat.id, (msg.text ?? msg.caption ?? "").trim());
          rememberTurn(msg.chat.id, "assistant", (msg.text ?? msg.caption ?? "").trim());
        }
        return;
      }
      await ensurePaProfile(msg.from).catch(() => undefined);
      if (!paBusinessReplyEnabled()) return;
      const text = (msg.text ?? msg.caption ?? "").trim();
      const hasMedia = Boolean(msg.photo || msg.document || msg.video || msg.voice);
      // 🔗 Назвал заказ, оформленный с другого аккаунта (код, ссылка, пасс,
      // ник) — спрашиваем, добавить ли этот аккаунт к заказу (17.11.2026).
      // Раньше живого разговора: это не болтовня, а действие, и оператору
      // тоже удобнее, когда заказ уже привязан к чату.
      const photoFileId = Array.isArray(msg.photo) && msg.photo.length
        ? (msg.photo[msg.photo.length - 1] as { file_id?: string }).file_id ?? null
        : null;
      // 🎟 Пасс в поддержку → сам в заказ, если заказ ждёт пасс (17.11.2026).
      if (text) {
        const attached = await attachPassFromSupport(bot, api, {
          connId: msg.business_connection_id, chatId: msg.chat.id, messageId: msg.message_id,
          fromId, fromName: [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ") || "Покупатель", text,
        }).catch((error) => {
          console.warn(`[pa-gamepass] ${error instanceof Error ? error.message : error}`);
          return false;
        });
        if (attached) {
          rememberTurn(msg.chat.id, "user", text);
          await handledDuringHandoff(bot, msg.chat.id, [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ") || "Покупатель", text, "Бот сам принял геймпасс в заказ");
          return;
        }
      }
      if (text || photoFileId) {
        const offered = await offerFromSupport(bot, api, {
          connId: msg.business_connection_id, chatId: msg.chat.id, messageId: msg.message_id,
          from: { id: fromId, first_name: msg.from?.first_name, last_name: msg.from?.last_name, username: msg.from?.username },
          text, photoFileId,
        }).catch((error) => {
          console.warn(`[order-contacts] поддержка: ${error instanceof Error ? error.message : error}`);
          return false;
        });
        if (offered) {
          rememberTurn(msg.chat.id, "user", text || "[скриншот с кодом заказа]");
          await handledDuringHandoff(bot, msg.chat.id, [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ") || "Покупатель", text || "[скриншот]", "Бот сам ответил по присланному коду/нику (привязка заказа)");
          return;
        }
      }

      const lastOperator = operatorAt.get(msg.chat.id) ?? 0;
      if (Date.now() - lastOperator < OPERATOR_QUIET_MS) {
        rememberTurn(msg.chat.id, "user", text || "[фото/файл]");
        return;
      }

      // 🤖 «Где заказ / где Robux» — сразу короткий ответ по этапу + ссылка на
      // карточку в боте, до ИИ и до человека (15.11.2026). Повтор за 10 минут,
      // заморозка, ошибка, несколько живых заказов — дальше штатно (ИИ/человек).
      // С включённым ИИ (on) шаблон не перехватывает: «в Pending ничего нет» —
      // жалоба, а не вопрос статуса, и ИИ видит заказ (26.11.2026).
      if (text && isOrderStatusQuestion(text) && (await paAiMode()) !== "on") {
        const buyer = await db.user.findUnique({ where: { tgId: String(fromId) }, select: { id: true } });
        const list = buyer
          ? await db.wbOrder.findMany({
              where: { OR: [{ userId: buyer.id }, { contacts: { some: { userId: buyer.id, removedAt: null, via: { in: CODE_VIAS } } } }] }, orderBy: { createdAt: "desc" }, take: 10,
              select: { wbCode: true, amount: true, status: true, createdAt: true, completedAt: true, heldAt: true },
            })
          : [];
        const redirect = paBotRedirectReply(text, list);
        if (redirect && !isRepeatEtaQuestion(`pa:${fromId}`)) {
          await api("sendMessage", {
            business_connection_id: msg.business_connection_id, chat_id: msg.chat.id, text: redirect,
            link_preview_options: { is_disabled: true },
          });
          await api("readBusinessMessage", {
            business_connection_id: msg.business_connection_id, chat_id: msg.chat.id, message_id: msg.message_id,
          }).catch(() => undefined);
          rememberTurn(msg.chat.id, "user", text);
          console.log(`[pa-business] «загляните в бота» (${list[0]?.wbCode ?? "?"})`);
          return;
        }
      }

      // ИИ-поддержка (Claude Haiku 5.5) — если включена; иначе шаблон ниже.
      const name = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ") || "Покупатель";
      const handled = await handleWithAi(bot, {
        connId: msg.business_connection_id, chatId: msg.chat.id, messageId: msg.message_id,
        fromId, fromName: name, username: msg.from?.username ?? null, text, hasMedia,
        photoFileId: Array.isArray(msg.photo) && msg.photo.length
          ? (msg.photo[msg.photo.length - 1] as { file_id?: string }).file_id ?? null
          : null,
      }).catch((error) => {
        console.warn(`[pa-ai] обработка упала: ${error instanceof Error ? error.message : error}`);
        return false;
      });
      if (handled || !text) return;

      const user = await db.user.findUnique({ where: { tgId: String(fromId) }, select: { id: true } });
      if (!user) return;
      const orders = await db.wbOrder.findMany({
        where: { OR: [{ userId: user.id }, { contacts: { some: { userId: user.id, removedAt: null, via: { in: CODE_VIAS } } } }] },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { wbCode: true, amount: true, status: true, createdAt: true, completedAt: true, heldAt: true },
      });
      const reply = paOrderReply(text, orders);
      if (!reply) return;
      if (isRepeatEtaQuestion(`pa:${fromId}`)) return;

      await api("sendMessage", { business_connection_id: msg.business_connection_id, chat_id: msg.chat.id, text: reply });
      await api("readBusinessMessage", {
        business_connection_id: msg.business_connection_id, chat_id: msg.chat.id, message_id: msg.message_id,
      }).catch(() => undefined);
      console.log(`[pa-business] ответили на вопрос о заказе (${orders[0]?.wbCode ?? "?"})`);
    } catch (error) {
      console.warn(`[pa-business] ответ не ушёл: ${error instanceof Error ? error.message : error}`);
    }
  });
}
