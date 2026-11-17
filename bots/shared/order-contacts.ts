/* ─────────────────────────────────────────────────────────────────────────────
   Контакты заказа: несколько аккаунтов на один заказ (17.11.2026).

   Владелец: «пользователи безымянные часто пишут в саппорт с тех акков, на
   которые не оформлен заказ… бот должен уметь связывать и по коду заказа, и по
   нику, в общем по любой инфе, которую прислал клиент».

   Как было: у заказа один `userId`. Человек пишет @RobloxBank_PA со второго
   Telegram, ИИ видит «заказов в базе нет», и менеджер просит ссылку руками. В
   боте второй аккаунт на той же площадке — тупик «код уже активирован» (Б1
   склеивает только TG + VK одного человека, `cross-platform-claim.ts`).

   Как стало: из сообщения достаём всё, по чему узнаётся заказ (`extractOrderClues`),
   находим заказ (`findOrdersByClues`), решаем, что делать (`planContactOffer`),
   и, если человек подтвердил, подключаем его аккаунт к заказу (`addOrderContact`).
   Подключённый видит статус и получает короткие копии уведомлений
   (`notifyOrderWatchers`), владелец узнаёт об этом и может убрать его кнопкой.

   Сила улик разная, и от неё зависит, что мы показываем ДО подтверждения:
     • код ВБ — это ключ от заказа: кто его знает, и так может дойти до пасса;
     • ссылка/ID пасса — почти ключ (пасс видит только тот, кто его делал);
     • ник Roblox — публичный: по нему код заказа НЕ показываем никогда, ни
       в вопросе, ни в копиях уведомлений.
   Всё, что меняет, КУДА уйдут робуксы (ник, пасс у поданного заказа), остаётся
   за владельцем и админом — подключённый только смотрит.

   Модуль не знает ни Telegraf, ни VK: отправку передают снаружи (`ContactSend`),
   поэтому его используют и боты, и сайт (`src/lib/twa-notify.ts`).
   ───────────────────────────────────────────────────────────────────────── */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

/** Сколько аккаунтов можно подключить к одному заказу без админа. */
export const CONTACT_LIMIT = 5;
/** Выкупленный раньше этого заказ подключать незачем: уведомлений больше не будет. */
const COMPLETED_FRESH_MS = 30 * 24 * 3600_000;
/** По нику ищем только свежие заказы: старый ник мог перейти к другому человеку. */
const NICK_WINDOW_MS = 60 * 24 * 3600_000;
/** Больше трёх заказов в одном вопросе — уже не вопрос, а список. */
const MAX_OFFER = 3;

export const CONTACT_EVENT = {
  ADDED: "CONTACT_ADDED",
  REMOVED: "CONTACT_REMOVED",
  DECLINED: "CONTACT_DECLINED",
} as const;

export type ContactVia = "support_code" | "support_nick" | "support_pass" | "bot_code" | "admin";
type ClueKind = "code" | "pass" | "nick";

/** По какой улике подключён — от этого зависит, можно ли называть ему код. */
export function clueOfVia(via: string): ClueKind {
  return via === "support_nick" ? "nick" : via === "support_pass" ? "pass" : "code";
}

/** Подключённые так знают код заказа сами — его можно называть в ответах. */
export const CODE_VIAS = ["support_code", "bot_code", "admin"];

/** Via для поддержки по самой сильной улике. */
export function supportVia(clue: ClueKind): ContactVia {
  return clue === "nick" ? "support_nick" : clue === "pass" ? "support_pass" : "support_code";
}

/* ── 1. Что прислал человек ─────────────────────────────────────────────── */

export interface OrderClues {
  codes: string[];
  passIds: string[];
  nicks: string[];
}

