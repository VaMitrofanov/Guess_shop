/* ─────────────────────────────────────────────────────────────────────────────
   Обращения покупателя по заказу, который ещё не выкуплен (01.11.2026).

   Владелец: «кто пишет в поддержку, тому больше всех неймется, тому быстрее
   всех надо выкупить». Но обращение обращению рознь, поэтому каждое сообщение
   делится на четыре вида:

   • rush   📣 «торопят»: где, когда, долго, «???», кнопка «Статус». Такой заказ
            поднимается в «Первым делом» в группу «Торопят».
   • cancel 🛑 «просят отмену»: верните деньги, отказ, отмените. С 03.11 заказ
            НЕ морозится — только отметка (`runBuyerContactSweep`).
   • human  💬 «нужен человек»: не получается, ошибка, где второй код. Выкуп этим
            не ускорить — событие уходит в «Риски», отвечает человек.
   • quiet  всё остальное: «спасибо», «получилось», присланные ник или ссылка.

   Классификатор — по словам, без «умных» моделей: цитата обращения видна в
   строке блока, так что промах сразу заметен глазами.

   Модуль чистый (кроме `findOrderByBuyerHints`) и общий для ботов и сайта.
   ───────────────────────────────────────────────────────────────────────── */

type BuyerContactKind = "rush" | "cancel" | "human" | "quiet";

/** Откуда пришло обращение — подпись канала в строке блока. */
type BuyerContactChannel = "TG" | "VK" | "WB";

/** Сколько обращение «греет» заказ: молчит дольше — заказ уходит из группы. */
export const BUYER_RUSH_WINDOW_HOURS = 48;

/** Контексты кнопки поддержки, которые сами по себе означают «где мой заказ». */
const RUSH_CONTEXTS = new Set([
  "status", "pending_long", "robux_overdue", "robux_low_pending", "robux_low_pending_retry",
]);

/**
 * Сообщение-ответ WB: «[Ответ]\n  <автор, время>\n  <цитата>\n\n<текст>».
 * Живой пример 31.10: под цитатой покупателя «Статус» шёл НАШ ответ бота, а WB
 * пометил всё сообщение как `client`. Отличить надёжно нечем, поэтому такие
 * сообщения не считаются обращением вовсе: исходный вопрос покупателя всё равно
 * пришёл отдельным сообщением раньше.
 */
export function isWbReplyEcho(text: string | null | undefined): boolean {
  return /^\s*\[Ответ\]/.test(text ?? "");
}

const norm = (text: string) =>
  text.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();

// `\b` в JS понимает только латиницу: «где» между пробелами для него не слово.
// Поэтому граница — «не буква и не цифра» в смысле Юникода.
const wordRe = (parts: string[]) =>
  new RegExp(parts.join("|").replace(/\\b/g, "(?:(?<![\\p{L}\\d])|(?![\\p{L}\\d]))"), "u");

// Порядок проверки важен: «где робуксы, верните деньги» — это отмена, а
// «долго не получается создать пасс» — это всё-таки «торопят».
const CANCEL_RE = wordRe([
  "верн[иуё]\\S*\\s+(мне\\s+)?(мои\\s+)?(деньг|день|средств|оплат)",
  "возврат\\S*\\s+(денег|средств|деньг)",
  "деньги\\s+(назад|обратно|верн)",
  "\\bотказ(ываюсь|аться|\\b)",
  "отмен(ите|яйте|ить|яю|а\\s+заказ|ить\\s+заказ)",
  "оформ\\S*\\s+возврат",
  "\\brefund",
  "не\\s+нужн\\S*\\s+(уже\\s+)?(робукс|заказ)",
  "(сделать|хочу|хотим|оформлю|оформим)\\s+возврат", "как\\s+(мне\\s+)?вернуть", "хочу\\s+вернуть",
]);

