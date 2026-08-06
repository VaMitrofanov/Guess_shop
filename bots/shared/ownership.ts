/**
 * Проверка владельца сущности для callback-кнопок ботов (ultra-review U6,
 * риск №24 в docs/security.md).
 *
 * `callback_data` — не доверенный ввод. В Telegram любой пользователь, у
 * которого есть хоть одно сообщение бота с inline-клавиатурой, может через
 * неофициальный MTProto-клиент вызвать `messages.getBotCallbackAnswer` с
 * произвольной строкой `data`; в VK так же отправляется произвольный `payload`.
 * Поэтому любая ветка, которая читает сущность по ID из кнопки, обязана
 * сверить владельца — иначе чужой заказ уходит в очередь на реальный выкуп.
 */

import { db } from "./db";

export type Actor = { platform: "TG" | "VK"; externalId: string };

export function tgActor(externalId: string | number): Actor {
  return { platform: "TG", externalId: String(externalId) };
}

export function vkActor(externalId: string | number): Actor {
  return { platform: "VK", externalId: String(externalId) };
}

/** Резолвит внутреннего `User` по внешнему идентификатору платформы. */
export async function resolveActorUserId(actor: Actor): Promise<string | null> {
  const where = actor.platform === "TG"
    ? { tgId: actor.externalId }
    : { vkId: actor.externalId };
  const user = await (db as any).user.findUnique({ where, select: { id: true } }).catch(() => null);
  return user?.id ?? null;
}

export type OwnershipResult<T> =
  | { ok: true; entity: T }
  | { ok: false; reason: "not_found" | "forbidden" };

/**
 * Читает заказ по ID и требует, чтобы он принадлежал вызывающему.
 * Нарушение логируется отдельной строкой — это сигнал попытки атаки, а не
 * бытовая ошибка.
 */
export async function assertOwnsOrder<T>(
  actor: Actor,
  orderId: string,
  select: Record<string, boolean>,
): Promise<OwnershipResult<T & { userId: string }>> {
  const order = await (db as any).wbOrder.findUnique({
    where: { id: orderId },
    select: { ...select, userId: true },
  }).catch(() => null);
  if (!order) return { ok: false, reason: "not_found" };

  const actorUserId = await resolveActorUserId(actor);
  if (!actorUserId || order.userId !== actorUserId) {
    console.warn(
      `[ownership] violation platform=${actor.platform} actor=${actor.externalId} ` +
      `order=${orderId} owner=${order.userId}`,
    );
    return { ok: false, reason: "forbidden" };
  }
  return { ok: true, entity: order as T & { userId: string } };
}

/** То же для `DirectIntent` (кнопка отмены заявки на прямой заказ). */
export async function assertOwnsIntent<T>(
  actor: Actor,
  intentId: string,
  select: Record<string, boolean>,
): Promise<OwnershipResult<T & { userId: string }>> {
  const intent = await (db as any).directIntent.findUnique({
    where: { id: intentId },
    select: { ...select, userId: true },
  }).catch(() => null);
  if (!intent) return { ok: false, reason: "not_found" };

  const actorUserId = await resolveActorUserId(actor);
  if (!actorUserId || intent.userId !== actorUserId) {
    console.warn(
      `[ownership] violation platform=${actor.platform} actor=${actor.externalId} ` +
      `intent=${intentId} owner=${intent.userId}`,
    );
    return { ok: false, reason: "forbidden" };
  }
  return { ok: true, entity: intent as T & { userId: string } };
}
