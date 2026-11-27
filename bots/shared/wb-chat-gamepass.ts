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
 *    выставлен на продажу и стоить ровно ту цену, которую мы просим (те же
 *    ±2 R$, что и в ботах). Закрытая игра и возрастной рейтинг — не причина
 *    отказа (решение владельца 21.09.2026): выкуп ручной, нужен только Pass ID.
 * 2. **Ник берём у пасса, а не у заказа.** Робуксы Roblox переводит ВЛАДЕЛЬЦУ
 *    пасса. Если у заказа уже стоит подтверждённый ник и он не совпал с
 *    владельцем — не подставляем ничего и зовём оператора: это ровно тот
 *    случай, ради которого на сайте живёт `OWNER_MISMATCH`.
 * 3. **Молчим, когда не уверены.** Число, которое Roblox не признал пассом
 *    (телефон, номер заказа WB), не порождает ни действия, ни уведомления.
 * 4. **Заморозку уважаем.** Замороженный заказ не собирается автоматикой.
 * 5. **Нет заказа — создаём** (31.10.2026). Покупатель без Telegram и VK не
 *    может пройти сайт и шлёт пасс в чат WB. Раньше такой пасс молча терялся
 *    (PXGLH7F: оператор попросил ID, покупатель прислал, заказа так и не
 *    появилось). Теперь бот после тех же проверок создаёт заказ сам — той же
 *    функцией, что кнопка в консоли DBS, — и отвечает покупателю в чате.
 *    Чего бот НЕ делает: не создаёт заказ при отмене, открытом возврате,
 *    заморозке кода и при пассе, на который уже есть живой заказ.
 *
 * Оператор узнаёт о каждой подстановке отдельным сообщением — требование
 * владельца: «обязательно нужен увед, что в такой-то заказ поставил такой-то
 * гп айди». Карточка выкупа уходит следом обычным путём.
 */

import { getGamepassDetails } from "./roblox";
import { DONOR_NET_CAPACITY, MAX_AUTO_PARTS, expectedGamepassPrice, isAllowedPartAmount, splitIntoDonorChunks, splitRequiredMessage } from "./gamepass-plan";
import { auditGamepassSubmitted, type OrderAuditClient } from "./order-audit";
import { countPreviousOrders } from "./order-loyalty";
import { sendAdminOrderCard } from "./admin";
import { notifyDbsChatGamepassAttached, notifyDbsChatGamepassRejected } from "./wb-delivery-admin-notify";
import type { DbsRef } from "./wb-delivery-admin-notify";
import { createDbsBuyoutOrder } from "./dbs-buyout-order";
import { notifyBuyerViaWbChat } from "./wb-chat-notify";
import { wbChatSafeText } from "./wb-gate-link";
import { vkDialogLink } from "./vk-links";

/**
 * Ссылки на пасс: самый надёжный признак, ищем в любом месте строки.
 *
 * Третий шаблон — адрес Creator Hub (`…/experiences/<universeId>/passes/<passId>/…`).
 * Без него такая ссылка проваливалась в разбор голых чисел и держалась там
 * только на том, что universeId длиннее десяти цифр, — то есть на удаче.
 */
const URL_PATTERNS = [
  /game-pass(?:es)?\/(\d+)/i,
  /game_pass(?:es)?\/(\d+)/i,
  /\bpasses\/(\d+)/i,
];

/**
 * Служебная строка самого Wildberries: «Чат с покупателем по товару <nmId>».
 *
 * Она приходит в переписку с номером НАШЕГО товара — девятизначным числом,
 * неотличимым по форме от старого пасса. WB помечает её то `seller`, то
 * `client` (проверено на живых данных 07.09.2026: 175 таких строк, одна из них
 * от `client`), поэтому фильтра по отправителю недостаточно.
 */
const WB_SYSTEM_LINE_RE = /чат с покупателем по товару/i;
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
export function findGamepassRefInChatText(text: string, nmId?: number | null): string | null {
  if (WB_SYSTEM_LINE_RE.test(text)) return null;
  for (const pattern of URL_PATTERNS) {
    const m = text.match(pattern);
    if (m?.[1]) return m[1];
  }
  const bare = [...new Set([...text.matchAll(BARE_RE)].map((m) => m[1]))]
    // Номер нашего же товара на WB — не пасс. Точная проверка вдобавок к тексту
    // служебной строки: формулировку WB может поменять, номер товара — нет.
    .filter((id) => !nmId || id !== String(nmId));
  return bare.length === 1 ? bare[0] : null;
}