const RUSH_RE = wordRe([
  "\\bгде\\b", "\\bкогда\\b", "долго", "\\bскоро\\b", "\\bжд(у|ем|ать|ете|ала|ал)\\b",
  "сколько\\s+(ещ[её]|можно|ждать|времени)", "быстрее", "\\?{2,}", "\\bало+\\b", "\\bау+\\b",
  "не\\s+приш", "не\\s+пришл", "не\\s+пришли", "не\\s+зачисл", "не\\s+поступ", "нет\\s+робукс",
  "статус", "\\bвыкуп", "уже\\s+(\\d+|день|два|три|сутки|неделю)", "прошл\\S*\\s+(\\d+|день|сутки|недел)",
  "\\bскока\\b", "\\bкогда\\s+будут",
]);

/** Вопрос не про скорость, даже если в нём есть «где»: «где второй код?» —
 * выкуп этого заказа ничего не решит, отвечать должен человек. */
const HUMAN_STRONG_RE = wordRe([
  "втор(ой|ого|ому)\\s+(код|заказ)", "друг(ой|ого|ому)\\s+(код|аккаунт|ник|заказ)", "(сменить|поменять|изменить)\\s+ник",
  "не\\s+тот\\s+(ник|аккаунт)", "не\\s+на\\s+тот", "ошиб\\S*\\s+(в\\s+)?ник",
]);

const HUMAN_RE = wordRe([
  "не\\s+получа", "не\\s+получи", "не\\s+могу", "не\\s+выходит", "ошибк", "помогите", "помочь",
  "\\bкак\\b", "неправильн", "\\bпочему\\b", "не\\s+вижу", "не\\s+работа",
]);

const QUIET_RE = wordRe(["спасибо", "\\bспс\\b", "благодар", "получилось", "\\bпришли\\b", "\\bпришло\\b", "все\\s+ок\\b", "\\bок\\b", "\\bпонял", "\\bхорошо\\b"]);

/**
 * Вид сообщения. `contextKey` — с какой кнопки поддержки человек пришёл:
 * «Статус» без внятного текста — это тоже «торопят».
 */
export function classifyBuyerMessage(
  text: string | null | undefined,
  opts: { contextKey?: string | null; viaSupport?: boolean } = {},
): BuyerContactKind {
  const t = norm(text ?? "");
  if (t && CANCEL_RE.test(t)) return "cancel";
  if (t && HUMAN_STRONG_RE.test(t)) return "human";
  if (t && RUSH_RE.test(t)) return "rush";
  if (t && HUMAN_RE.test(t)) return "human";
  if (RUSH_CONTEXTS.has(opts.contextKey ?? "")) return "rush";
  if (t && QUIET_RE.test(t)) return "quiet";
  // До менеджера человек дошёл нарочно — через кнопку и описание проблемы.
  // Это уже «неймётся», даже если слова ничего не говорят. Чат WB так не
  // считается: там идёт обычная переписка — коды, ники, ссылки.
  return opts.viaSupport ? "rush" : "quiet";
}

/** Одно обращение в том виде, в каком его видит блок «Первым делом». */
export interface BuyerContact {
  orderId: string;
  at: Date;
  channel: BuyerContactChannel;
  text: string | null;
  kind: BuyerContactKind;
  /** Как человек обратился: кнопка «Статус», описание менеджеру или чат WB. */
  via?: "status" | "support" | "chat";
}

export interface BuyerRush {
  /** Сколько раз писал за окно — «накал». */
  count: number;
  channels: BuyerContactChannel[];
  lastAt: Date;
  lastText: string | null;
  lastChannel: BuyerContactChannel;
  lastVia: "status" | "support" | "chat";
}

/**
 * Свести обращения в «торопят» по заказам: учитываются только rush, за
 * `BUYER_RUSH_WINDOW_HOURS`. Отмена и «нужен человек» сюда не идут —
 * первую морозит проход бота, вторую разбирает человек в «Рисках».
 */
