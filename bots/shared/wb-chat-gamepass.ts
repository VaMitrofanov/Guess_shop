/**
 * Геймпасс, присланный покупателем в чат Wildberries.
 *
 * Покупатели регулярно шлют ссылку на свой пасс не нам, а прямо в переписку WB
 * — там, где им до этого писали про доставку. До 07.09.2026 автоматика такие
 * сообщения не разбирала вовсе: оператору уходило только превью текста, а
 * заказ продолжал висеть в «ждёт геймпасс». Решение владельца 07.09.2026:
 * «если видишь в чате ВБ айди пасса — подставляй его в заказ автоматически,
 * ник при подстановке айди тоже парси и вставляй».
 *
 * Что здесь нельзя ослабить — иначе это дыра, а не удобство:
 *
 * 1. **Проверяем у Roblox, а не верим тексту.** Пасс должен существовать, быть
 *    выставлен на продажу, лежать в публичной игре и стоить ровно ту цену,
 *    которую мы просим (те же ±2 R$, что и в ботах).
 * 2. **Ник берём у пасса, а не у заказа.** Робуксы Roblox переводит ВЛАДЕЛЬЦУ
 *    пасса. Если у заказа уже стоит подтверждённый ник и он не совпал с
 *    владельцем — не подставляем ничего и зовём оператора: это ровно тот
 *    случай, ради которого на сайте живёт `OWNER_MISMATCH`.
 * 3. **Молчим, когда не уверены.** Число, которое Roblox не признал пассом
 *    (телефон, номер заказа WB), не порождает ни действия, ни уведомления.
 * 4. **Заморозку уважаем.** Замороженный заказ не собирается автоматикой.
 *
 * Оператор узнаёт о каждой подстановке отдельным сообщением — требование
 * владельца: «обязательно нужен увед, что в такой-то заказ поставил такой-то
 * гп айди». Карточка выкупа уходит следом обычным путём.
 */

import { getGamepassDetails } from "./roblox";
import { auditGamepassSubmitted, type OrderAuditClient } from "./order-audit";
import { countPreviousOrders } from "./order-loyalty";
import { sendAdminOrderCard } from "./admin";
import { notifyDbsChatGamepassAttached, notifyDbsChatGamepassRejected } from "./wb-delivery-admin-notify";
import type { DbsRef } from "./wb-delivery-admin-notify";

/** Ссылка на пасс в тексте: самый надёжный признак, ищем в любом месте строки. */
const URL_RE = /(?:game-pass(?:es)?|game_pass(?:es)?)\/(\d+)/i;
/**
 * Голый ID отдельным словом.
 *
 * 9–10 цифр — рабочее окно: пассы, которые создают сейчас, лежат около
 * 1 900 000 000, живые старые начинаются с девяти знаков. Одиннадцать — это уже
 * телефон, и такие числа в переписке о доставке встречаются чаще пассов.
 */
const BARE_RE = /(?<!\d)(\d{9,10})(?!\d)/g;

/** Расхождение цены, которое мы прощаем, — то же, что у ботов и у сайта. */
const PRICE_TOLERANCE = 2;

/**
 * Кандидат в геймпассы из текста сообщения.
 *
 * Ссылка выигрывает всегда. Голое число берём, только если оно в сообщении
 * ОДНО: две длинные цифры в одном сообщении — это уже догадка, а догадка здесь
 * стоит чужого пасса в заказе.
 */
export function findGamepassRefInChatText(text: string): string | null {
  const url = text.match(URL_RE);
  if (url?.[1]) return url[1];
  const bare = [...new Set([...text.matchAll(BARE_RE)].map((m) => m[1]))];
  return bare.length === 1 ? bare[0] : null;
}

export type ChatGamepassOutcome =
  | { kind: "skipped" }
  | { kind: "attached"; gamepassId: string; price: number; nick: string; wbCode: string }
  | { kind: "rejected"; gamepassId: string; reason: string };

/** Строки, которые модуль читает. Точный список полей — он же и `select`. */
interface ChatOrderRow {
  id: string;
  amount: number;
  status: string;
  platform: string;
  orderSource: string | null;
  wbCode: string;
  robloxUsername: string | null;
  gamepassUrl: string | null;
  userId: string;
  createdAt: Date;
  heldAt: Date | null;
}

interface ChatBuyerRow {
  tgId: string | null;
  vkId: string | null;
  name: string | null;
  username: string | null;
}

type Args = Record<string, unknown>;

/**
 * Клиент Prisma приходит снаружи: модуль живёт в воркере TG-бота, но своего
 * импорта базы не делает — иначе его нельзя было бы проверить тестом.
 */
export type ChatGamepassDb = {
  wbOrder: {
    findFirst: (args: Args) => Promise<ChatOrderRow | null>;
    updateMany: (args: Args) => Promise<{ count: number }>;
    count: (args: Args) => Promise<number>;
  };
  wbCode: { updateMany: (args: Args) => Promise<{ count: number }> };
  orderHold: { findUnique: (args: Args) => Promise<{ releasedAt: Date | null } | null> };
  user: { findUnique: (args: Args) => Promise<ChatBuyerRow | null> };
};

interface AttachInput {
  /** Заказ маркетплейса — только чтобы связать уведомление с его карточкой. */
  ref: DbsRef;
  /** Код гейта, выданный по этому заказу. */
  wbCode: string;
  text: string;
}

/**
 * Разобрать сообщение покупателя и, если в нём годный пасс, собрать им заказ.
 *
 * Возвращает исход для счётчиков воркера; уведомления шлёт сама.
 */