type ChatGamepassOutcome =
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

interface ChatMarketplaceRow {
  id: string;
  wbOrderId: string;
  cancelledAt: Date | null;
  claimOpenedAt: Date | null;
  denominationSnapshot: number | null;
  finalPriceKopecks: number | null;
  priceKopecks: number | null;
  wbCodeId: string | null;
  wbCode: { userId: string | null; status: string | null; isUsed: boolean } | null;
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
  /** Заказ маркетплейса по коду — нужен, только когда нашего заказа ещё нет. */
  wbMarketplaceOrder?: { findFirst: (args: Args) => Promise<ChatMarketplaceRow | null> };
  $transaction?: unknown;
  orderHold: { findUnique: (args: Args) => Promise<{ releasedAt: Date | null } | null> };
  user: { findUnique: (args: Args) => Promise<ChatBuyerRow | null> };
};

interface AttachInput {
  /** Заказ маркетплейса — только чтобы связать уведомление с его карточкой. */
  ref: DbsRef;
  /** Код гейта, выданный по этому заказу. */
  wbCode: string;
  text: string;
  /** Номер товара на WB: он же приходит в служебной строке чата и пассом не является. */
  nmId?: number | null;
}

/**
 * Разобрать сообщение покупателя и, если в нём годный пасс, собрать им заказ.
 *
 * Возвращает исход для счётчиков воркера; уведомления шлёт сама.
 */
