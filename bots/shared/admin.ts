/**
 * Admin notification helpers.
 *
 * Both the TG and VK bots use these to deliver order cards and review
 * screenshot requests to Telegram admins.  All admin-facing interactions
 * happen exclusively through Telegram (inline button callbacks are handled
 * by the TG bot).
 */

import { tgSend, tgSendPhoto, escapeHtml } from "./notify";
import { db } from "./db";
import { directPrice } from "./retail-pricing";
import { formatOrderAge } from "./order-age";
import { resolveWbOrderRef, wbOrderSourceLabel } from "./wb-order-source";
import { orderCardRoots, orderThreadRoots, replyToRoot } from "./order-thread";
import { refreshDbsCardByCode } from "./wb-dbs-thread";
import { heldCustomerFor } from "./order-hold";
import { twaLaunchUrl } from "./twa-link";
import { formatAdminNotice, mskTime, orderRef } from "./notify-format";
export {
  BONUS_MIN_PACK,
  CUSTOM_MAX,
  CUSTOM_MIN,
  DIRECT_PACKS,
  DIRECT_PRICES,
  RETAIL_PRICING_POLICY_VERSION,
  customRate,
  directPrice,
  getRetailPriceBreakdown,
} from "./retail-pricing";

/**
 * Идентификатор заказа в карточках = его код (ВБ / DIR- / AV-), не внутренний
 * номер (#SHORTID убраны по решению владельца 2026-07-03, вариант C2).
 * Резолвит код по id заказа для карточек, куда код не передаётся явно.
 */
export async function orderCode(orderId: string): Promise<string | null> {
  try {
    const o = await (db as any).wbOrder.findUnique({ where: { id: orderId }, select: { wbCode: true } });
    return o?.wbCode ?? null;
  } catch {
    return null;
  }
}

// ── Direct order pricing ───────────────────────────────────────────────────────

/** Special promo prices for non-bonus users (Friday push). */
export const PROMO_PRICES: Record<number, number> = {
  100:  100,
  200:  200,
  500:  450,
  1000: 800,
};

/** @deprecated Kept for admin card backwards compat — use directPrice() instead. */
export const DIRECT_RATE = 0.7;

export const ROBLOX_NICK_RE = /^[A-Za-z0-9_]{3,20}$/;