export async function tryAttachGamepassFromChat(db: ChatGamepassDb, input: AttachInput): Promise<ChatGamepassOutcome> {
  const gamepassId = findGamepassRefInChatText(input.text);
  if (!gamepassId) return { kind: "skipped" };

  const order = await db.wbOrder
    .findFirst({
      where: { wbCode: { equals: input.wbCode, mode: "insensitive" } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, amount: true, status: true, platform: true, orderSource: true,
        wbCode: true, robloxUsername: true, gamepassUrl: true, userId: true,
        createdAt: true, heldAt: true,
      },
    })
    .catch(() => null);

  // Заказа ещё нет или он уже собран — подставлять некуда. Молчим: покупатель
  // мог прислать ссылку «на всякий случай» уже после того, как оформил заказ.
  if (!order || order.status !== "AWAITING_GAMEPASS") return { kind: "skipped" };
  if (order.heldAt) return { kind: "skipped" };

  const active = await db.orderHold
    .findUnique({ where: { wbCode: order.wbCode }, select: { releasedAt: true } })
    .catch(() => null);
  if (active && !active.releasedAt) return { kind: "skipped" };

  const details = await getGamepassDetails(gamepassId).catch(() => null);
  // Число оказалось не пассом (телефон, номер заказа WB) — ни действия, ни шума.
  if (!details) return { kind: "skipped" };
  // Roblox недоступен: принимать вслепую в автоматическом пути нельзя — за
  // цену в этом случае отвечать некому.
  if (details.validationSkipped) return { kind: "skipped" };

  const expectedPrice = Math.ceil(order.amount / 0.7);
  const reject = (reason: string): ChatGamepassOutcome => {
    notifyDbsChatGamepassRejected(input.ref, { gamepassId, reason, expectedPrice });
    return { kind: "rejected", gamepassId, reason };
  };

  if (details.isNotInCatalog) return reject("пасса нет в каталоге — скорее всего игра закрыта");
  if (details.isGamePrivate) return reject("игра закрыта (private) — выкупить нельзя");
  if (details.isAgeRestricted) return reject("игра 18+ — выкупать только вручную");
  if (!details.isActive) return reject("пасс не выставлен на продажу");
  if (Math.abs(details.price - expectedPrice) > PRICE_TOLERANCE) {
    return reject(`цена ${details.price} R$ вместо ${expectedPrice} R$`);
  }

  const creator = details.creatorName?.trim();
  if (!creator) return reject("Roblox не отдал владельца пасса");

  // Робуксы уйдут ВЛАДЕЛЬЦУ пасса. Расхождение с подтверждённым ником заказа —
  // не мелочь, а другой человек на том конце: решает оператор, не автоматика.
  if (order.robloxUsername && order.robloxUsername.toLowerCase() !== creator.toLowerCase()) {
    return reject(`пасс принадлежит ${creator}, а в заказе ник ${order.robloxUsername}`);
  }

  const gamepassUrl = `https://www.roblox.com/game-pass/${gamepassId}`;
  const updated = await db.wbOrder
    .updateMany({
      // Условие по статусу — защёлка от гонки: пока мы ходили в Roblox,
      // покупатель мог оформить заказ сам в боте или на сайте.
      where: { id: order.id, status: "AWAITING_GAMEPASS" },
      data: {
        gamepassUrl,
        gamepassId,
        robloxUsername: creator,
        status: "PENDING",
        pendingAt: new Date(),
        rejectionReason: null,
      },
    })
    .catch(() => ({ count: 0 }));
  if (updated.count !== 1) return { kind: "skipped" };

  await db.wbCode
    .updateMany({
      where: { code: { equals: order.wbCode, mode: "insensitive" }, isUsed: false },
      data: { isUsed: true, usedAt: new Date(), status: "CLAIMED" },
    })
    .catch(() => {});

  void auditGamepassSubmitted(db as unknown as OrderAuditClient, {
    gamepassId,
    via: "wb-chat",
    orderId: order.id,
    wbCode: order.wbCode,
    creatorName: creator,
    price: details.price,
  });

  notifyDbsChatGamepassAttached(input.ref, {
    wbCode: order.wbCode,
    gamepassId,
    nick: creator,
    price: details.price,
    amount: order.amount,
  });

  await sendBuyoutCard(db, order, gamepassUrl, creator).catch((err: unknown) => {
    console.warn("[wb-chat-gamepass] карточка выкупа не ушла:", err instanceof Error ? err.message : err);
  });

  return { kind: "attached", gamepassId, price: details.price, nick: creator, wbCode: order.wbCode };
}

/** Обычная карточка выкупа — та же, что у заказа из бота или с сайта. */
async function sendBuyoutCard(
  db: ChatGamepassDb,
  order: ChatOrderRow,
  gamepassUrl: string,
  creatorName: string,
): Promise<void> {
  const [user, previousOrderCount] = await Promise.all([
    db.user.findUnique({
      where: { id: order.userId },
      select: { tgId: true, vkId: true, name: true, username: true },
    }).catch(() => null),
    countPreviousOrders(db as never, { userId: order.userId, excludeOrderId: order.id }),
  ]);

  const safeName = (user?.name ?? "Покупатель")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const userDisplay = user?.username
    ? `@${user.username}`
    : user?.vkId
      ? `<a href="https://vk.com/id${user.vkId}">${safeName}</a>`
      : user?.tgId
        ? `<a href="tg://user?id=${user.tgId}">${safeName}</a>`
        : safeName;

  await sendAdminOrderCard({
    id: order.id,
    amount: order.amount,
    gamepassUrl,
    platform: order.platform === "VK" ? "VK" : "TG",
    orderSource: order.orderSource,
    wbCode: order.wbCode,
    userDisplay,
    createdAt: order.createdAt,
    previousOrderCount,
    creatorName,
    viaChat: true,
  });
}