export async function tryAttachGamepassFromChat(db: ChatGamepassDb, input: AttachInput): Promise<ChatGamepassOutcome> {
  const gamepassId = findGamepassRefInChatText(input.text, input.nmId);
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

  // Заказа нет — покупатель не проходил сайт (нет Telegram и VK): создаём его
  // сами после тех же проверок (31.10.2026, PXGLH7F).
  if (!order) return createOrderFromChat(db, input, gamepassId);
  // Заказ уже собран — подставлять некуда. Молчим: покупатель мог прислать
  // ссылку «на всякий случай» уже после того, как оформил заказ.
  if (order.status !== "AWAITING_GAMEPASS") return { kind: "skipped" };
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
  const verdict = checkChatPass(details, expectedPrice, order.amount);
  if (!verdict.ok) {
    notifyDbsChatGamepassRejected(input.ref, { gamepassId, reason: verdict.reason, expectedPrice });
    return { kind: "rejected", gamepassId, reason: verdict.reason };
  }
  const creator = verdict.creator;

  // Робуксы уйдут ВЛАДЕЛЬЦУ пасса. Расхождение с подтверждённым ником заказа —
  // не мелочь, а другой человек на том конце: решает оператор, не автоматика.
  if (order.robloxUsername && order.robloxUsername.toLowerCase() !== creator.toLowerCase()) {
    const reason = `пасс принадлежит ${creator}, а в заказе ник ${order.robloxUsername}`;
    notifyDbsChatGamepassRejected(input.ref, { gamepassId, reason, expectedPrice });
    return { kind: "rejected", gamepassId, reason };
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
  await confirmToBuyer(db, order.wbCode, order.amount, creator);

  return { kind: "attached", gamepassId, price: details.price, nick: creator, wbCode: order.wbCode };
}

/** Что Roblox сказал о пассе — годится ли он для заказа на этот номинал. */
type PassDetails = NonNullable<Awaited<ReturnType<typeof getGamepassDetails>>>;
type PassVerdict = { ok: true; creator: string } | { ok: false; reason: string };

/**
 * Заказ дороже донора одним пассом не закрыть (правило `NEEDS_SPLIT` из
 * `gamepass-acceptance.ts`). Чат WB и поддержка проверяли пасс сами и этого
 * правила не знали: 20.11.2026 A7NT83T (2000 R$) встал в выкуп под пасс за
 * 2858 R$, который не купит ни один аккаунт.
 */
const NEEDS_SPLIT_REASON = (amount: number) => `заказ на ${amount} R$ одним пассом не закрыть — нужна разбивка (потолок ${DONOR_NET_CAPACITY} R$)`;

function checkChatPass(details: PassDetails, expectedPrice: number, orderAmount: number): PassVerdict {
  if (orderAmount > DONOR_NET_CAPACITY) return { ok: false, reason: NEEDS_SPLIT_REASON(orderAmount) };
  // Закрытый плейс сам по себе больше не отказ: выкуп ручной, и если Roblox
  // подтверждает продажу и цену, заказ собирается (решение владельца 13.09.2026,
  // проверка первоисточника — в `getGamepassDetailsDirect`). Признаки остаются
  // причиной отказа только когда пасс и правда не продаётся.
  if (!details.isActive) {
    if (details.isNotInCatalog) return { ok: false, reason: "пасса нет в каталоге — скорее всего игра закрыта" };
    if (details.isGamePrivate) return { ok: false, reason: "игра закрыта (private) — выкупить нельзя" };
    return { ok: false, reason: "пасс не выставлен на продажу" };
  }
  if (Math.abs(details.price - expectedPrice) > PRICE_TOLERANCE) {
    return { ok: false, reason: `цена ${details.price} R$ вместо ${expectedPrice} R$` };
  }
  const creator = details.creatorName?.trim();
  if (!creator) return { ok: false, reason: "Roblox не отдал владельца пасса" };
  return { ok: true, creator };
}

/** Статусы, в которых пасс уже занят живым заказом. */
const LIVE_ORDER_STATUSES = ["AWAITING_GAMEPASS", "PENDING", "IN_PROGRESS", "ERROR"];

/**
 * Заказа по коду нет — создать его из пасса, присланного в чат WB.
 *
 * Те же проверки, что у кнопки в консоли DBS, но без «создать принудительно»:
 * всё сомнительное уходит оператору с причиной.
 */
async function createOrderFromChat(
  db: ChatGamepassDb,
  input: AttachInput,
  gamepassId: string,
): Promise<ChatGamepassOutcome> {
  if (!db.wbMarketplaceOrder || !db.$transaction) return { kind: "skipped" };
  const mp = await db.wbMarketplaceOrder.findFirst({
    where: { wbCode: { code: input.wbCode }, isTest: false },
    orderBy: { firstSeenAt: "desc" },
    select: {
      id: true, wbOrderId: true, cancelledAt: true, claimOpenedAt: true,
      denominationSnapshot: true, finalPriceKopecks: true, priceKopecks: true, wbCodeId: true,
      wbCode: { select: { userId: true, status: true, isUsed: true } },
    },
  }).catch(() => null);
  // Отменён или покупатель просит деньги назад — заказ не открываем.
  if (!mp || mp.cancelledAt || mp.claimOpenedAt || !mp.wbCodeId || !mp.denominationSnapshot) return { kind: "skipped" };
  // Код погашен или аннулирован — значит, заказ уже был или быть не должен.
  if (mp.wbCode?.isUsed || (mp.wbCode?.status && mp.wbCode.status !== "AVAILABLE")) return { kind: "skipped" };

  const denomination = mp.denominationSnapshot;
  const expectedPrice = Math.ceil(denomination / 0.7);
  const reject = (reason: string): ChatGamepassOutcome => {
    notifyDbsChatGamepassRejected(input.ref, { gamepassId, reason, expectedPrice });
    return { kind: "rejected", gamepassId, reason };
  };

  const hold = await db.orderHold
    .findUnique({ where: { wbCode: input.wbCode }, select: { releasedAt: true } })
    .catch(() => null);
  if (hold && !hold.releasedAt) return reject("код заморожен — заказ не создан, решает оператор");

  const details = await getGamepassDetails(gamepassId).catch(() => null);
  if (!details) return { kind: "skipped" };
  if (details.validationSkipped) return { kind: "skipped" };
  const verdict = checkChatPass(details, expectedPrice, denomination);
  if (!verdict.ok) return reject(verdict.reason);

  const busy = await db.wbOrder
    .count({ where: { gamepassId, status: { in: LIVE_ORDER_STATUSES } } })
    .catch(() => 0);
  if (busy > 0) return reject("на этот пасс уже есть живой заказ — заказ не создан");

  const gamepassUrl = `https://www.roblox.com/game-pass/${gamepassId}`;
  const stamp = new Date().toISOString().slice(0, 10);
  const created = await createDbsBuyoutOrder(db, {
    activationCode: input.wbCode,
    wbCodeId: mp.wbCodeId,
    wbCodeUserId: mp.wbCode?.userId ?? null,
    denomination,
    saleAmountKopecks: mp.finalPriceKopecks ?? mp.priceKopecks ?? null,
    gamepassId,
    gamepassUrl,
    nick: verdict.creator,
    adminNote: `[DBS CHAT ${stamp}] заказ WB #${mp.wbOrderId}: покупатель прислал пасс в чат WB, заказ создан автоматически`,
  }).catch((err: unknown) => {
    // Уникальность `wbCode` — защёлка от гонки двух сообщений подряд.
    console.warn("[wb-chat-gamepass] заказ из чата не создан:", err instanceof Error ? err.message : err);
    return null;
  });
  if (!created) return { kind: "skipped" };

  void auditGamepassSubmitted(db as unknown as OrderAuditClient, {
    gamepassId,
    via: "wb-chat",
    orderId: created.id,
    wbCode: input.wbCode,
    creatorName: verdict.creator,
    price: details.price,
  });
  notifyDbsChatGamepassAttached(input.ref, {
    wbCode: input.wbCode,
    gamepassId,
    nick: verdict.creator,
    price: details.price,
    amount: denomination,
    created: true,
  });
  const row: ChatOrderRow = {
    id: created.id,
    amount: created.amount,
    status: created.status,
    platform: created.platform,
    orderSource: created.orderSource,
    wbCode: created.wbCode,
    robloxUsername: verdict.creator,
    gamepassUrl,
    userId: created.userId,
    createdAt: created.createdAt,
    heldAt: null,
  };
  await sendBuyoutCard(db, row, gamepassUrl, verdict.creator).catch((err: unknown) => {
    console.warn("[wb-chat-gamepass] карточка выкупа не ушла:", err instanceof Error ? err.message : err);
  });
  await confirmToBuyer(db, input.wbCode, denomination, verdict.creator);
  return { kind: "attached", gamepassId, price: details.price, nick: verdict.creator, wbCode: input.wbCode };
}

/**
 * Ответ покупателю в чат WB: пасс принят. Без него человек, приславший пасс,
 * не знает, дошло ли (PXGLH7F написал «??» и ждал сутки). Не ушло — не беда:
 * оператор видит заказ и уведомление.
 */
async function confirmToBuyer(db: ChatGamepassDb, wbCode: string, amount: number, nick: string): Promise<void> {
  const text = wbChatSafeText(
    `Геймпасс принят, спасибо! ${amount} R$ поставлены в очередь на зачисление на аккаунт ${nick}. `
    + "Как только робуксы будут отправлены, напишем сюда же.",
  );
  await notifyBuyerViaWbChat(db as never, wbCode, text, { skipIfClaimOpen: true }).catch(() => undefined);
}

/** Обычная карточка выкупа — та же, что у заказа из бота или с сайта. */
async function sendBuyoutCard(
  db: ChatGamepassDb,
  order: ChatOrderRow,
  gamepassUrl: string,
  creatorName: string,
  via: true | "support" = true,
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
      ? vkDialogLink(user.vkId, safeName)
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
    viaChat: via,
  });
}

