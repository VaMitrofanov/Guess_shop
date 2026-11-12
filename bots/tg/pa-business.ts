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

import type { Telegraf } from "telegraf";
import { db } from "../shared/db";
import { isRepeatEtaQuestion } from "../shared/robux-eta";
import { paOrderReply } from "../shared/pa-business-reply";
import { handleWithAi, operatorReplied, registerPaAiAdmin, rememberTurn } from "./pa-ai";

const OPERATOR_QUIET_MS = 30 * 60_000;

/** Чат → когда в нём последний раз писал оператор (память процесса). */
const operatorAt = new Map<number, number>();
/** Подключение → id владельца аккаунта (оператор = он). */
const ownerOf = new Map<string, number>();

interface BusinessMessage {
  business_connection_id: string;
  message_id: number;
  chat: { id: number };
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const api = (method: string, payload: Record<string, unknown>) => (bot.telegram as any).callApi(method, payload);

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
      console.log(`[pa-business] подключение обновлено: enabled=${c?.is_enabled}, ответы ${c?.rights?.can_reply ? "разрешены" : "запрещены"}`);
      return;
    }
    if (update.edited_business_message || update.deleted_business_messages) return;
    const msg: BusinessMessage | undefined = update.business_message;
    if (!msg) return next();

    try {
      const owner = await ownerId(msg.business_connection_id);
      const fromId = msg.from?.id ?? 0;
      // Пишет сам аккаунт (оператор) или бот от его имени — это не вопрос.
      if (msg.sender_business_bot || (owner && fromId === owner)) {
        if (!msg.sender_business_bot) {
          operatorAt.set(msg.chat.id, Date.now());
          operatorReplied(msg.chat.id);
          rememberTurn(msg.chat.id, "assistant", (msg.text ?? msg.caption ?? "").trim());
        }
        return;
      }
      if (!paBusinessReplyEnabled()) return;
      const text = (msg.text ?? msg.caption ?? "").trim();
      const hasMedia = Boolean(msg.photo || msg.document || msg.video || msg.voice);
      const lastOperator = operatorAt.get(msg.chat.id) ?? 0;
      if (Date.now() - lastOperator < OPERATOR_QUIET_MS) {
        rememberTurn(msg.chat.id, "user", text || "[фото/файл]");
        return;
      }

      // ИИ-поддержка (Claude Haiku 5.5) — если включена; иначе шаблон ниже.
      const name = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ") || "Покупатель";
      const handled = await handleWithAi(bot, {
        connId: msg.business_connection_id, chatId: msg.chat.id, messageId: msg.message_id,
        fromId, fromName: name, username: msg.from?.username ?? null, text, hasMedia,
      }).catch((error) => {
        console.warn(`[pa-ai] обработка упала: ${error instanceof Error ? error.message : error}`);
        return false;
      });
      if (handled || !text) return;

      const user = await db.user.findUnique({ where: { tgId: String(fromId) }, select: { id: true } });
      if (!user) return;
      const orders = await db.wbOrder.findMany({
        where: { userId: user.id },
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