export function generateDirectCode(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "DIR-";
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// ── Support alert ─────────────────────────────────────────────────────────────

const SUPPORT_CONTEXT_LABELS: Record<string, string> = {
  code_not_found: "Код не найден",
  code_mine:      "Код уже активирован (повторный вход)",
  code_claimed:   "Код активирован другим пользователем",
  pass_format:    "Не распознан формат геймпасса",
  pass_not_found: "Геймпасс не найден на Roblox",
  pass_private:   "Геймпасс в закрытой игре",
  pass_inactive:  "Геймпасс не выставлен на продажу",
  pass_price:     "Неверная цена геймпасса",
  pass_deleted:   "Геймпасс удалён",
  roblox_down:    "Серверы Roblox недоступны",
  order_dupe:     "Дублирующийся заказ",
  order_lost:     "Заказ не найден",
  rejected:       "Заказ отклонён",
  resubmit:       "Исправление ссылки",
  review_rej:     "Отзыв отклонён",
  pending_long:   "Заказ долго в обработке",
  direct_wait:    "Долгое ожидание прямого заказа",
  general:        "Общий вопрос",
  // Item 7 Phase E — nick-search dead-ends
  nick_not_found: "Ник Roblox не найден",
  place_closed:   "Закрытый плейс / нет публичных геймпассов",
  wrong_price:    "Геймпасс есть, но цена неверна",
};

export interface SupportAlertPayload {
  platform:     "TG" | "VK";
  userDisplay:  string;
  tgId?:        string;
  /** Нужен, чтобы опознать замороженного клиента, пишущего из VK. */
  vkId?:        string;
  contextKey:   string;
  wbCode?:      string;
  denomination?: number;
}

/**
 * ❄️ Шапка алерта для замороженного клиента.
 *
 * Алерт в админ-чат приходил и раньше, но человек с заморозкой был в нём
 * неотличим от обычного покупателя: менеджер начинал отвечать «сейчас выкупим»
 * по заказу, который выкупать нельзя. Признак должен стоять ДО всех полей.
 *
 * Никогда не бросает и не пустая проверка не блокирует сам алерт: сообщение в
 * поддержку важнее, чем пометка в нём (см. `heldCustomerFor`).
 */
/** ❄️ Строка заморозки для алертов поддержки: человек с заморозкой должен быть
 *  отличим от обычного покупателя ДО того, как менеджер начнёт отвечать
 *  «сейчас выкупим» по заказу, который выкупать нельзя. */
async function heldLinesFor(p: SupportAlertPayload): Promise<string[]> {
  const held = await heldCustomerFor(db, { tgId: p.tgId, vkId: p.vkId });
  if (!held) return [];
  const codes = held.codes.map((c) => `<code>${escapeHtml(c)}</code>`).join(", ");
  return [`❄️ <b>Заморожен:</b> ${escapeHtml(held.reason)}`, `❄️ Коды: ${codes}`];
}

/* ── Что за заказ у человека, который зовёт поддержку ────────────────────────
   Алерт называл код, номинал и причину, по которой человек нажал кнопку, —
   и на этом заканчивался. Дальше владелец шёл искать заказ руками: открыть
   дашборд, найти код, посмотреть статус, посчитать, сколько он висит, и только
   после этого понять, о чём вообще разговор. На «Заказ долго в обработке» это
   три-четыре минуты до первого слова клиенту.

   Поэтому алерт сам договаривает: в каком заказ статусе, сколько ждёт, что его
   держит и какой это заказ по счёту у клиента. Ровно те факты, за которыми
   пришлось бы идти, — не пересказ карточки.

   Ничего не бросает: сообщение в поддержку важнее, чем справка внутри него
   (то же правило, что и у `heldLinesFor`).
   ────────────────────────────────────────────────────────────────────────── */

const SUPPORT_STATUS_LABELS: Record<string, string> = {
  AWAITING_PAYMENT:  "ждёт оплаты",
  PAYMENT_PENDING:   "оплата в обработке",
  AWAITING_GAMEPASS: "ждёт ссылку на геймпасс",
  PENDING:           "в очереди на выкуп",
  IN_PROGRESS:       "выкупается",
  COMPLETED:         "выкуплен",
  REJECTED:          "отклонён",
  ERROR:             "ошибка выкупа",
};

/** Коды `buyoutErrorCode` человеческим языком; незнакомый показываем как есть. */
const BUYOUT_ERROR_LABELS: Record<string, string> = {
  REGIONAL_PRICE:       "у донора региональная цена, замены по нику нет",
  ROBLOX_PLUS_FLOW:     "донор в потоке Roblox+",
  LEGACY_PURCHASE_FLOW: "старый поток покупки",
};

const SUPPORT_ORDER_SELECT = {
  id: true, wbCode: true, amount: true, status: true, platform: true, orderSource: true,
  isDirectOrder: true, paidAt: true, gamepassId: true, gamepassUrl: true,
  robloxUsername: true, probableNick: true, remindersSent: true, buyoutErrorCode: true,
  rejectionReason: true, adminNote: true, userId: true,
  createdAt: true, pendingAt: true, completedAt: true,
  splitGamepasses: { select: { purchasedAt: true } },
} as const;

/** Последняя строка заметки: там лежит то, что делали с заказом последним. */
function lastNoteLine(note: string | null | undefined): string | null {
  const lines = (note ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
  const last = lines[lines.length - 1];
  if (!last) return null;
  return last.length > 140 ? `${last.slice(0, 137)}…` : last;
}

/** Строка «что держит заказ» — по одной ветке на статус, без домыслов. */
function blockerLine(order: any): string | null {
  const parts: string[] = [];
  switch (order.status) {
    case "AWAITING_GAMEPASS": {
      const nick = order.robloxUsername ?? order.probableNick;
      parts.push("🧩 Пасса нет");
      parts.push(nick
        ? `ник ${order.robloxUsername ? "" : "под вопросом "}<code>${escapeHtml(String(nick))}</code>`
        : "ник не назван");
      const sent = Number(order.remindersSent ?? 0);
      parts.push(sent >= 3 ? `напоминаний ${sent} — бот замолчал` : `напоминаний ${sent} из 3`);
      break;
    }
    case "PENDING":
    case "IN_PROGRESS": {
      const split: { purchasedAt: Date | null }[] = order.splitGamepasses ?? [];
      if (split.length > 0) {
        const bought = split.filter((part) => part.purchasedAt).length;
        parts.push(`🧩 Разбит: выкуплено ${bought} из ${split.length}`);
      } else if (order.gamepassId) {
        parts.push(`🧩 Пасс <code>${escapeHtml(String(order.gamepassId))}</code>`);
      } else {
        parts.push("🧩 Пасса нет — выкупать нечего");
      }
      if (order.pendingAt) parts.push(`в очереди ${formatOrderAge(order.pendingAt)}`);
      break;
    }
    case "ERROR": {
      const code = order.buyoutErrorCode as string | null;
      parts.push(`⛔ Выкуп встал${code ? `: ${BUYOUT_ERROR_LABELS[code] ?? escapeHtml(code)}` : ""}`);
      break;
    }
    case "AWAITING_PAYMENT":
    case "PAYMENT_PENDING":
      parts.push("💳 Деньги за прямой заказ не подтверждены");
      break;
    case "COMPLETED":
      // Самый частый разговор «долго в обработке» — про уже выкупленный заказ:
      // робуксы у Roblox лежат под замком пять дней, и это не наша задержка.
      parts.push(order.completedAt
        ? `✅ Выкуплен, прошло ${formatOrderAge(order.completedAt)}`
        : "✅ Выкуплен");
      break;
    case "REJECTED":
      parts.push(`⛔ Отклонён${order.rejectionReason ? `: ${escapeHtml(String(order.rejectionReason))}` : ""}`);
      break;
    default:
      break;
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

interface SupportOrderBrief {
  lines: string[];
  /** Код найденного заказа — шапка алерта берёт его, если бот не передал свой. */
  code: string | null;
  denomination: number | null;
}

const NO_BRIEF: SupportOrderBrief = { lines: [], code: null, denomination: null };

async function supportOrderBrief(p: SupportAlertPayload): Promise<SupportOrderBrief> {
  try {
    let order: any = p.wbCode
      ? await (db as any).wbOrder.findUnique({ where: { wbCode: p.wbCode }, select: SUPPORT_ORDER_SELECT })
      : null;

    // Бот шлёт код не всегда (общий вопрос, обращение из меню) — тогда берём
    // последний тронутый заказ этого же человека: разговор почти всегда о нём.
    if (!order) {
      const userWhere = p.tgId ? { tgId: String(p.tgId) } : p.vkId ? { vkId: String(p.vkId) } : null;
      if (!userWhere) return NO_BRIEF;
      const user = await (db as any).user.findUnique({ where: userWhere, select: { id: true } });
      if (!user) return NO_BRIEF;
      order = await (db as any).wbOrder.findFirst({
        where: { userId: user.id, isTest: false },
        orderBy: { updatedAt: "desc" },
        select: SUPPORT_ORDER_SELECT,
      });
    }
    if (!order) return NO_BRIEF;

    const ordersTotal: number = await (db as any).wbOrder
      .count({ where: { userId: order.userId, isTest: false } })
      .catch(() => 0);

    const status = SUPPORT_STATUS_LABELS[order.status] ?? String(order.status);
    // Полосу называем только у DBS: там у разговора другие сроки и другой чат.
    // У обычного WB-заказа источник совпал бы с платформой из шапки — шум.
    const lane = order.orderSource === "WB_DBS" ? " · 🚚 WB DBS" : "";
    const lines: string[] = [
      `📦 Заказ: <b>${status}</b> · возраст ${formatOrderAge(order.createdAt)}${lane}`,
    ];
    const blocker = blockerLine(order);
    if (blocker) lines.push(blocker);
    if (ordersTotal > 1) lines.push(`👤 ${ordersTotal}-й заказ этого клиента`);
    const note = lastNoteLine(order.adminNote);
    if (note) lines.push(`📝 ${escapeHtml(note)}`);

    return { lines, code: order.wbCode ?? null, denomination: order.amount ?? null };
  } catch (error) {
    console.warn("[admin] supportOrderBrief failed:", (error as Error)?.message ?? error);
    return NO_BRIEF;
  }
}

export async function sendAdminSupportAlert(p: SupportAlertPayload): Promise<void> {
  const label = SUPPORT_CONTEXT_LABELS[p.contextKey] ?? p.contextKey;
  const [heldLines, brief] = await Promise.all([heldLinesFor(p), supportOrderBrief(p)]);
  const frozen = heldLines.length > 0;
  // Код в шапке — тот, по которому собрана справка: иначе строка ссылалась бы
  // на один заказ, а «📦 Заказ: …» под ней — на другой.
  const code = p.wbCode ?? brief.code;
  const denomination = p.denomination ?? brief.denomination;

  const text = formatAdminNotice({
    // Замороженный в поддержке — не «человеку нужна помощь», а «сейчас пойдёт
    // разговор по заказу, который выкупать нельзя»: это красный, не оранжевый.
    marker: frozen ? "urgent" : "action",
    zone: "ПОДДЕРЖКА",
    title: frozen ? "пишет ЗАМОРОЖЕННЫЙ клиент" : "обращение в поддержку",
    lines: [
      orderRef({ code, denomination }, [
        p.userDisplay,
        `${p.platform}`,
        mskTime(new Date()),
      ]),
      ...heldLines,
      `📍 Причина: <b>${label}</b>`,
      // Справка по заказу идёт ПОСЛЕ причины: сначала «с чем пришли», потом
      // «что на самом деле с заказом». В таком порядке их и читают.
      ...brief.lines,
    ],
    next: p.platform === "TG" && p.tgId
      ? `<a href="tg://user?id=${p.tgId}">написать пользователю</a>`
      : "ответить из чата платформы",
  });

  // Кнопка ведёт в дашборд, уже наведённый на этот заказ: последний шаг, ради
  // которого иначе пришлось бы копировать код и искать его руками.
  const reply_markup = (adminId: string) => (code
    ? { inline_keyboard: [[{ text: "📊 Открыть заказ", web_app: { url: twaLaunchUrl(adminId, { q: code }) } }]] }
    : undefined);

  // Обращение по заказу встаёт в ту же ветку, что и карточки этого заказа:
  // «клиент пишет» и «вот его заказ» — одно дело, а не два.
  const roots = await orderThreadRoots(db, code);
  await Promise.allSettled(ADMIN_IDS.map((id) =>
    tgSend(id, text, { reply_markup: reply_markup(id), ...replyToRoot(roots, id) })));
}

/** Public support contact. Used as the final URL the bot hands the user after
 *  they tap the in-bot support button — see TG `sup:<ctxKey>` callback. */
export const SUPPORT_URL = "https://t.me/RobloxBank_PA";

// In-memory dedup shared by the full SOS alert (real tap) and the lightweight
// "user hurdle" heads-up (show-time on a dead-end). Different namespaces so
// the two streams don't poison each other's TTL window.
const SUPPORT_ALERT_TTL_MS = 30 * 60 * 1000;
const supportAlertSeen = new Map<string, number>();

function cleanupSupportAlertSeen(now: number): void {
  if (supportAlertSeen.size <= 500) return;
  for (const [k, t] of supportAlertSeen) if (now - t > SUPPORT_ALERT_TTL_MS) supportAlertSeen.delete(k);
}

/** Deduplicated wrapper around {@link sendAdminSupportAlert} for real button-tap
 *  events (currently fired from the TG `sup:<ctxKey>` callback and from VK's
 *  payload-driven support button). */
export async function notifySupportShown(p: SupportAlertPayload): Promise<void> {
  const key = `SOS:${p.platform}:${p.tgId ?? p.userDisplay}:${p.contextKey}`;
  const now = Date.now();
  const last = supportAlertSeen.get(key);
  if (last && now - last < SUPPORT_ALERT_TTL_MS) return;
  supportAlertSeen.set(key, now);
  cleanupSupportAlertSeen(now);
  await sendAdminSupportAlert(p);
}

/** "User got stuck" heads-up — fires at show-time when the bot puts a support
 *  button in front of the user after a UX dead-end (wrong nick, closed place,
 *  wrong price, etc.). Distinct from the full SOS alert: one-liner, no 🆘
 *  scream emoji, just a 👀 + stage + code so the admin can decide whether to
 *  jump in proactively. Real SOS still fires *only* when the user actually
 *  taps the support button (see {@link notifySupportShown}). */
export async function notifyUserHurdle(p: SupportAlertPayload): Promise<void> {
  const key = `HURDLE:${p.platform}:${p.tgId ?? p.userDisplay}:${p.contextKey}`;
  const now = Date.now();
  const last = supportAlertSeen.get(key);
  if (last && now - last < SUPPORT_ALERT_TTL_MS) return;
  supportAlertSeen.set(key, now);
  cleanupSupportAlertSeen(now);

  const label = SUPPORT_CONTEXT_LABELS[p.contextKey] ?? p.contextKey;
  // ❄️ Тупик замороженного клиента — это не «человеку нужна помощь», а «сейчас
  // он придёт в поддержку по заказу, который выкупать нельзя».
  const held = await heldCustomerFor(db, { tgId: p.tgId, vkId: p.vkId });
  const text = formatAdminNotice({
    // Мяч на стороне клиента: он ещё не попросил помощи, мы только видим тупик.
    marker: held ? "urgent" : "waiting",
    zone: "ПОДДЕРЖКА",
    title: held ? "ЗАМОРОЖЕННЫЙ застрял" : "клиент застрял",
    lines: [
      orderRef({ code: p.wbCode ?? null, denomination: p.denomination ?? null }, [
        p.userDisplay,
        `${p.platform}`,
        mskTime(new Date()),
      ]),
      held ? `❄️ ${escapeHtml(held.reason)}` : null,
      `📍 Этап: <b>${label}</b>`,
    ],
    next: held
      ? "не обещать выкуп — заказ заморожен"
      : "ничего, если сам справится; кнопка поддержки у него уже есть",
  });
  await Promise.allSettled(ADMIN_IDS.map(id => tgSend(id, text)));
}

/**
 * «Бот упал на сообщении юзера» — алерт админам из глобального catch
 * (VK `message_new` / TG `bot.catch`). Юзер в этот момент получил
 * «⚠️ Произошла ошибка» — админ должен узнать сразу, а не из жалоб
 * (P0 2026-07-06: три юзера VK молча получали ошибку на прямых заказах).
 * Дедуп: одна связка юзер+тип ошибки — не чаще раза в 10 минут.
 */
const botErrorSeen = new Map<string, number>();
const BOT_ERROR_TTL_MS = 10 * 60 * 1000;

/**
 * Где именно упало — первый кадр НАШЕГО стека.
 *
 * 02.09.2026 покупательница получила «Произошла ошибка», а алерт сказал ровно
 * `Code №10 — Internal server error`: это слова VK, а не наш вызов. Логи
 * контейнера к моменту разбора уже уехали вместе с раскаткой, и починить стало
 * нечего — не потому, что баг сложный, а потому что алерт не назвал место.
 *
 * Берём первый кадр из `bots/` или `src/`: библиотечные кадры (vk-io, node)
 * пропускаем — они одинаковы у всех падений и ничего не различают.
 */
function ourStackFrame(err: unknown): string | null {
  const stack = (err as { stack?: unknown } | null)?.stack;
  if (typeof stack !== "string") return null;
  for (const raw of stack.split("\n").slice(1)) {
    const line = raw.trim();
    if (!/[/\\](bots|src)[/\\]/.test(line)) continue;
    if (/node_modules/.test(line)) continue;
    // «at handleMessage (/app/bots/vk/handlers.ts:1904:11)» → «handlers.ts:1904 · handleMessage»
    const m = line.match(/at\s+(?:async\s+)?([^\s(]+)?\s*\(?.*[/\\]([\w.-]+):(\d+):\d+\)?/);
    if (!m) continue;
    const [, fn, file, lineNo] = m;
    return fn && fn !== "<anonymous>" ? `${file}:${lineNo} · ${fn}` : `${file}:${lineNo}`;
  }
  return null;
}

/** Метод внешнего API, если ошибка пришла от него (vk-io кладёт его в `method`). */
function apiMethodOf(err: unknown): string | null {
  const method = (err as { method?: unknown } | null)?.method;
  return typeof method === "string" && method ? method : null;
}

export async function notifyBotError(p: {
  platform: "TG" | "VK";
  userId: string | number;
  err: unknown;
  /** Что юзер прислал, когда упало, — без этого ветку не воспроизвести. */
  input?: string | null;
}): Promise<void> {
  try {
    const firstLine = String((p.err as any)?.message ?? p.err).split("\n")[0].slice(0, 200);
    const key = `ERR:${p.platform}:${p.userId}:${firstLine}`;
    const now = Date.now();
    const last = botErrorSeen.get(key);
    if (last && now - last < BOT_ERROR_TTL_MS) return;
    botErrorSeen.set(key, now);
    if (botErrorSeen.size > 500) {
      for (const [k, t] of botErrorSeen) if (now - t > BOT_ERROR_TTL_MS) botErrorSeen.delete(k);
    }
    const userRef = p.platform === "VK"
      ? `<a href="https://vk.com/id${p.userId}">vk.com/id${p.userId}</a>`
      : `<a href="tg://user?id=${p.userId}">tg://${p.userId}</a>`;
    const time = new Date().toLocaleString("ru-RU", {
      timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit",
    });
    // ❄️ Тот же признак, что и в алертах поддержки: упавший бот у замороженного
    // клиента — это ещё и «сейчас он напишет менеджеру».
    const held = await heldCustomerFor(db, {
      tgId: p.platform === "TG" ? String(p.userId) : null,
      vkId: p.platform === "VK" ? String(p.userId) : null,
    });
    const where = ourStackFrame(p.err);
    const method = apiMethodOf(p.err);
    const input = p.input?.trim()
      ? `💬 Прислал: <i>${escapeHtml(p.input.trim().slice(0, 120))}</i>`
      : null;
    const text = formatAdminNotice({
      marker: "urgent",
      zone: "СИСТЕМА",
      title: `${p.platform}-бот упал на сообщении`,
      lines: [
        `${userRef} · ${time} МСК`,
        held ? `❄️ <b>ЗАМОРОЖЕН:</b> ${escapeHtml(held.reason)}` : null,
        input,
        `<code>${escapeHtml(firstLine)}</code>`,
        // Место падения важнее текста ошибки: текст обычно чужой, место — наше.
        where ? `📍 ${escapeHtml(where)}` : null,
        method ? `🛰 API: <code>${escapeHtml(method)}</code>` : null,
      ],
      next: "юзер получил «Произошла ошибка» — написать ему и проверить ветку",
    });
    await Promise.allSettled(ADMIN_IDS.map((id) => tgSend(id, text)));
  } catch (alertErr) {
    console.error("[admin] notifyBotError failed:", alertErr);
  }
}

/** Comma-separated list of Telegram admin chat IDs from env. */
export const ADMIN_IDS: string[] = (
  [...new Set(
    (process.env.ADMIN_IDS ?? process.env.TG_CHAT_ID ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  )]
);

export interface RetailBuyoutAdminAlert {
  wbCode: string;
  gamepassId: string;
  chargedPrice: number;
  donorName?: string | null;
  balance?: number | null;
}

/** Notify every Telegram admin after a manual bot buyout is confirmed. */
export async function notifyAdminsRetailBuyout(input: RetailBuyoutAdminAlert): Promise<void> {
  const donorLine = input.donorName ? `\nДонор: <b>${escapeHtml(input.donorName)}</b>` : "";
  const balanceLine = Number.isFinite(input.balance)
    ? `\nОстаток: <b>${Number(input.balance).toLocaleString("ru-RU")} R$</b>`
    : "";
  const text = formatAdminNotice({
    marker: "done",
    zone: "ВЫКУП",
    title: "выкуп подтверждён",
    lines: [
      orderRef({ code: input.wbCode }, [`геймпасс <code>${escapeHtml(input.gamepassId)}</code>`]),
      `💸 Списано: <b>${input.chargedPrice.toLocaleString("ru-RU")} R$</b>` + donorLine.replace("\n", " · ") + balanceLine.replace("\n", " · "),
      `📱 Источник: Telegram`,
    ],
    next: null,
  });
  const roots = await orderThreadRoots(db, input.wbCode);
  await Promise.allSettled(ADMIN_IDS.map((id) =>
    tgSend(id, text, { parse_mode: "HTML", ...replyToRoot(roots, id) })));
}

// ── Unified user-handle formatting ─────────────────────────────────────────────

/** Minimal shape needed by {@link formatUserHandle}. */
export interface UserHandleSource {
  tgId?:     string | null;
  vkId?:     string | null;
  username?: string | null;
  name?:     string | null;
}

/**
 * Build the canonical user label for admin cards.
 *
 * TG priority:  `@username` (clickable) → display name → `tg:<id>`
 * VK priority:  display name → `vk:<id>`
 *
 * Returns plain text — caller wraps in HTML link as needed.
 */
export function formatUserHandle(u: UserHandleSource): string {
  // Display names are user-controlled and every current call site embeds the
  // result into an HTML message — escape here so a name like "<Вадим>" can't
  // break the Telegram card. @usernames are [A-Za-z0-9_] and need no escaping.
  if (u.tgId) {
    if (u.username) return `@${u.username}`;
    return u.name ? escapeHtml(u.name) : `tg:${u.tgId}`;
  }
  if (u.vkId) {
    return u.name ? escapeHtml(u.name) : `vk:${u.vkId}`;
  }
  return u.name ? escapeHtml(u.name) : "Неизвестен";
}

/**
 * Same as {@link formatUserHandle} but wrapped in an HTML link to the user's profile.
 * Suitable for HTML-formatted admin messages.
 */
export function formatUserHandleHtml(u: UserHandleSource): string {
  const label = formatUserHandle(u);
  if (u.tgId) {
    // @username links work natively in Telegram even without an explicit <a>,
    // but wrapping in tg://user?id=... gives a deterministic profile link
    // that works even if the handle is unavailable.
    if (u.username) return `<a href="https://t.me/${u.username}">${label}</a>`;
    return `<a href="tg://user?id=${u.tgId}">${label}</a>`;
  }
  if (u.vkId) {
    return `<a href="https://vk.com/id${u.vkId}">${label}</a>`;
  }
  return label;
}

// ── callback_data constants (≤ 64 bytes guaranteed with CUID ~25 chars) ────────
export const CB = {
  adminOk:    (orderId: string) => `admin_ok:${orderId}`,   // 34 b
  adminErr:   (orderId: string) => `admin_reject_init:${orderId}`,  // 43 b
  purchaseScript: (orderId: string) => `ps:${orderId}`,            // 28 b
  purchaseBuy:    (orderId: string) => `pb:${orderId}`,            // 28 b
  reviewOk:   (orderId: string, userId: string) => `review_ok:${orderId}:${userId}`, // 61 b
  reviewNo:   (orderId: string, userId: string) => `review_no:${orderId}:${userId}`, // 61 b

  // Safety confirmation steps
  // Shortened to fit Telegram's 64-byte callback_data limit (CUID×2 = 50 bytes used).
  // confirm_rev_no: was 66 b, cancel_rev_no: was 65 b — both exceeded the limit.
  confirmReviewReject: (orderId: string, userId: string) => `crn:${orderId}:${userId}`,
  cancelReviewReject:  (orderId: string, userId: string) => `xrn:${orderId}:${userId}`,

  // Preset review rejection reasons (encoded as short keys)
  // rev_reason: was 69 b max — shortened to rr: (61 b max with "notpub" key).
  reviewRejectReason: (orderId: string, userId: string, key: string) =>
    `rr:${orderId}:${userId}:${key}`,

  // Preset order rejection reasons — ord_rr:{orderId}:{key} (≤ 43 b with CUID + 8-char key)
  orderRejectReason:  (orderId: string, key: string) => `ord_rr:${orderId}:${key}`,
  // "type custom reason" → enter free-text mode
  orderRejectCustom:  (orderId: string) => `ord_rr_txt:${orderId}`,

  // ── Hub navigation ─────────────────────────────────────────────────────────
  hubStats:        "hub_stats",
  hubWildberries:  "hub_wb",
  hubSystem:       "hub_sys",

  // ── Orders hub ─────────────────────────────────────────────────────────────
  ordersActive:    "ord_active",
  ordersSearch:    "ord_search",
  ordersHistory:   "ord_hist",
  ordersRejected:  "ord_rej",
  ordersBatch:     "ord_batch",
  ordersBatchConfirm: "ord_batch_ok",
  orderTakeWork:   (id: string) => `ord_work:${id}`,
  orderView:       (id: string) => `admin_view:${id}`,
  ordersBack:      "ord_back",

  // ── Stats hub ──────────────────────────────────────────────────────────────
  statsChangeRate: "stat_rate",
  statsRefresh:    "stat_refresh",

  // ── WB hub ─────────────────────────────────────────────────────────────────
  wbAddCodes:      "wb_add",
  wbAddDenom:      (d: number) => `wb_denom:${d}`,
  wbAnalytics:     "wb_analytics",
  wbAnalyticsPeriod: (p: string) => `wb_stat_p:${p}`,
  wbProducts:      "wb_prods",
  wbRecentOrders:  "wb_recent",
  wbEditPrice:     (nmID: number) => `wb_edit_p:${nmID}`,
  wbDownload:      "wb_download",
  wbRefresh:       "wb_refresh",
  wbStocks:        "wb_stocks",
  wbDynamics:      "wb_dynamics",
  wbUnitEcon:      "wb_unit_econ",
  wbReviews:       "wb_reviews",
  wbAnswerReview:  (id: string) => `wb_ans_r:${id}`,
  wbAnswerQuestion: (id: string) => `wb_ans_q:${id}`,
  wbFbs:           "wb_fbs",
  wbEditAd:        (nmID: number) => `wb_ad:${nmID}`,
  wbEditDenom:     (nmID: number) => `wb_denom_ue:${nmID}`,
  wbUeSettings:    "wb_ue_settings",
  wbCalcWhatIf:    "wb_calc_whatif",
  wbUeKursRb:      "wb_ue_kurs_rb",
  wbUeKursUsd:     "wb_ue_kurs_usd",
  wbUeFixedCost:   "wb_ue_fixed",
  wbRealization:       "wb_realiz",
  wbRealizPeriod:      (p: string) => `wb_realiz_p:${p}`,
  wbAdvert:            "wb_advert",
  wbAdvertRefresh:     "wb_advert_refresh",

  // ── System hub ─────────────────────────────────────────────────────────────
  sysLogs:            (name: string) => `sys_log:${name}`,
  sysRestart:         (name: string) => `sys_rst:${name}`,
  sysConfirmRestart:  (name: string) => `sys_crst:${name}`,
  sysRefresh:         "sys_refresh",

  // ── Rates hub ──────────────────────────────────────────────────────────────
  hubRates:        "hub_rates",
  ratesRefresh:    "rates_refresh",
  ratesAnalytics:  "rates_analytics",

  // ── AutoBuy hub ────────────────────────────────────────────────────────────
  hubAutoBuy:      "hub_autobuy",
  autoBuyToggle:   "ab_toggle",
  autoBuySetRate:  "ab_set_rate",
  autoBuyRefresh:  "ab_refresh",

  // ── Boss Robux (inside AutoBuy hub) ────────────────────────────────────────
  bossrobuxSearch:  "br_search",
  bossrobuxBuy:     (i: number) => `br_buy:${i}`,    // ≤ 10 b
  bossrobuxConfirm: (i: number) => `br_ok:${i}`,     // ≤ 9 b

  // ── Direct order ──────────────────────────────────────────────────────────
  startDirect:         "start_direct",
  confirmDirect:       "confirm_direct",
  confirmDirectNb:     "confirm_direct_nb",
  cancelDirect:        "cancel_direct",
  customDirect:        "dp:custom",
  directCatalog:       "dp:all",   // «📋 Все паки» — раскрыть полный каталог (PLAN +5.C)
  directCompact:       "dp:back",  // «◀️ Назад» из каталога к компактному шагу 1
  directPack:          (amount: number) => `dp:${amount}`,                                // 8 b max
  sendPaymentDetails:  (orderId: string) => `spd:${orderId}`,                             // 29 b
  sendQr:              (orderId: string) => `sqr:${orderId}`,                             // 29 b
  cancelDirectOrder:   (orderId: string) => `cdo:${orderId}`,                             // 29 b
  userCancelDirect:    (orderId: string) => `ucd:${orderId}`,                             // 29 b
  paymentOk:           (orderId: string, userId: string) => `pay_ok:${orderId}:${userId}`, // 59 b
  paymentNo:           (orderId: string, userId: string) => `pay_no:${orderId}:${userId}`, // 59 b

  // ── Direct intent (new pre-order flow) ─────────────────────────────────
  sendIntentQr:       (id: string) => `sqi:${id}`,              // ≤29 b
  sendIntentDetails:  (id: string) => `spi:${id}`,              // ≤29 b
  cancelIntent:       (id: string) => `cai:${id}`,              // ≤29 b
  userCancelIntent:   (id: string) => `uci:${id}`,              // ≤29 b
  directNickOk:       "dir_nick_ok",                             // 11 b
  directNickNew:      "dir_nick_new",                            // 12 b
  directGpPick:       (passId: string) => `dgp:${passId}`,      // ≤16 b
  directSubmit:       "dir_submit",                              // 10 b
  directPaySite:      (id: string) => `dps:${id}`,
  directPayBank:      (id: string) => `dpb:${id}`,
  directPayManual:    (id: string) => `dpm:${id}`,
  directCancel:       "dir_cancel",                              // 10 b
  directBack:         "dir_back",                                // 8 b
  editNick:           "edit_nick",                               // 9 b

  // User actions
  refreshStatus: "refresh_status",
  /** Покупатель с несколькими активными заказами выбирает, с каким работает.
   * Код 7 символов → ≤11 b. */
  orderPick:     (wbCode: string) => `ord:${wbCode}`,
  /** Вернуться к списку своих активных заказов. */
  ordersList:    "orders_list",
  reviewHint:    "review_hint",
  buyerMenu:     "menu",                                     // buyer mini-profile hub

  // ── Gamepass search by Roblox nick (item 7) ──────────────────────────────
  // Client flow: user clicks "find by nick" → bot asks for nick → user types
  // it → bot lists matches as inline buttons. Pass IDs are numeric strings
  // up to ~12 digits, well under the 64-byte callback limit.
  findGpStart:   "find_gp",                                  // 7 b
  findGpRetry:   "find_gp_retry",                            // 13 b
  findGpSaved:   "find_gp_saved",                            // 13 b
  // Запасной вход, когда поиск по нику ничего не нашёл: покупатель присылает
  // ссылку (или ID) самого геймпасса. Ставит pendingLink и ждёт текст.
  sendGpLink:    "send_gp_link",                             // 12 b
  // Гейт подписки: «✅ Я подписался — продолжить» (фолбэк, если chat_member
  // не пришёл или юзер подписался раньше, чем нажал ссылку) — PLAN +5.D.
  subRecheck:    "sub_recheck",                              // 11 b
  gpPick:        (passId: string) => `gp_pick:${passId}`,    // ≤ 22 b
  // "change my Roblox nick / gamepass" on an already-placed order (передумал)
  changeNick:    "change_nick",                              // 11 b

  // ── Support button tap (replaces the prior URL button so we can detect
  // *real* taps and fire the full SOS only then; show-time fires a much
  // smaller "user hurdle" heads-up instead). Suffix is the context key —
  // ctxKey alphabet is `[a-z_]+`, never close to the 64-byte limit. ──
  supTap:        (ctxKey: string) => `sup:${ctxKey}`,        // ≤ 30 b

  // ── FAQ / self-service (replaces support in the first 24h) ──
  faq:           "faq",                                       // 3 b
  faqItem:       (key: string) => `fq:${key}`,               // ≤ 20 b
} as const;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OrderCardPayload {
  id:                  string;
  amount:              number;
  gamepassUrl:         string;
  platform:            "TG" | "VK";
  /** `WbOrder.orderSource`; resolved from the code when the caller omits it. */
  orderSource?:        string | null;
  wbCode:              string;
  userDisplay:         string; // e.g. "@username" or "VK: https://vk.com/id123"
  createdAt?:          Date;
  bonusApplied?:       number;
  /** Number of WbOrders placed BEFORE this one. Used to render loyalty badge. */
  previousOrderCount?: number;
  /** Roblox username of the gamepass creator, as returned by the validation API. */
  creatorName?:        string;
  /** true when the gamepass is in an 18+ age-restricted game. */
  isAgeRestricted?:    boolean;
  /** true when the customer picked this gamepass via the website nick-search (one-tap). */
  viaWebOneTap?:       boolean;
  /** true when the customer pasted the gamepass link/ID because the nick search found nothing. */
  viaManualLink?:      boolean;
  /** Old gamepassUrl when the user swapped the pass on an already-queued order (🔁 marker). */
  replacedGamepassUrl?: string;
}

export interface ReviewCardPayload {
  orderId:     string;
  userId:      string;   // DB User.id
  photoSource: string;   // Telegram file_id OR public HTTPS URL (VK photo)
  userDisplay: string;
}

export interface DirectOrderCardPayload {
  orderId:            string;
  userId:             string;   // DB User.id
  amount:             number;   // total Robux (incl. bonus)
  bonusApplied:       number;
  userDisplay:        string;
  tgId?:              string;   // optional — not set for VK users
  createdAt:          Date;
  previousOrdersCount?: number;
}

export interface DirectIntentCardPayload {
  intentId:             string;
  userId:               string;
  amount:               number;
  bonus:                number;
  totalAmount:          number;
  rublePrice:           number;
  robloxUsername:        string;
  gamepassUrl:          string;
  gamepassName?:        string;
  /** Actual price of the picked gamepass — may differ from ceil(totalAmount/0.7). */
  gamepassRobux?:       number;
  userDisplay:          string;
  tgId?:                string;
  platform:             "TG" | "VK";
  createdAt:            Date;
  previousOrdersCount?: number;
}

export interface PaymentScreenshotCardPayload {
  orderId:     string;
  userId:      string;
  photoFileId: string;
  userDisplay: string;
  amount?:     number;
}

// ── Senders ───────────────────────────────────────────────────────────────────

/**
 * Broadcast a new-order card to all Telegram admins.
 * Each admin gets an independent message with [✅ ВЫКУПЛЕНО] / [❌ ОШИБКА] buttons.
 */
export async function sendAdminOrderCard(order: OrderCardPayload): Promise<void> {
  // Одним запросом: откуда продажа, номер заказа на WB и id живой карточки DBS
  // у каждого админа. Номер WB нужен шапке, id карточки — ветке: без них
  // карточка выкупа выглядела отдельным делом, хотя это тот же самый заказ.
  const wbRef = await resolveWbOrderRef(db, order.wbCode);
  // У DBS-заказа корень ветки — живая карточка; у обычного WB-заказа её нет, и
  // корнем становится карточка активации кода («⌛ Ожидаем ссылку»).
  const threadRoots = wbRef.cardMessages ? null : await orderCardRoots(db, order.wbCode);
  const orderSource = order.orderSource ?? wbRef.source;
  const passPrice = Math.ceil(order.amount / 0.7);

  const dateStr = order.createdAt 
    ? new Date(order.createdAt).toLocaleString("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) + " МСК" 
    : new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) + " МСК";
  const age = formatOrderAge(order.createdAt ?? new Date());

  const platformEmojis: Record<string, string> = { TG: "📱", VK: "📘", WEB: "🌐" };
  const platformEmoji = platformEmojis[order.platform] || "📦";

  const bonusLine = order.bonusApplied && order.bonusApplied > 0
    ? `🎁 Использован бонус: <b>${order.bonusApplied} R$</b>\n`
    : "";

  const prev = order.previousOrderCount ?? 0;
  const loyaltyLine =
    prev >= 5 ? `👑 <b>VIP КЛИЕНТ (${prev} заказов)</b>\n` :
    prev >= 1 ? `🔄 <b>ПОВТОРНЫЙ КЛИЕНТ</b>\n`              :
    "";

  const creatorLine    = order.creatorName    ? `🎮 Создатель ГП: <b>${escapeHtml(order.creatorName)}</b>\n`  : "";
  const ageRestrictLine = order.isAgeRestricted ? `🔞 <b>Игра 18+ — выкуп вручную</b>\n`           : "";

  const webOneTapLine = order.viaWebOneTap ? `🌐 <b>ONE-TAP С САЙТА</b>\n` : "";
  // Поиск по нику пасс не увидел, покупатель прислал ссылку сам — почти всегда
  // это скрытый плейс. Заказ штатный, но менеджеру стоит глянуть глазами.
  const manualLinkLine = order.viaManualLink
    ? `🔗 <b>ССЫЛКА ВРУЧНУЮ</b> — поиск по нику не нашёл геймпасс\n`
    : "";

  // The user swapped the pass on an already-queued order — not a new order.
  const replacedLine = order.replacedGamepassUrl
    ? (() => {
        const m = order.replacedGamepassUrl!.match(/game-pass(?:es)?\/(\d+)/);
        return `🔁 <b>ЗАМЕНА ГЕЙМПАССА</b>${m ? ` (было: <code>${m[1]}</code>)` : ""}\n`;
      })()
    : "";

  // Единая шапка: тот же значок срочности, та же зона и тот же порядок ключей,
  // что во всех остальных сообщениях админам. Заказ, готовый к выкупу, — это
  // ручное действие, поэтому «action», а не «progress».
  const passIdLine = (() => {
    const m = order.gamepassUrl.match(/game-pass(?:es)?\/(\d+)/);
    return m ? `🎫 Pass ID: <code>${m[1]}</code>` : null;
  })();

  const text = formatAdminNotice({
    marker: order.isAgeRestricted ? "urgent" : "action",
    zone: orderSource === "WB_DBS" ? "DBS" : orderSource === "DIRECT" ? "ПРЯМОЙ" : "WB",
    title: order.replacedGamepassUrl ? "заменён геймпасс" : "заказ ждёт выкупа",
    lines: [
      orderRef({
        wbOrderId: wbRef.wbOrderId,
        code: order.wbCode,
        denomination: order.amount,
        buyerName: null,
      }, [`геймпасс ${passPrice} R$`]),
      // Плашки-исключения идут ДО полей: они меняют то, как читать всё ниже.
      replacedLine.trim() || null,
      webOneTapLine.trim() || null,
      manualLinkLine.trim() || null,
      loyaltyLine.trim() || null,
      ageRestrictLine.trim() || null,
      `${platformEmoji} Источник: <b>${wbOrderSourceLabel(order.platform, orderSource)}</b>`,
      `👤 Юзер: ${order.userDisplay}`,
      creatorLine.trim() || null,
      bonusLine.trim() || null,
      `📅 Время: <b>${dateStr}</b>`,
      // Возраст — отдельной строкой: у недельного заказа это и есть тревога.
      `⏳ Возраст заказа: <b>${age}</b>`,
      `🔗 <a href="${order.gamepassUrl}">Открыть Gamepass</a>`,
      passIdLine,
    ],
    next: order.isAgeRestricted
      ? "игра 18+ — выкупать только вручную"
      : "скопировать Pass ID, купить в доноре и нажать «ВЫКУПЛЕНО»",
  });

  // One-tap deep-link into the TWA Orders screen, prefocused on this order
  // (?q=<код> — TWA search matches wbCode). web_app inline buttons launch the
  // Web App in personal chats with the given URL — no Direct Link app name needed.
  // U1: ссылка запуска подписывается персонально под каждого админа, поэтому
  // клавиатура строится в цикле, а не один раз на всех.
  const reply_markup = (adminId: string) => ({
    inline_keyboard: [
      [
        { text: "✅ ВЫКУПЛЕНО", callback_data: CB.adminOk(order.id)  },
        { text: "❌ ОШИБКА",    callback_data: CB.adminErr(order.id) },
      ],
      [
        { text: "🛒 Выкупить",      callback_data: CB.purchaseBuy(order.id) },
        { text: "📋 Скрипт",        callback_data: CB.purchaseScript(order.id) },
        { text: "📊 Дашборд",       web_app: { url: twaLaunchUrl(adminId, { q: order.wbCode }) } },
      ],
    ],
  });

  // Ответ на живую карточку DBS: Telegram рисует цитату сверху, и карточка
  // выкупа читается как продолжение того же заказа, а не как новое дело.
  // `allow_sending_without_reply` — карточку могли удалить или переслать заново.
  await Promise.allSettled(
    ADMIN_IDS.map((id) => {
      const rootId = wbRef.cardMessages?.[id] ?? threadRoots?.[id];
      return tgSend(id, text, {
        reply_markup: reply_markup(id),
        ...(rootId ? { reply_to_message_id: rootId, allow_sending_without_reply: true } : {}),
      });
    })
  );

  // Живая карточка DBS обязана догнать заказ: ссылка получена — значит её
  // заголовок больше не «покупатель активирует код в боте».
  if (wbRef.source === "WB_DBS") await refreshDbsCardByCode(db, order.wbCode);
}

/**
 * Notify all admins about a new direct order (no WB card).
 * Admin can send payment details or cancel the order.
 */
export async function sendAdminDirectOrderCard(payload: DirectOrderCardPayload): Promise<void> {
  const code = await orderCode(payload.orderId);
  const dateStr = new Date(payload.createdAt).toLocaleString("ru-RU", {
    timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit",
    year: "numeric", hour: "2-digit", minute: "2-digit",
  }) + " МСК";
  const bonusLine = payload.bonusApplied > 0
    ? `🎁 Бонус учтён: <b>+${payload.bonusApplied} R$</b>\n`
    : "";

  const prev = payload.previousOrdersCount ?? 0;
  const loyaltyLine =
    prev >= 5 ? `👑 <b>VIP КЛИЕНТ (${prev} заказов)</b>\n` :
    prev >= 1 ? `🔄 <b>ПОВТОРНЫЙ КЛИЕНТ (${prev} заказ${prev === 1 ? "" : prev < 5 ? "а" : "ов"})</b>\n` :
    `🆕 <b>НОВЫЙ КЛИЕНТ</b>\n`;

  const paidRobux = payload.amount - payload.bonusApplied;
  const rublePrice = directPrice(paidRobux);

  const text = formatAdminNotice({
    marker: "action",
    zone: "ПРЯМОЙ",
    title: "новый заказ — ждёт реквизиты",
    lines: [
      orderRef({ code, denomination: payload.amount }, [`геймпасс ${Math.ceil(payload.amount / 0.7)} R$`]),
      loyaltyLine.trim() || null,
      `👤 Юзер: ${payload.userDisplay}`,
      bonusLine.trim() || null,
      `💰 К оплате: <b>${rublePrice} ₽</b>`,
      `📅 ${dateStr}`,
    ],
    next: "отправить QR или реквизиты кнопкой ниже",
  });

  const twaQuery = { q: code ?? payload.orderId.slice(-6) };
  const reply_markup = (adminId: string) => ({
    inline_keyboard: [
      [
        { text: "📷 Отправить QR (СБП)", callback_data: CB.sendQr(payload.orderId) },
      ],
      [
        { text: "💳 Реквизиты текстом", callback_data: CB.sendPaymentDetails(payload.orderId) },
        { text: "❌ Отменить заказ",     callback_data: CB.cancelDirectOrder(payload.orderId) },
      ],
      [
        { text: "📊 Открыть в дашборде", web_app: { url: twaLaunchUrl(adminId, twaQuery) } },
      ],
    ],
  });

  await Promise.allSettled(
    ADMIN_IDS.map((id) => tgSend(id, text, { reply_markup: reply_markup(id) }))
  );
}

/**
 * Notify all admins about a new direct intent (pre-order).
 * Admin can send QR / payment details or reject.
 */
export async function sendAdminIntentCard(payload: DirectIntentCardPayload): Promise<void> {
  const dateStr = new Date(payload.createdAt).toLocaleString("ru-RU", {
    timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit",
    year: "numeric", hour: "2-digit", minute: "2-digit",
  }) + " МСК";
  const bonusLine = payload.bonus > 0
    ? `🎁 Бонус: <b>+${payload.bonus} R$</b>\n`
    : "";

  const prev = payload.previousOrdersCount ?? 0;
  const loyaltyLine =
    prev >= 5 ? `👑 <b>VIP КЛИЕНТ (${prev} заказов)</b>\n` :
    prev >= 1 ? `🔄 <b>ПОВТОРНЫЙ КЛИЕНТ (${prev} заказ${prev === 1 ? "" : prev < 5 ? "а" : "ов"})</b>\n` :
    `🆕 <b>НОВЫЙ КЛИЕНТ</b>\n`;

  const expectedPassPrice = Math.ceil(payload.totalAmount / 0.7);
  // Show the ACTUAL picked gamepass price; the flow allows picking a pass with a
  // "wrong" price, and the manager must see the mismatch before sending реквизиты.
  const actualPassPrice = payload.gamepassRobux ?? expectedPassPrice;
  const priceMismatch = Math.abs(actualPassPrice - expectedPassPrice) > 2
    ? ` ⚠️ <b>ожидалось ${expectedPassPrice} R$</b>`
    : "";
  const gpName = payload.gamepassName ? ` · "${escapeHtml(payload.gamepassName)}"` : "";

  // Заявка (intent) кода не имеет — идентификатор для менеджера: ник + сумма.
  const text = formatAdminNotice({
    // Цена пасса разошлась с номиналом — это уже не рутина: отправив реквизиты,
    // мы согласимся выкупить не то, за что человек заплатит.
    marker: priceMismatch ? "urgent" : "action",
    zone: "ПРЯМОЙ",
    title: "заявка — ждёт реквизиты",
    lines: [
      orderRef({ denomination: payload.totalAmount }, [escapeHtml(payload.robloxUsername)]),
      loyaltyLine.trim() || null,
      `👤 Юзер: ${payload.userDisplay}`,
      bonusLine.trim() || null,
      `🎫 Геймпасс: <b>${actualPassPrice} R$</b>${priceMismatch}${gpName}`,
      `🔗 <a href="${payload.gamepassUrl}">Открыть Gamepass</a>`,
      `💰 К оплате: <b>${payload.rublePrice} ₽</b>`,
      `📅 ${dateStr}`,
    ],
    next: priceMismatch
      ? "цена пасса не сходится с номиналом — разобраться ДО отправки реквизитов"
      : "отправить QR или реквизиты кнопкой ниже",
  });

  const reply_markup = {
    inline_keyboard: [
      [
        { text: "📷 QR (СБП)", callback_data: CB.sendIntentQr(payload.intentId) },
      ],
      [
        { text: "💳 Реквизиты", callback_data: CB.sendIntentDetails(payload.intentId) },
        { text: "❌ Отклонить",  callback_data: CB.cancelIntent(payload.intentId) },
      ],
    ],
  };

  await Promise.allSettled(
    ADMIN_IDS.map((id) => tgSend(id, text, { reply_markup }))
  );
}

/**
 * Разослать админам карточку со скриншотом — и знать, дошла ли она.
 *
 * Общий отправитель для карточек отзыва и оплаты: обе рассылались через
 * `Promise.allSettled` без разбора результатов, то есть «успешно» при любом
 * исходе, включая полный провал. Скриншот оплаты потерять дороже, чем отзыв:
 * человек уже заплатил, и его заказ просто зависает.
 *
 * Фолбэк текстом обязателен: Telegram не всегда может забрать фото по ссылке
 * (истёкший URL VK CDN), и тогда карточка уходит текстом **с теми же
 * кнопками** — решение принимается нажатием на них.
 *
 * Возвращает число админов, до которых дошло.
 */
async function broadcastPhotoCard(
  photo: string,
  caption: string,
  reply_markup: unknown,
  what: string,
  /** Корень ветки заказа: скрин оплаты и скрин отзыва — тоже шаги ОДНОГО
   *  заказа, а не отдельные дела с собственной перепиской. */
  roots?: Record<string, number> | null,
): Promise<number> {
  const results = await Promise.all(
    ADMIN_IDS.map(async (id) => {
      const thread = replyToRoot(roots, id);
      if (await tgSendPhoto(id, photo, caption, { reply_markup, ...thread })) return true;
      try {
        // URL экранируем: в ссылках VK CDN есть `&`, и на нём Telegram роняет
        // разбор HTML целиком — фолбэк молча повторил бы исходную поломку.
        const sent = await tgSend(
          id,
          `${caption}\n\n⚠️ Фото не удалось приложить — открой по ссылке:\n${escapeHtml(photo)}`,
          { reply_markup, ...thread },
        );
        return sent?.ok === true;
      } catch (err) {
        console.warn(`[admin] текстовый фолбэк (${what}) не ушёл:`, err instanceof Error ? err.message : err);
        return false;
      }
    }),
  );
  const delivered = results.filter(Boolean).length;
  if (delivered < ADMIN_IDS.length) {
    console.warn(`[admin] карточка «${what}» дошла до ${delivered}/${ADMIN_IDS.length} админов`);
  }
  return delivered;
}

/**
 * Send a payment screenshot card to all admins for confirmation.
 *
 * Бросает, если не дошло ни до кого: клиент уже заплатил, и молча потерянный
 * скриншот оставляет его заказ висеть без объяснений.
 */
export async function sendAdminPaymentCard(payload: PaymentScreenshotCardPayload): Promise<void> {
  const code = await orderCode(payload.orderId);
  const caption = formatAdminNotice({
    marker: "action",
    zone: "ПРЯМОЙ",
    title: "скриншот оплаты",
    lines: [
      orderRef({ code, denomination: payload.amount ?? null }, [payload.userDisplay]),
    ],
    next: "сверить сумму и нажать «Оплата принята»",
  });

  const reply_markup = {
    inline_keyboard: [[
      { text: "✅ Оплата принята", callback_data: CB.paymentOk(payload.orderId, payload.userId) },
      { text: "❌ Отклонить",      callback_data: CB.paymentNo(payload.orderId, payload.userId) },
    ]],
  };

  const delivered = await broadcastPhotoCard(
    payload.photoFileId, caption, reply_markup, "скрин оплаты",
    await orderThreadRoots(db, code),
  );
  if (delivered === 0) {
    throw new Error(`payment card undelivered: 0/${ADMIN_IDS.length} admins`);
  }
}

/**
 * Broadcast a review-screenshot card to all Telegram admins.
 * Admin chooses [🎁 Начислить +100 R$] or [❌ Отклонить].
 */
/**
 * Карточка отзыва админам. Бросает, если не дошла НИ ДО КОГО.
 *
 * Раньше здесь стоял `Promise.allSettled` без разбора результатов — он не
 * отклоняется никогда, поэтому `catch` у вызывающего был мёртвым кодом, а
 * `tgSendPhoto` вдобавок не смотрел на ответ Telegram. Разбор 28.08:
 * покупательница получила «✅ Отзыв получен», админам не ушло ничего, в логах
 * пусто, бонус +100 R$ ей никто не начислил. Отзыв — это деньги клиенту, и
 * потерять его молча нельзя.
 *
 * Фолбэк встроен здесь, а не у вызывающего: Telegram регулярно не может забрать
 * фото по чужой ссылке (истёкший URL VK CDN), и тогда карточка обязана уйти
 * текстом — **с теми же кнопками**, потому что начисление бонуса делается
 * нажатием на них. Голое текстовое предупреждение без кнопок превращает
 * начисление в ручную работу.
 */
/** След в заказе о непойманном отзыве — читается глазами в карточке TWA. */
async function stampUndeliveredReview(payload: ReviewCardPayload): Promise<void> {
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  const line = `[ОТЗЫВ-НЕ-ДОШЁЛ ${stamp}] ${payload.userDisplay} прислал скрин, карточка админам не ушла. Фото: ${payload.photoSource}`;
  const order = await (db as any).wbOrder.findUnique({
    where: { id: payload.orderId },
    select: { adminNote: true },
  });
  if (!order) return;
  await (db as any).wbOrder.update({
    where: { id: payload.orderId },
    data: { adminNote: ((order.adminNote ? order.adminNote + "\n" : "") + line).slice(0, 2000) },
  });
}

export async function sendAdminReviewCard(payload: ReviewCardPayload): Promise<void> {
  const code = await orderCode(payload.orderId);
  const caption = formatAdminNotice({
    marker: "action",
    zone: "ОТЗЫВ",
    title: "скриншот отзыва",
    lines: [orderRef({ code }, [payload.userDisplay])],
    next: "проверить скрин и начислить +100 R$",
  });

  const reply_markup = {
    inline_keyboard: [[
      { text: "🎁 Начислить +100 R$", callback_data: CB.reviewOk(payload.orderId, payload.userId) },
      { text: "❌ Отклонить",         callback_data: CB.reviewNo(payload.orderId, payload.userId) },
    ]],
  };

  const delivered = await broadcastPhotoCard(
    payload.photoSource, caption, reply_markup, "скрин отзыва",
    await orderThreadRoots(db, code),
  );
  if (delivered === 0) {
    // Последний рубеж: Telegram может быть недоступен целиком, и тогда любое
    // уведомление бессмысленно. След в заказе переживёт это — по нему отзыв
    // найдут и начислят бонус вручную (`scripts/credit-review-bonus.mjs`).
    await stampUndeliveredReview(payload).catch((err) =>
      console.error("[admin] не удалось записать след о потерянном отзыве:", err));
    throw new Error(`review card undelivered: 0/${ADMIN_IDS.length} admins`);
  }
}