/* ── Пасс, присланный в поддержку @RobloxBank_PA (17.11.2026) ───────────────
   Владелец: «нужно сделать автоматическую привязку id gamepass, если её в
   саппорт кинут, чтобы вручную не привязывать». Правила те же, что для чата
   WB (проверка у Roblox, цена ±2, ник = владелец пасса, заморозка), но заказ
   выбирается из заказов САМОГО ОТПРАВИТЕЛЯ (свои + подключённые), ждущих пасс.
   Несколько таких заказов — решает цена пасса; не решает — к оператору.
   ───────────────────────────────────────────────────────────────────────── */

export type SupportPassOutcome =
  | { kind: "skipped"; why: "no_orders" | "not_a_pass" | "roblox_down" | "ambiguous" | "race" }
  | { kind: "attached"; order: ChatOrderRow; gamepassId: string; price: number; nick: string; parts?: SplitPart[] }
  /** Часть набора принята, заказ ещё не собран (27.11.2026). */
  | { kind: "partial"; order: ChatOrderRow; gamepassId: string; price: number; nick: string; parts: SplitPart[]; remaining: number; need: number[] }
  /** `toBuyer` — причину можно сказать покупателю (цена, не в продаже); иначе только оператору. */
  | {
      kind: "rejected"; order: ChatOrderRow; gamepassId: string; reason: string; expectedPrice: number; toBuyer: boolean;
      /** Готовый текст покупателю вместо стандартного «нужен пасс за N R$» (заказ требует набора). */
      buyerText?: string;
    };

