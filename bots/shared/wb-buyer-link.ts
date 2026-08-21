import type { PrismaClient } from "@prisma/client";
import { wbSecretHmac } from "./wb-delivery-crypto";

/**
 * Привязка DBS-заказа к настоящему покупателю.
 *
 * Заказ на выкуп, открытый оператором из консоли DBS, привязывается к владельцу
 * гейт-кода — а к этому моменту код по определению ещё никем не активирован,
 * владельца нет, и заказ падает на служебного `tgId: "admin"`. Покупатель после
 * этого невидим: ни «Мой заказ», ни уведомлений, ни возможности написать ему.
 * На этом аккаунте успело скопиться 12 чужих заказов.
 *
 * Разбор: docs/wb-dbs-review-2026-08-20.md, находки F3 и F14.
 */

type Db = Pick<PrismaClient, "user" | "wbOrder" | "wbCode" | "wbDeliverySecret" | "$transaction">;

/** Технический пользователь, на который падают «ничьи» заказы. */
export const SERVICE_USER_TG_ID = "admin";

/**
 * Сколько времени после получения кода доставки бот привязывает покупателя сам.
 *
 * Решение владельца (О5): три часа. Дальше — только человек, потому что код
 * доставки пятизначный и с ростом окна растёт и осмысленность перебора.
 */
export const AUTO_LINK_WINDOW_MS = 3 * 60 * 60_000;

/** Заказ принадлежит служебному аккаунту, то есть покупатель ещё не найден. */
export function isServiceOwned(user: { tgId: string | null } | null | undefined): boolean {
  return user?.tgId === SERVICE_USER_TG_ID;
}

export type BuyerLinkResult =
  | { ok: true; userId: string; display: string; wbCode: string; alreadyLinked: boolean }
  | { ok: false; reason: "user_not_found" | "order_not_found" | "owned_by_other" };

function displayName(user: { name: string | null; username: string | null; tgId: string | null; vkId: string | null }) {
  if (user.username) return `@${user.username}`;
  if (user.name) return user.name;
  return user.tgId ? `tg:${user.tgId}` : user.vkId ? `vk:${user.vkId}` : "покупатель";
}

/**
 * Находит пользователя по тому, что оператор скопировал: `@username`, числовой
 * Telegram id, `vk:123` или ссылку `vk.com/id123`. Специально терпимо к формату —
 * оператор копирует из разных мест и не обязан помнить наш синтаксис.
 */
export async function resolveBuyerUser(db: Db, raw: string) {
  const value = raw.trim();
  if (!value) return null;
  const vkMatch = value.match(/(?:vk(?:\.com)?[:/]+(?:id)?)(\d{3,})/i);
  if (vkMatch) return db.user.findFirst({ where: { vkId: vkMatch[1] } });
  if (value.startsWith("@")) {
    return db.user.findFirst({ where: { username: { equals: value.slice(1), mode: "insensitive" } } });
  }
  if (/^\d{5,}$/.test(value)) {
    return (await db.user.findFirst({ where: { tgId: value } }))
      ?? (await db.user.findFirst({ where: { vkId: value } }));
  }
  return db.user.findFirst({ where: { username: { equals: value, mode: "insensitive" } } });
}

/**
 * Перевешивает заказ и код на настоящего покупателя.
 *
 * Никогда не отбирает заказ у живого пользователя: если владелец уже не
 * служебный и не совпадает с новым, операция отклоняется. Иначе достаточно было
 * бы угадать код, чтобы увести чужой заказ.
 */
