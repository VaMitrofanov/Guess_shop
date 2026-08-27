/**
 * Аудит заказа: что покупатель на самом деле прислал и когда.
 *
 * Разбор спора 28.08.2026 по заказу `CEALJKV`. Покупательница утверждала, что
 * не указывала ник, на который ушли робуксы. Доказать удалось — но косвенно:
 * по `adminNote`, по владельцу выкупленного геймпасса и по времени полей
 * заказа. `OrderEvent` по заказу был пуст, то есть прямой записи «ввела такой-то
 * ник в такое-то время» не существовало вообще.
 *
 * Здесь она появляется. Записи неизменяемы, живут 18 месяцев (`RETENTION`) и
 * отвечают ровно на два вопроса спора: какие ники человек вводил и какие
 * геймпассы присылал.
 *
 * Два правила, без которых запись бесполезна:
 *
 * 1. **Пишем ДО дедупликации заметки.** `noteProbableNick` намеренно молчит,
 *    когда ник совпадает с подтверждённым или уже есть в заметке. В споре
 *    именно этот случай и оказался главным: ник совпал с подтверждённым, и
 *    отдельной записи о вводе не осталось.
 * 2. **Никогда не роняет пользовательский поток.** Аудит — побочный эффект;
 *    заказ важнее записи о нём.
 */

/** Минимум от Prisma-клиента, который нужен аудиту (db в ботах, prisma в Web). */
export type OrderAuditClient = {
  wbOrder: { findFirst: (args: unknown) => Promise<{ id: string } | null> };
  orderEvent: { create: (args: unknown) => Promise<unknown> };
};

export const ORDER_AUDIT_TYPE = {
  /** Покупатель ввёл ник Roblox в поиск (бот или сайт). */
  NICK_ENTERED: "AUDIT_NICK_ENTERED",
  /** Покупатель прислал/выбрал геймпасс; владелец — по данным Roblox. */
  GAMEPASS_SUBMITTED: "AUDIT_GAMEPASS_SUBMITTED",
} as const;

export type OrderAuditType = typeof ORDER_AUDIT_TYPE[keyof typeof ORDER_AUDIT_TYPE];

/**
 * Ключ идемпотентности: одна строка на «заказ + тип + предмет».
 *
 * `subject` — это ник или ID геймпасса. Повтор одного и того же действия
 * ничего не добавляет к доказательству, а вот ДРУГОЙ ник или другой пасс —
 * добавляет, и получает свою строку. `OrderEvent.idempotencyKey` уникален
 * глобально, поэтому в ключ входит и orderId.
 */
export function orderAuditKey(type: OrderAuditType, orderId: string, subject: string): string {
  return `audit:${type}:${orderId}:${subject.trim().toLowerCase()}`;
}

const NICK_RE = /^[A-Za-z0-9_]{3,20}$/;
const GP_RE = /^\d{3,20}$/;

/** Синтетические коды прямых и авито-заказов заказу коридора не соответствуют. */
function isCorridorCode(code: string): boolean {
  return /^[A-Za-z0-9]{7}$/.test(code) && !code.startsWith("DIR-") && !code.startsWith("AV-");
}

async function resolveOrderId(
  client: OrderAuditClient,
  ref: { orderId?: string; wbCode?: string },
): Promise<string | null> {
  if (ref.orderId) return ref.orderId;
  const code = ref.wbCode?.trim();
  if (!code || !isCorridorCode(code)) return null;
  // Заказ ищем по коду БЕЗ фильтра по статусу: спор чаще всего разбирают уже
  // по выполненному заказу, и запись о вводе ника нужна именно там.
  const order = await client.wbOrder.findFirst({
    where: { wbCode: { equals: code, mode: "insensitive" } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return order?.id ?? null;
}

async function write(
  client: OrderAuditClient,
  type: OrderAuditType,
  orderId: string,
  subject: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await client.orderEvent.create({
      data: {
        orderId,
        type,
        idempotencyKey: orderAuditKey(type, orderId, subject),
        payload: { ...payload, at: new Date().toISOString() },
      },
    });
  } catch (err: unknown) {
    // Уникальный ключ — это «уже записано», штатный исход повторного действия.
    const code = (err as { code?: string } | null)?.code;
    if (code === "P2002") return;
    console.warn(`[order-audit] ${type} не записан:`, err instanceof Error ? err.message : err);
  }
}

/** Покупатель ввёл ник в поиск. Пишется и тогда, когда ник совпал с известным. */
export async function auditNickEntered(
  client: OrderAuditClient,
  opts: {
    nick: string;
    /** Канал ввода: `tg-bot` / `vk-bot` / `site`. */
    via: string;
    orderId?: string;
    wbCode?: string;
    /** Подтвердил ли Roblox существование аккаунта. */
    robloxKnows?: boolean;
    /** Сколько пассов на продажу нашлось у этого ника в тот момент. */
    passesFound?: number;
  },
): Promise<void> {
  const nick = opts.nick.trim().replace(/^@/, "");
  if (!NICK_RE.test(nick)) return;
  try {
    const orderId = await resolveOrderId(client, opts);
    if (!orderId) return;
    await write(client, ORDER_AUDIT_TYPE.NICK_ENTERED, orderId, nick, {
      nick,
      via: opts.via,
      ...(opts.robloxKnows === undefined ? {} : { robloxKnows: opts.robloxKnows }),
      ...(opts.passesFound === undefined ? {} : { passesFound: opts.passesFound }),
    });
  } catch (err) {
    console.warn("[order-audit] auditNickEntered:", err instanceof Error ? err.message : err);
  }
}

/**
 * Покупатель прислал или выбрал геймпасс.
 *
 * `creatorName` — ответ Roblox о владельце пасса, а не то, что человек набрал.
 * Это и есть решающая часть доказательства: робуксы за геймпасс уходят его
 * создателю, и адрес назначения выбирается присланным пассом, а не словами.
 */
export async function auditGamepassSubmitted(
  client: OrderAuditClient,
  opts: {
    gamepassId: string;
    /** Как попал: `link` (прислал ссылку), `pick` (выбрал из поиска), `site-one-tap`. */
    via: string;
    orderId?: string;
    wbCode?: string;
    /** Владелец по данным Roblox. */
    creatorName?: string | null;
    /** Цена пасса по данным Roblox на момент отправки. */
    price?: number | null;
  },
): Promise<void> {
  const gamepassId = String(opts.gamepassId ?? "").trim();
  if (!GP_RE.test(gamepassId)) return;
  try {
    const orderId = await resolveOrderId(client, opts);
    if (!orderId) return;
    await write(client, ORDER_AUDIT_TYPE.GAMEPASS_SUBMITTED, orderId, gamepassId, {
      gamepassId,
      via: opts.via,
      ...(opts.creatorName ? { creatorName: opts.creatorName } : {}),
      ...(Number.isFinite(opts.price) ? { price: Number(opts.price) } : {}),
    });
  } catch (err) {
    console.warn("[order-audit] auditGamepassSubmitted:", err instanceof Error ? err.message : err);
  }
}