export async function attachGamepassFromSupport(
  db: ChatGamepassDb & { wbOrder: ChatGamepassDb["wbOrder"] & { findMany: (args: Args) => Promise<ChatOrderRow[]> } },
  input: { orderIds: string[]; gamepassId: string },
): Promise<SupportPassOutcome> {
  if (!input.orderIds.length) return { kind: "skipped", why: "no_orders" };
  const rows = await db.wbOrder.findMany({
    where: { id: { in: input.orderIds }, status: "AWAITING_GAMEPASS", heldAt: null, isTest: false },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, amount: true, status: true, platform: true, orderSource: true,
      wbCode: true, robloxUsername: true, gamepassUrl: true, userId: true,
      createdAt: true, heldAt: true,
    },
  }).catch(() => [] as ChatOrderRow[]);
  const open: ChatOrderRow[] = [];
  for (const o of rows) {
    const hold = await db.orderHold.findUnique({ where: { wbCode: o.wbCode }, select: { releasedAt: true } }).catch(() => null);
    if (!hold || hold.releasedAt) open.push(o);
  }
  if (!open.length) return { kind: "skipped", why: "no_orders" };

  const details = await getGamepassDetails(input.gamepassId).catch(() => null);
  if (!details) return { kind: "skipped", why: "not_a_pass" };
  if (details.validationSkipped) return { kind: "skipped", why: "roblox_down" };

  // Какой заказ: тот, чьей цене пасс соответствует. Один заказ — он и есть.
  // Иначе — единственный заказ под набор, к которому пасс годится частью.
  const fits = open.filter((o) => Math.abs(details.price - Math.ceil(o.amount / 0.7)) <= PRICE_TOLERANCE);
  if (fits.length > 1) return { kind: "skipped", why: "ambiguous" };
  const splitFits = open.filter((o) => o.amount > DONOR_NET_CAPACITY && partAmountForPrice(details.price, o.amount) !== null);
  const order = fits[0] ?? (open.length === 1 ? open[0] : splitFits.length === 1 ? splitFits[0] : null);
  if (!order) {
    const prices = open.map((o) => Math.ceil(o.amount / 0.7));
    return {
      kind: "rejected", order: open[0], gamepassId: input.gamepassId, toBuyer: true,
      reason: `цена ${details.price} R$ не подходит ни к одному заказу (нужно ${prices.join(" или ")} R$)`,
      expectedPrice: prices[0],
    };
  }

  const expectedPrice = Math.ceil(order.amount / 0.7);
  // Заказ больше донора: одиночный пасс не годится при любой цене. Покупателю —
  // какой набор прислать, оператору — что пасс не подставлен.
  if (order.amount > DONOR_NET_CAPACITY) {
    return collectSplitPart(db, order, input.gamepassId, details);
  }
  const verdict = checkChatPass(details, expectedPrice, order.amount);
  if (!verdict.ok) {
    return { kind: "rejected", order, gamepassId: input.gamepassId, reason: verdict.reason, expectedPrice, toBuyer: verdict.reason !== "Roblox не отдал владельца пасса" };
  }
  const creator = verdict.creator;
  if (order.robloxUsername && order.robloxUsername.toLowerCase() !== creator.toLowerCase()) {
    return {
      kind: "rejected", order, gamepassId: input.gamepassId, expectedPrice, toBuyer: false,
      reason: `пасс принадлежит ${creator}, а в заказе ник ${order.robloxUsername}`,
    };
  }
  const busy = await db.wbOrder.count({ where: { gamepassId: input.gamepassId, status: { in: LIVE_ORDER_STATUSES }, id: { not: order.id } } }).catch(() => 0);
  if (busy > 0) {
    return { kind: "rejected", order, gamepassId: input.gamepassId, expectedPrice, toBuyer: false, reason: "этот пасс уже стоит в другом живом заказе" };
  }

  const gamepassUrl = `https://www.roblox.com/game-pass/${input.gamepassId}`;
  const updated = await db.wbOrder.updateMany({
    where: { id: order.id, status: "AWAITING_GAMEPASS" },
    data: { gamepassUrl, gamepassId: input.gamepassId, robloxUsername: creator, status: "PENDING", pendingAt: new Date(), rejectionReason: null },
  }).catch(() => ({ count: 0 }));
  if (updated.count !== 1) return { kind: "skipped", why: "race" };

  await db.wbCode.updateMany({
    where: { code: { equals: order.wbCode, mode: "insensitive" }, isUsed: false },
    data: { isUsed: true, usedAt: new Date(), status: "CLAIMED" },
  }).catch(() => {});
  void auditGamepassSubmitted(db as unknown as OrderAuditClient, {
    gamepassId: input.gamepassId, via: "pa-support", orderId: order.id, wbCode: order.wbCode,
    creatorName: creator, price: details.price,
  });
  await sendBuyoutCard(db, order, gamepassUrl, creator, "support").catch((err: unknown) => {
    console.warn("[pa-gamepass] карточка выкупа не ушла:", err instanceof Error ? err.message : err);
  });
  return { kind: "attached", order: { ...order, robloxUsername: creator, gamepassUrl }, gamepassId: input.gamepassId, price: details.price, nick: creator };
}


