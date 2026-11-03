import type { PrismaClient } from "@prisma/client";
import { resolveWbOrderRef } from "./wb-order-source";

/**
 * Нить обычного (не-DBS) заказа в админке.
 *
 * У DBS-заказа есть живая карточка, и всё о нём пришивается ответом к ней
 * (`wb-dbs-thread` + `WbMarketplaceOrder.adminCardMessages`). У обычного
 * WB-заказа живой карточки нет, и его сообщения оставались россыпью: карточка
 * активации кода («⌛ Ожидаем ссылку на геймпасс») и карточка выкупа («⏳ В
 * обработке» с кнопками) приходили с разницей в минуты или часы и выглядели
 * как два разных дела — при том, что обе называют один и тот же код
 * (скрин владельца по заказу `9DVCQRM`, 02.09.2026).
 *
 * Корень ветки — первая карточка о заказе. Её `message_id` у каждого админа
 * складывается сюда, и вторая карточка уходит ответом на неё: Telegram рисует
 * цитату, тап прыгает к началу.
 *
 * Почему `OrderEvent`, а не колонка в `WbOrder`: миграция ради поля, которое
 * читают ровно два отправителя, дороже строки в уже существующей таблице
 * аудита, а `idempotencyKey` даёт нужную уникальность «один корень на заказ»
 * бесплатно.
 */

type Db = Pick<PrismaClient, "orderEvent">;

const ROOT_TYPE = "ADMIN_CARD_ROOT";

const rootKey = (orderId: string): string => `admin-card-root:${orderId}`;

/** `payload` — свободный JSON, поэтому форма проверяется на входе. */
function rootsOf(raw: unknown): Record<string, number> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<string, number> = {};
  for (const [adminId, messageId] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof messageId === "number" && Number.isInteger(messageId) && messageId > 0) {
      out[adminId] = messageId;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Запомнить корень ветки заказа: `{ "<adminTgId>": <messageId> }`.
 *
 * Последняя запись побеждает целиком, а не сливается по админам: корень — это
 * карточка, которая сейчас на экране. Слияние оставило бы указатель на самую
 * старую, а ответ на давно уехавшее вверх сообщение ветку не собирает.
 *
 * Никогда не бросает: оформление сообщения не имеет права уронить обработку
 * заказа, ради которого оно отправлено.
 */
export async function recordOrderCardRoot(
  db: Db,
  orderId: string,
  messages: Record<string, number | null | undefined>,
): Promise<void> {
  const payload = rootsOf(messages);
  if (!orderId || !payload) return;
  try {
    await db.orderEvent.upsert({
      where: { idempotencyKey: rootKey(orderId) },
      create: { orderId, type: ROOT_TYPE, idempotencyKey: rootKey(orderId), payload },
      update: { payload },
    });
  } catch (error) {
    console.error("[order-thread] root save failed:", (error as { code?: string })?.code ?? "unknown");
  }
}

/**
 * Корень ветки по коду ВБ — то, к чему пришивается следующая карточка заказа.
 *
 * По коду, а не по id заказа, потому что оба отправителя карточек знают именно
 * код: карточку выкупа собирают из `WbOrder`, а связь «этот код уже засветился
 * в админке» живёт раньше и переживает замену заказа.
 */
export async function orderCardRoots(
  db: Db,
  code: string,
): Promise<Record<string, number> | null> {
  if (!code) return null;
  try {
    const event = await db.orderEvent.findFirst({
      where: { type: ROOT_TYPE, order: { wbCode: code } },
      orderBy: { createdAt: "desc" },
      select: { payload: true },
    });
    return rootsOf(event?.payload);
  } catch {
    return null;
  }
}

/**
 * Корень ветки заказа — ОДНОЙ функцией для всех отправителей.
 *
 * У заказа два возможных корня, и раньше про них знали только две карточки
 * выкупа: живая карточка DBS (`WbMarketplaceOrder.adminCardMessages`), а если
 * доставки не было — карточка активации кода (`ADMIN_CARD_ROOT`). Все
 * остальные сообщения о том же заказе — обращение в поддержку, подтверждённый
 * выкуп, скриншот оплаты, скриншот отзыва — уходили россыпью, хотя код заказа
 * знали все до одного.
 *
 * Порядок проверки повторяет `sendWebOrderCard`: живая карточка старше и
 * переживает замену заказа, поэтому она первая.
 *
 * Никогда не бросает и никогда не блокирует отправку: ветка — это оформление,
 * а сообщение может быть о деньгах.
 */
export async function orderThreadRoots(
  db: Db & { wbMarketplaceOrder?: unknown },
  code: string | null | undefined,
): Promise<Record<string, number> | null> {
  if (!code) return null;
  try {
    const wbRef = await resolveWbOrderRef(db, code);
    if (wbRef.cardMessages) return wbRef.cardMessages;
  } catch { /* нет доставки — обычный WB-заказ */ }
  return orderCardRoots(db, code);
}

/**
 * Поля ответа для одного админа. `allow_sending_without_reply` обязателен:
 * корень могли удалить или переслать заново, и Telegram отказал бы в отправке
 * целиком — уведомление не имеет права потеряться из-за оформления.
 */
export function replyToRoot(
  roots: Record<string, number> | null | undefined,
  adminId: string,
): Record<string, unknown> {
  const rootId = roots?.[adminId];
  return rootId ? { reply_to_message_id: rootId, allow_sending_without_reply: true } : {};
}