export function summarizeRush(contacts: BuyerContact[], now = new Date()): Map<string, BuyerRush> {
  const since = now.getTime() - BUYER_RUSH_WINDOW_HOURS * 3_600_000;
  const out = new Map<string, BuyerRush>();
  const sorted = [...contacts].sort((a, b) => a.at.getTime() - b.at.getTime());
  for (const c of sorted) {
    if (c.kind !== "rush" || c.at.getTime() < since) continue;
    const prev = out.get(c.orderId);
    if (!prev) {
      out.set(c.orderId, {
        count: 1, channels: [c.channel], lastAt: c.at, lastText: c.text, lastChannel: c.channel, lastVia: c.via ?? "support",
      });
      continue;
    }
    prev.count += 1;
    if (!prev.channels.includes(c.channel)) prev.channels.push(c.channel);
    prev.lastAt = c.at;
    prev.lastChannel = c.channel;
    // Пустая кнопка «Статус» не затирает последнюю живую цитату.
    if (c.text) {
      prev.lastText = c.text;
      prev.lastVia = c.via ?? "support";
    } else if (!prev.lastText) {
      prev.lastVia = c.via ?? "support";
    }
  }
  return out;
}


/** Цитата в строку блока: одна строка, без переносов, не длиннее `max`. */
export function contactQuote(text: string | null | undefined, max = 120): string | null {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/* ─── Поиск заказа без кода ────────────────────────────────────────────────
   Покупатель пишет «где робуксы» с другого аккаунта и без кода. Ищем по тому,
   что он помнит наверняка: код (в любом написании), ссылка или ID геймпасса,
   ник Roblox (ссылка на профиль или «ник: …»).
   ───────────────────────────────────────────────────────────────────────── */

interface BuyerHints {
  codes: string[];
  gamepassIds: string[];
  nicks: string[];
}

const NICK_RE = /^[A-Za-z0-9_]{3,20}$/;

export function extractBuyerHints(text: string | null | undefined): BuyerHints {
  const raw = String(text ?? "");
  const codes = new Set<string>();
  const gamepassIds = new Set<string>();
  const nicks = new Set<string>();

  // Код: 7 знаков с хотя бы одной буквой; допускаем «GSR 9TNF» и «GSR-9TNF».
  for (const m of raw.matchAll(/(?<![A-Za-z0-9])([A-Za-z0-9]{3})[\s-]?([A-Za-z0-9]{4})(?![A-Za-z0-9])/g)) {
    const code = `${m[1]}${m[2]}`.toUpperCase();
    if (/[A-Z]/.test(code) && /\d/.test(code)) codes.add(code);
  }
  for (const m of raw.matchAll(/game-?pass(?:es)?\/(\d{5,15})/gi)) gamepassIds.add(m[1]);
  for (const m of raw.matchAll(/(?:pass\s*id|id\s*пасса|геймпасс\S*)\D{0,5}(\d{6,15})/gi)) gamepassIds.add(m[1]);
  for (const m of raw.matchAll(/roblox\.com\/users\/\d+\/profile|@([A-Za-z0-9_]{3,20})/gi)) {
    if (m[1]) nicks.add(m[1]);
  }
  for (const m of raw.matchAll(/(?:ник|nick|username|логин|аккаунт)\s*(?:в\s+роблокс\S*|roblox)?\s*[:—-]?\s*([A-Za-z0-9_]{3,20})/gi)) {
    if (NICK_RE.test(m[1])) nicks.add(m[1]);
  }
  // Сообщение из одного слова латиницей — почти всегда ник.
  const single = raw.trim();
  if (NICK_RE.test(single) && /[A-Za-z]/.test(single) && !codes.has(single.toUpperCase())) nicks.add(single);

  return { codes: [...codes], gamepassIds: [...gamepassIds], nicks: [...nicks] };
}

function hasBuyerHints(h: BuyerHints): boolean {
  return h.codes.length + h.gamepassIds.length + h.nicks.length > 0;
}

export interface MatchedOrder {
  wbCode: string;
  amount: number;
  /** По чему нашли — подпись в алерте админу. */
  by: "code" | "gamepass" | "nick";
}

// Клиент Prisma у ботов и у сайта разный по типам — модуль принимает утиный.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

/**
 * Найти заказ по подсказкам из текста. Возвращает заказ, только если он
 * ОДИН: два заказа на один ник — это гадание, и тогда менеджер выбирает сам.
 * Ищем среди невыкупленных и выкупленных за 60 дней — «где робуксы» пишут и
 * после выкупа.
 */
export async function findOrderByBuyerHints(db: Db, hints: BuyerHints): Promise<MatchedOrder | null> {
  if (!hasBuyerHints(hints)) return null;
  const since = new Date(Date.now() - 60 * 86_400_000);
  try {
    if (hints.codes.length > 0) {
      const byCode = await db.wbOrder.findMany({
        where: { wbCode: { in: hints.codes }, isTest: false },
        select: { wbCode: true, amount: true },
        take: 2,
      });
      if (byCode.length === 1) return { ...byCode[0], by: "code" };
    }
    if (hints.gamepassIds.length > 0) {
      const byPass = await db.wbOrder.findMany({
        where: { gamepassId: { in: hints.gamepassIds }, isTest: false, createdAt: { gte: since } },
        select: { wbCode: true, amount: true },
        take: 2,
      });
      if (byPass.length === 1) return { ...byPass[0], by: "gamepass" };
    }
    if (hints.nicks.length > 0) {
      const byNick = await db.wbOrder.findMany({
        where: {
          OR: hints.nicks.map((nick) => ({ robloxUsername: { equals: nick, mode: "insensitive" } })),
          isTest: false,
          createdAt: { gte: since },
          status: { notIn: ["REJECTED"] },
        },
        select: { wbCode: true, amount: true },
        orderBy: { createdAt: "desc" },
        take: 2,
      });
      if (byNick.length === 1) return { ...byNick[0], by: "nick" };
    }
  } catch {
    /* поиск — подсказка, а не условие доставки обращения */
  }
  return null;
}

/** Подпись находки в алерте менеджеру. */
export function matchedByLabel(by: MatchedOrder["by"]): string {
  return by === "code" ? "по коду из текста" : by === "gamepass" ? "по геймпассу из текста" : "по нику Roblox из текста";
}

/** Ожидание дополнения: следующее сообщение человека уйдёт менеджеру и найдёт заказ. */
export const BUYER_HINT_CONTEXT = "order_hint";

/** Что бот просит у человека, если заказ найти не удалось. Без «номера заказа»:
 * покупатель знает код с карты, ник и свой пасс, а номер WB ему ничего не даст. */
export const BUYER_HINT_REQUEST_TEXT =
  "Чтобы мы быстрее нашли ваш заказ, пришлите, пожалуйста, одно из трёх:\n"
  + "• код с карты Wildberries (7 знаков, например GSR9TNF);\n"
  + "• ник в Roblox, на который ждёте Robux;\n"
  + "• ссылку на ваш геймпасс.";

/* ─── Откуда берутся обращения ─────────────────────────────────────────────
   Два источника, оба уже пишутся:
   • `OrderEvent` SUPPORT_REQUEST_DELIVERED (TG/VK: описание проблемы ушло
     менеджеру; текст в payload с 01.11.2026) и ROBUX_QUESTION_SELF_SERVED
     (кнопка «Статус» — бот ответил сам, но человек спросил);
   • сообщения покупателя в чате WB (`WbBuyerChatEvent`, sender = client),
     связанные с заказом через сборочное задание и код.
   ───────────────────────────────────────────────────────────────────────── */

interface BuyerContactRow extends BuyerContact {
  /** id исходной строки — ключ идемпотентности для событий риска. */
  sourceId: string;
  wbCode: string;
  amount: number;
  buyerName: string | null;
  wbOrderId: string | null;
}

const CONTACT_TYPES = `'SUPPORT_REQUEST_DELIVERED','ROBUX_QUESTION_SELF_SERVED'`;

/**
 * Обращения с `since` по заказам, подходящим под `orderWhereSql` (условие над
 * `WbOrder` без алиаса — например, общий `BUYOUT_QUEUE_SQL`). Один заход в базу.
 */
export async function loadBuyerContacts(
  db: Db,
  input: { since: Date; orderWhereSql: string },
): Promise<BuyerContactRow[]> {
  const rows: Array<{
    sourceId: string; orderId: string; at: Date; channel: BuyerContactChannel; text: string | null;
    contextKey: string | null; viaSupport: boolean; wbCode: string; amount: number;
    buyerName: string | null; wbOrderId: string | null;
  }> = await db.$queryRawUnsafe(`
    WITH o AS (
      SELECT "id", "wbCode", "amount" FROM "WbOrder"
       WHERE "isTest" = false AND (${input.orderWhereSql})
    )
    SELECT e."id" AS "sourceId", o."id" AS "orderId", e."createdAt" AS "at",
           CASE WHEN e."payload"->>'via' = 'vk-bot' THEN 'VK' ELSE 'TG' END AS "channel",
           e."payload"->>'text' AS "text",
           CASE WHEN e."type" = 'ROBUX_QUESTION_SELF_SERVED' THEN 'status' ELSE e."payload"->>'contextKey' END AS "contextKey",
           (e."type" = 'SUPPORT_REQUEST_DELIVERED') AS "viaSupport",
           o."wbCode", o."amount", NULL::text AS "buyerName", NULL::text AS "wbOrderId"
      FROM "OrderEvent" e JOIN o ON o."id" = e."orderId"
     WHERE e."type" IN (${CONTACT_TYPES}) AND e."createdAt" >= $1
    UNION ALL
    SELECT ce."id", o."id", ce."sentAt", 'WB', ce."textRedacted", NULL, false,
           o."wbCode", o."amount", m."buyerName", m."wbOrderId"
      FROM "WbBuyerChatEvent" ce
      JOIN "WbMarketplaceOrder" m ON m."id" = ce."marketplaceOrderId"
      JOIN "WbCode" c ON c."id" = m."wbCodeId"
      JOIN o ON o."wbCode" = c."code"
     WHERE ce."sender" = 'client' AND ce."sentAt" >= $1 AND ce."containsDeliveryCode" = false
  `, input.since);
  return rows.map((r) => ({
    sourceId: r.sourceId,
    orderId: r.orderId,
    at: new Date(r.at),
    channel: r.channel,
    text: r.text,
    via: r.channel === "WB" ? "chat" : r.viaSupport ? "support" : "status",
    kind: r.channel === "WB" && isWbReplyEcho(r.text)
      ? "quiet"
      : classifyBuyerMessage(r.text, { contextKey: r.contextKey, viaSupport: r.viaSupport }),
    wbCode: r.wbCode,
    amount: Number(r.amount),
    buyerName: r.buyerName,
    wbOrderId: r.wbOrderId,
  }));
}

/** Условие EXISTS «по заказу писали за окно» — для выборки строк блока. */
export function recentContactExistsSql(hours = BUYER_RUSH_WINDOW_HOURS): string {
  const since = `NOW() - INTERVAL '${Math.trunc(hours)} hours'`;
  return `(EXISTS (SELECT 1 FROM "OrderEvent" e WHERE e."orderId" = "WbOrder"."id" AND e."type" IN (${CONTACT_TYPES}) AND e."createdAt" >= ${since})
    OR EXISTS (SELECT 1 FROM "WbBuyerChatEvent" ce
                 JOIN "WbMarketplaceOrder" m ON m."id" = ce."marketplaceOrderId"
                 JOIN "WbCode" c ON c."id" = m."wbCodeId"
                WHERE c."code" = "WbOrder"."wbCode" AND ce."sender" = 'client' AND ce."sentAt" >= ${since}))`;
}

/* ─── Закреп «Код вашего заказа» в боте ───────────────────────────────────
   Сразу после активации бот присылает и закрепляет короткую карточку с
   кодом: она всегда наверху чата, и «напишите код» больше не тупик. Номера
   заказа WB тут нет и не будет: покупатель знает код с карты, а номер WB ему
   ничего не скажет (см. feedback «никаких номеров заказов клиенту»).
   ───────────────────────────────────────────────────────────────────────── */
export function orderCodePinText(code: string, denomination: number, format: "html" | "plain"): string {
  const shown = format === "html" ? `<code>${code}</code>` : code;
  return `📌 Код вашего заказа: ${shown} · ${denomination.toLocaleString("ru-RU")} R$\n`
    + "Сохраните его. Если напишете в поддержку — назовите код, так мы сразу найдём ваш заказ.";
}