const CODE_IN_LINK = /(?:\/wb\/|[?&]code=)([A-Za-z0-9]{7})(?![A-Za-z0-9])/g;
const PASS_IN_LINK = /game-pass(?:es)?\/(\d{5,15})/gi;
/** Код ВБ: 7 латинских букв и цифр, обязательно есть и то и другое. */
const CODE_TOKEN = /^(?=[A-Za-z0-9]*\d)(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{7}$/;
/** Ник Roblox: 3–20 символов, латиница/цифры/подчёркивание, `_` не по краям. */
const NICK_TOKEN = /^(?!_)[A-Za-z0-9_]{3,20}(?<!_)$/;
/** «ник: X», «мой ник X», «ник в роблокс — X». */
const NICK_LABELED = /ник[а-яё ]{0,20}[:\-—–\s]\s*@?([A-Za-z0-9_]{3,20})/i;
/** Голое число 8–15 цифр — ID пасса. Шесть цифр — код получения WB, его не трогаем. */
const PASS_TOKEN = /^\d{8,15}$/;

/** Слова, похожие на ник, но им не являющиеся (то, что люди пишут одним словом). */
const NOT_A_NICK = new Set([
  "hello", "hi", "privet", "ok", "okay", "thanks", "help", "roblox", "robux", "robloxbank",
  "pending", "gamepass", "admin", "support", "test", "start", "menu", "order", "stop",
]);

/** Всё, по чему может узнаться заказ. Ничего не ищет в базе. */
export function extractOrderClues(raw: string): OrderClues {
  const text = (raw ?? "").normalize("NFKC").trim();
  const codes = new Set<string>();
  const passIds = new Set<string>();
  const nicks = new Set<string>();
  if (!text) return { codes: [], passIds: [], nicks: [] };

  for (const m of text.matchAll(CODE_IN_LINK)) codes.add(m[1].toUpperCase());
  for (const m of text.matchAll(PASS_IN_LINK)) passIds.add(m[1]);

  // Ссылки целиком из текста убираем, чтобы их куски не читались как ник.
  const bare = text.replace(/https?:\/\/\S+/gi, " ").replace(/\b\S+\.(?:ru|com|me)\/\S*/gi, " ");
  const tokens = bare.split(/[\s,;.!?()«»"'`]+/).filter(Boolean);
  for (const t of tokens) {
    if (CODE_TOKEN.test(t) && !/^\d+$/.test(t)) codes.add(t.toUpperCase());
    else if (PASS_TOKEN.test(t)) passIds.add(t);
  }

  const labeled = bare.match(NICK_LABELED);
  if (labeled) nicks.add(labeled[1]);
  // Сообщение из одного слова латиницей — почти всегда ник («krasotka_123106»).
  const words = tokens.filter((t) => !/^\d+$/.test(t));
  if (words.length === 1 && tokens.length <= 2) {
    const w = words[0].replace(/^@/, "");
    if (NICK_TOKEN.test(w) && !codes.has(w.toUpperCase()) && !NOT_A_NICK.has(w.toLowerCase())) nicks.add(w);
  }
  return { codes: [...codes], passIds: [...passIds], nicks: [...nicks] };
}

export function hasClues(c: OrderClues): boolean {
  return c.codes.length + c.passIds.length + c.nicks.length > 0;
}

/* ── 2. Какой это заказ ─────────────────────────────────────────────────── */

const ORDER_SELECT = {
  id: true, wbCode: true, amount: true, status: true, createdAt: true, completedAt: true,
  heldAt: true, robloxUsername: true, probableNick: true, userId: true, isTest: true,
  user: { select: { id: true, tgId: true, vkId: true, name: true, username: true } },
} as const;

export interface FoundOrder {
  id: string;
  wbCode: string;
  amount: number;
  status: string;
  createdAt: Date;
  completedAt: Date | null;
  heldAt: Date | null;
  robloxUsername: string | null;
  probableNick: string | null;
  userId: string;
  user: { id: string; tgId: string | null; vkId: string | null; name: string | null; username: string | null } | null;
  /** По какой улике нашёлся — от неё зависит, что можно показать. */
  clue: ClueKind;
  evidence: string;
}

/** Заказы по уликам; сильная улика вытесняет слабую. Тестовые и прямые (DIR-) не ищем. */
export async function findOrdersByClues(db: Db, clues: OrderClues): Promise<FoundOrder[]> {
  const found = new Map<string, FoundOrder>();
  const take = (rows: Array<Omit<FoundOrder, "clue" | "evidence"> & { isTest?: boolean; gamepassId?: string | null }>, clue: ClueKind, evidenceOf: (o: Omit<FoundOrder, "clue" | "evidence"> & { gamepassId?: string | null }) => string) => {
    for (const o of rows ?? []) {
      if (o.isTest || found.has(o.id)) continue;
      found.set(o.id, { ...o, clue, evidence: evidenceOf(o) });
    }
  };

  if (clues.codes.length) {
    const rows = await db.wbOrder.findMany({ where: { wbCode: { in: clues.codes } }, select: ORDER_SELECT }).catch(() => []);
    take(rows, "code", (o) => o.wbCode);
  }
  if (clues.passIds.length) {
    const rows = await db.wbOrder.findMany({
      where: {
        OR: [
          { gamepassId: { in: clues.passIds } },
          { splitGamepasses: { some: { gamepassId: { in: clues.passIds } } } },
        ],
      },
      orderBy: { createdAt: "desc" }, take: 5, select: { ...ORDER_SELECT, gamepassId: true },
    }).catch(() => []);
    take(rows, "pass", (o) => o.gamepassId ?? clues.passIds[0]);
  }
  if (clues.nicks.length && found.size === 0) {
    const since = new Date(Date.now() - NICK_WINDOW_MS);
    const rows = await db.wbOrder.findMany({
      where: {
        createdAt: { gte: since },
        OR: clues.nicks.flatMap((n) => [
          { robloxUsername: { equals: n, mode: "insensitive" } },
          { probableNick: { equals: n, mode: "insensitive" } },
        ]),
      },
      orderBy: { createdAt: "desc" }, take: 6, select: ORDER_SELECT,
    }).catch(() => []);
    take(rows, "nick", (o) => o.robloxUsername ?? o.probableNick ?? clues.nicks[0]);
  }
  return [...found.values()].filter((o) => !String(o.wbCode).startsWith("DIR-"));
}

/* ── 3. Что с этим делать ───────────────────────────────────────────────── */

export type ContactPlan =
  /** Ничего не нашли — пусть отвечает ИИ / человек как обычно. */
  | { kind: "none" }
  /** Пишет сам владелец или уже подключённый — ничего не спрашиваем. */
  | { kind: "known"; orders: FoundOrder[] }
  /** Нашли, но подключать нельзя без человека. */
  | { kind: "blocked"; orders: FoundOrder[]; reason: "held" | "revoked" | "limit" | "ambiguous" }
  /** Нашли только давно выкупленные — подключать незачем. */
  | { kind: "old"; orders: FoundOrder[] }
  /** Спросить «добавить этот аккаунт к заказу?». */
  | { kind: "offer"; orders: FoundOrder[] };

function isFresh(o: FoundOrder, now = Date.now()): boolean {
  if (o.status !== "COMPLETED") return o.status !== "REJECTED" || now - new Date(o.createdAt).getTime() < COMPLETED_FRESH_MS;
  const at = o.completedAt ?? o.createdAt;
  return now - new Date(at).getTime() < COMPLETED_FRESH_MS;
}

/**
 * Решение по найденным заказам для конкретного отправителя. Ничего не меняет.
 * `senderUserId` — профиль отправителя, если он уже есть в базе.
 */
export async function planContactOffer(db: Db, input: { senderUserId: string | null; orders: FoundOrder[] }): Promise<ContactPlan> {
  const { senderUserId } = input;
  if (!input.orders.length) return { kind: "none" };

  let watched = new Set<string>();
  if (senderUserId) {
    const rows = await db.orderContact.findMany({
      where: { userId: senderUserId, orderId: { in: input.orders.map((o) => o.id) }, removedAt: null },
      select: { orderId: true },
    }).catch(() => []);
    watched = new Set(rows.map((r: { orderId: string }) => r.orderId));
  }
  const foreign = input.orders.filter((o) => o.userId !== senderUserId && !watched.has(o.id));
  if (!foreign.length) return { kind: "known", orders: input.orders };

  // Ник публичный: если под ним заказы РАЗНЫХ владельцев, угадывать нельзя.
  if (foreign.every((o) => o.clue === "nick") && new Set(foreign.map((o) => o.userId)).size > 1) {
    return { kind: "blocked", orders: foreign, reason: "ambiguous" };
  }

  const fresh = foreign.filter((o) => isFresh(o));
  if (!fresh.length) return { kind: "old", orders: foreign };

  if (fresh.some((o) => o.heldAt)) return { kind: "blocked", orders: fresh, reason: "held" };
  const codes = fresh.map((o) => o.wbCode);
  const revoked = await db.wbCode.count({ where: { code: { in: codes }, status: "REVOKED" } }).catch(() => 0);
  if (revoked > 0) return { kind: "blocked", orders: fresh, reason: "revoked" };

  const counts = await db.orderContact.groupBy({
    by: ["orderId"], where: { orderId: { in: fresh.map((o) => o.id) }, removedAt: null }, _count: { _all: true },
  }).catch(() => []);
  const full = new Set((counts as Array<{ orderId: string; _count: { _all: number } }>).filter((c) => c._count._all >= CONTACT_LIMIT).map((c) => c.orderId));
  const open = fresh.filter((o) => !full.has(o.id));
  if (!open.length) return { kind: "blocked", orders: fresh, reason: "limit" };

  return { kind: "offer", orders: open.slice(0, MAX_OFFER) };
}

/* ── 4. Подключить / убрать ─────────────────────────────────────────────── */

export type AddResult =
  | { ok: true; contactId: string; created: boolean; order: FoundOrder }
  | { ok: false; reason: "no_order" | "own" | "held" | "revoked" | "limit" };

/** Подключить аккаунт к заказу. Повторное нажатие — не ошибка (вернёт тот же контакт). */
export async function addOrderContact(db: Db, input: {
  orderId: string;
  userId: string;
  via: ContactVia;
  evidence?: string | null;
  platform: "TG" | "VK";
  label: string;
}): Promise<AddResult> {
  const order = await db.wbOrder.findUnique({ where: { id: input.orderId }, select: ORDER_SELECT });
  if (!order || order.isTest) return { ok: false, reason: "no_order" };
  if (order.userId === input.userId) return { ok: false, reason: "own" };
  if (order.heldAt) return { ok: false, reason: "held" };
  const revoked = await db.wbCode.count({ where: { code: order.wbCode, status: "REVOKED" } }).catch(() => 0);
  if (revoked) return { ok: false, reason: "revoked" };

  const existing = await db.orderContact.findUnique({ where: { orderId_userId: { orderId: order.id, userId: input.userId } } });
  const clue = clueOfVia(input.via);
  if (existing && !existing.removedAt) {
    return { ok: true, contactId: existing.id, created: false, order: { ...order, clue, evidence: existing.evidence ?? "" } };
  }
  const active = await db.orderContact.count({ where: { orderId: order.id, removedAt: null } });
  if (active >= CONTACT_LIMIT) return { ok: false, reason: "limit" };

  const evidence = input.evidence ? String(input.evidence).slice(0, 64) : null;
  const row = existing
    ? await db.orderContact.update({
        where: { id: existing.id },
        data: { via: input.via, evidence, removedAt: null, removedBy: null, createdAt: new Date() },
      })
    : await db.orderContact.create({ data: { orderId: order.id, userId: input.userId, via: input.via, evidence } });

  await recordContactEvent(db, order.id, CONTACT_EVENT.ADDED, `${row.id}:${Date.now()}`, {
    via: input.via, platform: input.platform, who: input.label.slice(0, 80),
  });
  return { ok: true, contactId: row.id, created: true, order: { ...order, clue, evidence: evidence ?? "" } };
}

export type RemoveResult =
  | { ok: true; orderId: string; contactUserId: string; wbCode: string; amount: number; nick: string | null }
  | { ok: false; reason: "not_found" | "forbidden" | "already" };

/**
 * Убрать контакт. Право: владелец заказа, сам подключённый или админ
 * (`by` начинается с `admin:` — права админа проверяет вызывающий).
 */
export async function removeOrderContact(db: Db, input: { contactId: string; pressedByUserId: string | null; by: "owner" | "self" | `admin:${string}` }): Promise<RemoveResult> {
  const row = await db.orderContact.findUnique({
    where: { id: input.contactId },
    select: { id: true, userId: true, removedAt: true, order: { select: { id: true, userId: true, wbCode: true, amount: true, robloxUsername: true } } },
  });
  if (!row) return { ok: false, reason: "not_found" };
  if (row.removedAt) return { ok: false, reason: "already" };
  const isAdmin = input.by.startsWith("admin:");
  const allowed = isAdmin
    || (input.by === "owner" && input.pressedByUserId === row.order.userId)
    || (input.by === "self" && input.pressedByUserId === row.userId);
  if (!allowed) return { ok: false, reason: "forbidden" };
  await db.orderContact.update({ where: { id: row.id }, data: { removedAt: new Date(), removedBy: input.by } });
  await recordContactEvent(db, row.order.id, CONTACT_EVENT.REMOVED, `${row.id}:rm:${Date.now()}`, { by: input.by });
  return { ok: true, orderId: row.order.id, contactUserId: row.userId, wbCode: row.order.wbCode, amount: row.order.amount, nick: row.order.robloxUsername };
}

/** Человек сказал «это не мой заказ» — след в ленте, без шума. */
export async function recordContactDeclined(db: Db, orderId: string, input: { platform: "TG" | "VK"; label: string; clue?: string }): Promise<void> {
  const bucket = Math.floor(Date.now() / 3600_000);
  await recordContactEvent(db, orderId, CONTACT_EVENT.DECLINED, `${orderId}:${input.label}:${bucket}`, {
    platform: input.platform, who: input.label.slice(0, 80), via: input.clue ?? null,
  });
}

async function recordContactEvent(db: Db, orderId: string, type: string, key: string, payload: Record<string, unknown>): Promise<void> {
  try {
    await db.orderEvent.create({
      data: { orderId, type, idempotencyKey: `contact:${key}`, payload: { ...payload, at: new Date().toISOString() } },
    });
  } catch (err: unknown) {
    if ((err as { code?: string } | null)?.code === "P2002") return;
    console.warn("[order-contacts] событие не записано:", err instanceof Error ? err.message : err);
  }
}

/** Заказы, к которым подключён профиль (не его собственные). */
export async function watchedOrderIds(db: Db, userId: string): Promise<string[]> {
  const rows = await db.orderContact.findMany({ where: { userId, removedAt: null }, select: { orderId: true } }).catch(() => []);
  return rows.map((r: { orderId: string }) => r.orderId);
}

/** Активные контакты заказа для карточки админа. */
export async function listOrderContacts(db: Db, orderId: string) {
  return db.orderContact.findMany({
    where: { orderId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, via: true, evidence: true, createdAt: true, removedAt: true, removedBy: true,
      user: { select: { id: true, tgId: true, vkId: true, name: true, username: true } },
    },
  }).catch(() => []);
}

/* ── 5. Слова ───────────────────────────────────────────────────────────── */

const PLATFORM_WORD = { TG: "Telegram", VK: "ВКонтакте" } as const;

/** «Анна Кравец» → «А*** К.» — узнаёт себя, но не раскрывает чужого. */
export function maskName(name: string | null | undefined): string | null {
  const parts = String(name ?? "").replace(/[^\p{L}\p{N}\s]/gu, "").split(/\s+/).filter(Boolean);
  if (!parts.length) return null;
  const first = parts[0];
  const head = `${first.slice(0, 1).toUpperCase()}***`;
  return parts[1] ? `${head} ${parts[1].slice(0, 1).toUpperCase()}.` : head;
}

function ownerWhere(o: FoundOrder): string {
  const u = o.user;
  const where = u?.vkId && !u?.tgId ? "во ВКонтакте" : u?.tgId && !u?.vkId ? "в Telegram" : u?.tgId ? "в Telegram" : "на сайте";
  const masked = maskName(u?.name ?? u?.username);
  return masked ? `${where} (${masked})` : where;
}

const fmtDay = (d: Date | string) => new Date(d).toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: "Europe/Moscow" });

/** Как назвать заказ человеку: код — только если он сам его прислал. */
export function orderTitle(o: Pick<FoundOrder, "wbCode" | "amount" | "robloxUsername" | "probableNick" | "createdAt"> & { clue?: ClueKind }, html = true): string {
  const nick = o.robloxUsername ?? o.probableNick;
  const b = (s: string) => (html ? `<b>${escapeLite(s)}</b>` : s);
  const head = o.clue === "code" ? `заказ ${b(o.wbCode)} — ${o.amount} R$` : `заказ на ${o.amount} R$ от ${fmtDay(o.createdAt)}`;
  return nick ? `${head} на ник ${b(nick)}` : head;
}

const STATUS_WORD: Record<string, string> = {
  AWAITING_PAYMENT: "ждёт оплату",
  PAYMENT_PENDING: "ждёт подтверждение оплаты",
  AWAITING_GAMEPASS: "ждёт геймпасс",
  PENDING: "в очереди на выкуп",
  IN_PROGRESS: "в работе",
  COMPLETED: "выкуплен — робуксы в Pending у Roblox",
  REJECTED: "нужен новый геймпасс",
  ERROR: "менеджер разбирается",
};
export const statusWord = (s: string) => STATUS_WORD[s] ?? "в работе";

/** Вопрос «добавить этот аккаунт к заказу?» (HTML для TG, `html=false` — для VK). */
export function offerText(orders: FoundOrder[], platform: "TG" | "VK", html = true): string {
  const here = PLATFORM_WORD[platform];
  if (orders.length === 1) {
    const o = orders[0];
    return (
      `Нашла ${orderTitle(o, html)}.\n\n` +
      `Он оформлен ${ownerWhere(o)}, а вы пишете из ${here === "Telegram" ? "Telegram" : "ВКонтакте"}. ` +
      `Добавить этот аккаунт к заказу? Тогда статус и уведомления будут приходить и сюда.`
    );
  }
  return (
    `Нашла несколько заказов:\n` + orders.map((o) => `• ${orderTitle(o, html)}`).join("\n") +
    `\n\nОни оформлены с другого аккаунта. Какой из них ваш? Добавлю этот аккаунт к нему — статус и уведомления будут приходить и сюда.`
  );
}

/** Подпись кнопки заказа в вопросе с несколькими заказами (≤ 40 символов для VK). */
export function offerButtonLabel(o: FoundOrder, many: boolean): string {
  if (!many) return "✅ Да, добавить этот аккаунт";
  const nick = o.robloxUsername ?? o.probableNick;
  return `✅ ${o.amount} R$${nick ? ` · ${nick}` : ` · ${fmtDay(o.createdAt)}`}`.slice(0, 40);
}

export const DECLINE_LABEL = "Это не мой заказ";

/** После «да»: что сейчас с заказом и где получать уведомления. */
export function addedText(o: FoundOrder, opts: { inBot: boolean; html?: boolean }): string {
  const html = opts.html ?? true;
  const nick = o.robloxUsername ?? o.probableNick;
  const tail = opts.inBot
    ? "Уведомления о заказе будут приходить сюда."
    : "Чтобы мы сами написали, когда выкупим, откройте нашего бота и нажмите «Старт» — один раз.";
  return (
    `Готово, аккаунт добавлен к заказу${o.clue === "code" ? ` ${html ? `<b>${o.wbCode}</b>` : o.wbCode}` : ""}.\n\n` +
    `Сейчас: ${statusWord(o.status)}.` +
    (nick ? ` Робуксы придут на ${html ? `<b>${escapeLite(nick)}</b>` : nick}.` : "") +
    `\n\n${tail}`
  );
}

export function declinedText(): string {
  return (
    "Поняла, к этому заказу ничего не добавляю.\n\n" +
    "Проверьте код в чате WB — там 7 латинских букв и цифр. Если заказ на ваш ник, пришлите ссылку из чата или скрин — менеджер посмотрит."
  );
}

/** Почему не подключили — человеку (без внутренних причин). */
export function blockedText(reason: "held" | "revoked" | "limit" | "ambiguous" | "own" | "no_order"): string {
  if (reason === "ambiguous") return "На этот ник есть несколько разных заказов. Пришлите, пожалуйста, код из чата WB (7 букв и цифр) или ссылку из чата — так найду точно ваш.";
  if (reason === "own") return "Этот заказ уже привязан к вашему аккаунту.";
  return "Нашла заказ, но подключить к нему этот аккаунт сама не могу — передала менеджеру, он ответит здесь.";
}

/** Владельцу: к его заказу подключили ещё один аккаунт. */
export function ownerNoticeText(o: Pick<FoundOrder, "wbCode" | "robloxUsername" | "probableNick" | "amount">, who: { platform: "TG" | "VK"; label: string }, html = true): string {
  const nick = o.robloxUsername ?? o.probableNick;
  const ref = html ? `<b>${o.wbCode}</b>` : o.wbCode;
  return (
    `К вашему заказу ${ref}${nick ? ` (${html ? escapeLite(nick) : nick})` : ""} добавлен ещё один аккаунт: ` +
    `${PLATFORM_WORD[who.platform]} «${html ? escapeLite(who.label) : who.label}».\n\n` +
    `Теперь уведомления о заказе приходят и туда. Если вы этот аккаунт не знаете — уберите его.`
  );
}
export const OWNER_REMOVE_LABEL = "Убрать этот аккаунт";

/* ── 6. Копии уведомлений подключённым ──────────────────────────────────── */

export type WatcherEvent =
  | { kind: "completed" }
  | { kind: "rejected"; reason?: string | null }
  | { kind: "new_pass_needed"; price: number }
  | { kind: "pass_accepted" }
  | { kind: "buyer_step" };

export interface ContactSend {
  /** HTML-текст в Telegram. true — доставлено. */
  tg: (chatId: string, html: string, extra?: Record<string, unknown>) => Promise<boolean>;
  /** Обычный текст во ВКонтакте. */
  vk: (userId: string, text: string, extra?: Record<string, string>) => Promise<boolean>;
}

function watcherText(o: { amount: number; robloxUsername: string | null; probableNick: string | null }, ev: WatcherEvent): string {
  const nick = o.robloxUsername ?? o.probableNick;
  const ref = `заказ на ${o.amount} R$${nick ? ` (ник <b>${escapeLite(nick)}</b>)` : ""}`;
  const support = "Если геймпасс делаете вы — пришлите ссылку на него менеджеру: @RobloxBank_PA";
  switch (ev.kind) {
    case "completed":
      return `✅ ${cap(ref)} выкуплен.\n\nРобуксы уже в Roblox, в статусе Pending. Когда перевести их на баланс, решает Roblox — с нашей стороны всё сделано.`;
    case "rejected":
      return `❌ По заказу на ${o.amount} R$ нужен новый геймпасс${ev.reason ? `: <i>${escapeLite(ev.reason)}</i>` : "."}\n\nПодробную инструкцию отправили в аккаунт, где оформлен заказ. ${support}`;
    case "new_pass_needed":
      return `⚠️ По заказу на ${o.amount} R$ нужен новый геймпасс за <b>${ev.price} R$</b> без региональных цен.\n\nИнструкцию отправили в аккаунт, где оформлен заказ. ${support}`;
    case "pass_accepted":
      return `🎉 Геймпасс по заказу на ${o.amount} R$ принят — заказ в очереди на выкуп. Напишем, когда выкупим.`;
    case "buyer_step":
      return `📨 По заказу на ${o.amount} R$ нужен шаг от покупателя — что сделать, отправили в аккаунт, где оформлен заказ. ${support}`;
  }
}

/**
 * Разослать короткую копию события всем подключённым к заказу (не владельцу).
 * Ошибки не бросает: копия — дополнение к основному уведомлению, а не замена.
 * Код ВБ в копиях не пишем никогда: подключённого могли узнать по нику.
 */
export async function notifyOrderWatchers(db: Db, ref: { orderId?: string | null; wbCode?: string | null }, ev: WatcherEvent, send: ContactSend): Promise<number> {
  try {
    const where = ref.orderId ? { id: ref.orderId } : ref.wbCode ? { wbCode: ref.wbCode } : null;
    if (!where) return 0;
    const order = await db.wbOrder.findUnique({
      where,
      select: {
        id: true, userId: true, amount: true, robloxUsername: true, probableNick: true,
        contacts: { where: { removedAt: null }, select: { user: { select: { id: true, tgId: true, vkId: true } } } },
      },
    });
    if (!order?.contacts?.length) return 0;
    const html = watcherText(order, ev);
    let sent = 0;
    for (const c of order.contacts) {
      const u = c.user;
      if (!u || u.id === order.userId) continue;
      const ok = u.tgId
        ? await send.tg(u.tgId, html).catch(() => false)
        : u.vkId ? await send.vk(u.vkId, stripLite(html)).catch(() => false) : false;
      if (ok) sent++;
    }
    if (sent) console.log(`[order-contacts] копия «${ev.kind}» подключённым: ${sent}`);
    return sent;
  } catch (err) {
    console.warn("[order-contacts] копии не ушли:", err instanceof Error ? err.message : err);
    return 0;
  }
}

/* ── 7. Кнопки ──────────────────────────────────────────────────────────── */

export const CONTACT_CB = {
  add: "oc_add",
  no: "oc_no",
  rm: "oc_rm",
} as const;

/** `oc_add:<orderId>` / `oc_no:<orderId>` / `oc_rm:<contactId>` — влезает в 64 байта Telegram. */
export function parseContactCallback(raw: string): { action: "add" | "no" | "rm"; id: string } | null {
  const m = /^oc_(add|no|rm):([a-z0-9]{10,40})$/i.exec(String(raw ?? ""));
  return m ? { action: m[1] as "add" | "no" | "rm", id: m[2] } : null;
}

/** Строка ленты заказа для админки. */
export function contactEventText(type: string, payload: unknown): string | null {
  const p = (payload ?? {}) as Record<string, unknown>;
  const who = p.who ? `«${String(p.who)}»` : "аккаунт";
  const where = p.platform === "VK" ? "ВКонтакте" : p.platform === "TG" ? "Telegram" : "";
  if (type === CONTACT_EVENT.ADDED) {
    const via = VIA_WORD[String(p.via)] ?? "";
    return `Добавлен контакт: ${where} ${who}${via ? ` — ${via}` : ""}`.replace(/\s+/g, " ");
  }
  if (type === CONTACT_EVENT.REMOVED) {
    const by = String(p.by ?? "");
    return `Контакт убран${by === "owner" ? " владельцем" : by === "self" ? " самим аккаунтом" : by.startsWith("admin:") ? ` админом ${by.slice(6)}` : ""}`;
  }
  if (type === CONTACT_EVENT.DECLINED) return `${where} ${who} назвал улику заказа, но ответил «не мой» — не добавлен`.replace(/\s+/g, " ");
  return null;
}

export const VIA_WORD: Record<string, string> = {
  support_code: "из поддержки по коду",
  support_pass: "из поддержки по геймпассу",
  support_nick: "из поддержки по нику",
  bot_code: "в боте по коду",
  admin: "админом",
};

function cap(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }
function escapeLite(s: string): string { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function stripLite(s: string): string { return s.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"); }

/* ── 8. Что мы предложили и кому ────────────────────────────────────────────
   Кнопка «да» несёт только номер заказа. Нажатие засчитываем, лишь если бот
   сам недавно предложил ЭТОТ заказ ЭТОМУ аккаунту: так подделанный payload
   (во ВКонтакте его может прислать кто угодно) ничего не подключит, а улика
   (код/пасс/ник) доживает до нажатия и решает, можно ли потом называть код.
   Живёт в памяти процесса: после рестарта кнопка ответит «пришлите ещё раз».
   ───────────────────────────────────────────────────────────────────────── */

const OFFER_TTL_MS = 24 * 3600_000;
const offers = new Map<string, { orderIds: Map<string, { clue: ClueKind; evidence: string }>; at: number }>();

export function rememberOffer(subjectKey: string, orders: FoundOrder[]): void {
  offers.set(subjectKey, { orderIds: new Map(orders.map((o) => [o.id, { clue: o.clue, evidence: o.evidence }])), at: Date.now() });
  if (offers.size > 5000) offers.delete(offers.keys().next().value as string);
}

export function takeOffer(subjectKey: string, orderId: string): { clue: ClueKind; evidence: string } | null {
  const o = offers.get(subjectKey);
  if (!o || Date.now() - o.at > OFFER_TTL_MS) return null;
  return o.orderIds.get(orderId) ?? null;
}

export function dropOffer(subjectKey: string): void {
  offers.delete(subjectKey);
}

export const offerKey = (platform: "TG" | "VK", subject: string | number) => `${platform}:${subject}`;
export const STALE_OFFER_TEXT = "Этот вопрос устарел. Пришлите, пожалуйста, код из чата WB ещё раз — найду заказ заново.";