/* ── Набор из нескольких пассов, присланных по одному (27.11.2026) ──────────
   Владелец: «надо обучить воркера принимать несколько, считать их сумму,
   ориентироваться в них». Заказ больше потолка донора (1500) закрывается
   набором. Покупатель шлёт пассы по одному — каждый проверяем, номинал части
   выводим из цены, копим в `WbSyncCursor(split-collect:<orderId>)`; сумма
   сошлась — заказ уходит в выкуп со строками `WbOrderGamepass`.
   ───────────────────────────────────────────────────────────────────────── */

export type SplitPart = { gamepassId: string; amount: number; price: number; creator: string };

/** Номинал части по цене пасса (±2 R$) или null, если такая часть заказу не годится. */
export function partAmountForPrice(price: number, orderAmount: number): number | null {
  for (let a = Math.min(orderAmount, DONOR_NET_CAPACITY); a > 0; a--) {
    if (Math.abs(expectedGamepassPrice(a) - price) <= PRICE_TOLERANCE && isAllowedPartAmount(a, orderAmount)) return a;
  }
  return null;
}

/** Чего не хватает: остаток и пассы (в робуксах на руки), которыми его закрыть. */
export function splitRemaining(orderAmount: number, parts: SplitPart[]): { remaining: number; need: number[] } {
  const remaining = orderAmount - parts.reduce((s, p) => s + p.amount, 0);
  return { remaining, need: remaining > 0 ? splitIntoDonorChunks(remaining) : [] };
}