export async function linkWbOrderToBuyer(
  db: Db,
  activationCode: string,
  userId: string,
  actor: string,
): Promise<BuyerLinkResult> {
  const [buyer, order, code] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { id: true, name: true, username: true, tgId: true, vkId: true } }),
    db.wbOrder.findUnique({
      where: { wbCode: activationCode },
      select: { id: true, userId: true, adminNote: true, user: { select: { tgId: true } } },
    }),
    db.wbCode.findFirst({ where: { code: activationCode }, select: { id: true, userId: true } }),
  ]);
  if (!buyer) return { ok: false, reason: "user_not_found" };
  if (!order && !code) return { ok: false, reason: "order_not_found" };
  if (order && order.userId === buyer.id) {
    return { ok: true, userId: buyer.id, display: displayName(buyer), wbCode: activationCode, alreadyLinked: true };
  }
  if (order && !isServiceOwned(order.user)) return { ok: false, reason: "owned_by_other" };

  const note = `[ПРИВЯЗКА ${new Date().toISOString().slice(0, 10)} ${actor}] заказ перевешен на ${displayName(buyer)}`;
  await db.$transaction(async (tx) => {
    if (order) {
      await tx.wbOrder.update({
        where: { id: order.id },
        data: {
          userId: buyer.id,
          adminNote: order.adminNote ? `${note}\n${order.adminNote}`.slice(0, 2_000) : note,
        },
      });
    }
    // Код тоже переезжает: по нему бот ищет заказ в «Мой заказ» и в /start.
    if (code && code.userId !== buyer.id) {
      await tx.wbCode.update({ where: { id: code.id }, data: { userId: buyer.id } });
    }
  });
  return { ok: true, userId: buyer.id, display: displayName(buyer), wbCode: activationCode, alreadyLinked: false };
}

export type DeliveryCodeMatch = {
  marketplaceOrderId: string;
  wbOrderId: string;
  activationCode: string | null;
  receivedAt: Date;
  /** Внутри трёхчасового окна бот привязывает сам; снаружи — зовёт человека. */
  withinAutoWindow: boolean;
  /** Заказ уже принадлежит живому покупателю — привязывать нечего. */
  alreadyOwned: boolean;
};

/**
 * Ищет DBS-заказ по коду доставки Wildberries, который покупатель прислал в
 * бота вместо нашего кода. Совпадение точное — по keyed-hash, не по подстроке.
 *
 * Возвращает `null`, если совпадения нет. Вызывающая сторона **обязана**
 * показать один и тот же текст и при совпадении, и при промахе за пределами
 * окна: иначе бот становится оракулом для перебора пятизначного кода.
 */
export async function findDbsOrderByDeliveryCode(db: Db, code: string): Promise<DeliveryCodeMatch | null> {
  const digits = code.trim();
  if (!/^\d{5,6}$/.test(digits)) return null;
  let hmac: string;
  try {
    hmac = wbSecretHmac(digits, "delivery-code");
  } catch {
    // Ключ шифрования не настроен — молча ничего не ищем.
    return null;
  }
  const secret = await db.wbDeliverySecret.findFirst({
    where: { codeHmac: hmac },
    orderBy: { receivedAt: "desc" },
    select: {
      marketplaceOrderId: true,
      receivedAt: true,
      marketplaceOrder: {
        select: {
          wbOrderId: true,
          cancelledAt: true,
          wbCode: { select: { code: true } },
        },
      },
    },
  } as never) as {
    marketplaceOrderId: string;
    receivedAt: Date;
    marketplaceOrder: { wbOrderId: string; cancelledAt: Date | null; wbCode: { code: string } | null };
  } | null;
  if (!secret || secret.marketplaceOrder.cancelledAt) return null;

  const activationCode = secret.marketplaceOrder.wbCode?.code ?? null;
  const internal = activationCode
    ? await db.wbOrder.findUnique({
      where: { wbCode: activationCode },
      select: { user: { select: { tgId: true } } },
    })
    : null;
  return {
    marketplaceOrderId: secret.marketplaceOrderId,
    wbOrderId: secret.marketplaceOrder.wbOrderId,
    activationCode,
    receivedAt: secret.receivedAt,
    withinAutoWindow: Date.now() - secret.receivedAt.getTime() <= AUTO_LINK_WINDOW_MS,
    alreadyOwned: Boolean(internal && !isServiceOwned(internal.user)),
  };
}

/**
 * Простой счётчик попыток в памяти процесса: три обращения в час на человека.
 *
 * Пространство пятизначного кода мало, и без ограничения бота можно было бы
 * использовать для перебора. В памяти — сознательно: перезапуск воркера сбросит
 * счётчик, но окно привязки и так три часа, а лишняя таблица здесь дороже риска.
 */
const attempts = new Map<string, { count: number; resetAt: number }>();

export function allowDeliveryCodeAttempt(key: string, limit = 3, windowMs = 60 * 60_000): boolean {
  const now = Date.now();
  if (attempts.size > 5_000) {
    for (const [k, v] of attempts) if (v.resetAt < now) attempts.delete(k);
  }
  const entry = attempts.get(key);
  if (!entry || entry.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  entry.count += 1;
  return entry.count <= limit;
}