/** Текст покупателю: что принято, сколько осталось, какой пасс прислать. */
export function splitProgressText(orderAmount: number, parts: SplitPart[]): string {
  const { remaining, need } = splitRemaining(orderAmount, parts);
  const got = parts.map((p) => `${p.amount}`).join(" + ");
  const head = `Геймпасс принят ✅ Собрано ${got} = ${orderAmount - remaining} из ${orderAmount} R$.`;
  if (remaining <= 0) return head;
  const prices = need.map((n) => `${expectedGamepassPrice(n)} R$`).join(" + ");
  return `${head}\nОсталось ${remaining} R$ — пришлите ${need.length > 1 ? "геймпассы" : "геймпасс"} за ${prices} (ссылку или ID).`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function collectSplitPart(db: any, order: ChatOrderRow, gamepassId: string, details: PassDetails): Promise<SupportPassOutcome> {
  const stream = `split-collect:${order.id}`;
  const row = await db.wbSyncCursor.findUnique({ where: { stream } }).catch(() => null);
  const parts: SplitPart[] = (row?.metadata as { parts?: SplitPart[] } | null)?.parts ?? [];
  const { remaining, need } = splitRemaining(order.amount, parts);
  const needPrices = need.map(expectedGamepassPrice);
  const reject = (reason: string, toBuyer = true, buyerText?: string): SupportPassOutcome =>
    ({ kind: "rejected", order, gamepassId, reason, expectedPrice: needPrices[0] ?? 0, toBuyer, ...(buyerText ? { buyerText } : {}) });

  if (parts.some((p) => p.gamepassId === gamepassId)) {
    return reject("этот пасс уже принят в набор", true, splitProgressText(order.amount, parts).replace("Геймпасс принят ✅", "Этот геймпасс уже приняли."));
  }
  if (parts.length >= MAX_AUTO_PARTS) return reject(`в наборе уже ${parts.length} пасса — дальше вручную`, false);
  if (!details.isActive) return reject(details.isGamePrivate ? "игра закрыта (private) — выкупить нельзя" : "пасс не выставлен на продажу");
  const creator = details.creatorName?.trim();
  if (!creator) return reject("Roblox не отдал владельца пасса", false);
  const amount = partAmountForPrice(details.price, order.amount);
  if (amount === null || amount > remaining || (remaining - amount > 0 && remaining - amount < 500 && remaining - amount !== 0)) {
    return reject(`цена ${details.price} R$ не подходит к набору (осталось ${remaining} R$)`, true,
      parts.length
        ? `Проверили геймпасс: цена ${details.price} R$ не подходит. ${splitProgressText(order.amount, parts).replace(/^Геймпасс принят ✅ /, "")}`
        : `Проверили геймпасс: цена ${details.price} R$ не подходит. ${splitRequiredMessage(order.amount)}\n\nПришлите ссылки или ID этих геймпассов — можно по одному, сумму посчитаем сами.`);
  }
  const owner = order.robloxUsername ?? parts[0]?.creator ?? null;
  if (owner && owner.toLowerCase() !== creator.toLowerCase()) {
    return reject(`пасс принадлежит ${creator}, а в заказе ник ${owner}`, false);
  }
  const busy = await db.wbOrder.count({ where: { gamepassId, status: { in: LIVE_ORDER_STATUSES }, id: { not: order.id } } }).catch(() => 0);
  if (busy > 0) return reject("этот пасс уже стоит в другом живом заказе", false);

  const next = [...parts, { gamepassId, amount, price: details.price, creator }];
  const left = splitRemaining(order.amount, next);
  if (left.remaining > 0) {
    await db.wbSyncCursor.upsert({ where: { stream }, create: { stream, metadata: { parts: next } }, update: { metadata: { parts: next } } });
    return { kind: "partial", order, gamepassId, price: details.price, nick: creator, parts: next, ...left };
  }

  // Набор собран: заказ в выкуп, части — строками WbOrderGamepass (как ручной набор в консоли).
  const first = next[0];
  const gamepassUrl = `https://www.roblox.com/game-pass/${first.gamepassId}`;
  const done = await db.$transaction(async (tx: any) => {
    const u = await tx.wbOrder.updateMany({
      where: { id: order.id, status: "AWAITING_GAMEPASS" },
      data: { gamepassUrl, gamepassId: first.gamepassId, robloxUsername: creator, status: "PENDING", pendingAt: new Date(), rejectionReason: null },
    });
    if (u.count !== 1) return false;
    await tx.wbOrderGamepass.deleteMany({ where: { orderId: order.id } });
    await tx.wbOrderGamepass.createMany({
      data: next.map((p, position) => ({ orderId: order.id, gamepassId: p.gamepassId, gamepassUrl: `https://www.roblox.com/game-pass/${p.gamepassId}`, amount: p.amount, position })),
    });
    await tx.wbSyncCursor.deleteMany({ where: { stream } });
    return true;
  }).catch((e: unknown) => { console.warn("[split-collect]", e instanceof Error ? e.message : e); return false; });
  if (!done) return { kind: "skipped", why: "race" };
  await db.wbCode.updateMany({
    where: { code: { equals: order.wbCode, mode: "insensitive" }, isUsed: false },
    data: { isUsed: true, usedAt: new Date(), status: "CLAIMED" },
  }).catch(() => {});
  for (const p of next) {
    void auditGamepassSubmitted(db as OrderAuditClient, { gamepassId: p.gamepassId, via: "pa-support", orderId: order.id, wbCode: order.wbCode, creatorName: creator, price: p.price });
  }
  await sendBuyoutCard(db, order, gamepassUrl, creator, "support").catch((err: unknown) => {
    console.warn("[pa-gamepass] карточка выкупа не ушла:", err instanceof Error ? err.message : err);
  });
  return { kind: "attached", order: { ...order, robloxUsername: creator, gamepassUrl }, gamepassId, price: details.price, nick: creator, parts: next };
}
