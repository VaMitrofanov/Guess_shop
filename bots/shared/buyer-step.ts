/**
 * Шаг геймпасса покупателя: что он прислал и что мы у него просим.
 *
 * Жалоба поддержки 20.10.2026: человек ткнул не туда, пропустил шаг или
 * бот перезапустился, и дальше он «не может воткнуть ссылку или ключ».
 * Поддержка всё объяснила словами, а где в боте нужная кнопка, человек не
 * находит. Корень один: бот понимал ввод, только пока помнил, какой шаг
 * идёт, а помнил он это в оперативной памяти (`pending*` в `tg/session.ts`).
 *
 * Отсюда три вещи, общие для обоих ботов и админки:
 *
 * 1. `classifyBuyerInput` — что прислано, БЕЗ знания текущего шага. Ссылку
 *    на пасс, ключ и ссылку на игру ни с чем другим не спутать, поэтому бот
 *    принимает их на любом шаге, а заказ берёт из базы.
 * 2. `buyerStepMessage` — сообщение, которым админка просит у покупателя
 *    нужный шаг («📨 Попросить у покупателя»). Кнопки в нём ведут в те же
 *    обработчики, что и кнопки самих ботов, а ответ принимается и без кнопки
 *    — пункт 1.
 * 3. События заказа: «шаг отправлен» и «бот не понял покупателя». Пишутся в
 *    `OrderEvent` (миграция не нужна) и видны в карточке заказа.
 *
 * Модуль без зависимостей от Roblox и Prisma: его читает и Web (`src/`).
 */

import { parseGamepassUrl } from "./gamepass-id";
import { parseExperienceRef } from "./roblox-owned-games";

/* ── 1. Что прислал покупатель ─────────────────────────────────────────── */

export type BuyerInput =
  | { kind: "gamepass"; passId: string }
  | { kind: "api_key" }
  | { kind: "game" }
  | { kind: "other" };

/** Ключи Open Cloud — от 40 символов (тот же порог, что у приёма поддержки). */
const STRAY_KEY_MIN = 40;
const STRAY_KEY_MAX = 4096;
/** Адрес без `https://` («roblox.com/users/1/profile») — не ключ. */
const DOMAIN_RE = /(^|[^A-Za-z0-9])[a-z0-9-]+\.(com|ru|net|org|gg|io|me|su|рф)(\/|$)/i;

/**
 * Ключ, присланный ВНЕ шага ключа.
 *
 * Строже, чем `looksLikeApiKey`: там бот ключа ЖДЁТ, и ошибка стоит одного
 * лишнего «не похоже на ключ». Здесь он ждёт что угодно, и ложное «это ключ»
 * удалило бы обычное сообщение человека. Поэтому порог длины выше, а ссылки
 * и адреса без схемы отсекаются явно.
 */
export function looksLikeStrayApiKey(raw: string): boolean {
  const value = raw.trim();
  if (value.length < STRAY_KEY_MIN || value.length > STRAY_KEY_MAX) return false;
  if (/\s/.test(value)) return false;
  if (/^https?:\/\//i.test(value) || DOMAIN_RE.test(value)) return false;
  if (!/^[\x21-\x7E]+$/.test(value)) return false;
  // Хоть одна буква и хоть одна цифра: «!!!!!!…» и «ааааа…» — не ключ.
  return /[A-Za-z]/.test(value) && /\d/.test(value);
}

/**
 * Что это за сообщение — независимо от того, какой шаг бот сейчас помнит.
 *
 * Голое число здесь НЕ пасс: в шаге ника чисто цифровой ник Roblox законен.
 * Голый Pass ID принимают ветки, которые знают, что ждут пасс.
 */
export function classifyBuyerInput(raw: string): BuyerInput {
  const value = raw.trim();
  const passId = parseGamepassUrl(value);
  if (passId) return { kind: "gamepass", passId };
  if (parseExperienceRef(value)) return { kind: "game" };
  if (looksLikeStrayApiKey(value)) return { kind: "api_key" };
  return { kind: "other" };
}

/* ── 2. Что админка просит у покупателя ───────────────────────────────── */

export type BuyerStepKind = "nick" | "link" | "key" | "create" | "custom";

export interface BuyerStepOption {
  kind: BuyerStepKind;
  icon: string;
  /** Имя в меню админки. */
  label: string;
  /** Что получит покупатель — подсказка под именем. */
  hint: string;
}

/** Порядок = порядок в меню админки (TWA и сайт). */
export const BUYER_STEP_OPTIONS: readonly BuyerStepOption[] = [
  { kind: "link", icon: "🔗", label: "Прислать ссылку или Pass ID", hint: "пасс уже создан — пусть пришлёт его" },
  { kind: "key", icon: "🔑", label: "Прислать ключ", hint: "создадим пасс сами — ссылка на шаги с картинками" },
  { kind: "nick", icon: "🔎", label: "Прислать ник Roblox", hint: "посмотрим аккаунт и соберём заказ" },
  { kind: "create", icon: "📖", label: "Создать пасс по инструкции", hint: "личная инструкция с его кодом" },
  { kind: "custom", icon: "✍️", label: "Свой текст", hint: "ваши слова + кнопки инструкции и ссылки" },
] as const;

export function isBuyerStepKind(value: unknown): value is BuyerStepKind {
  return BUYER_STEP_OPTIONS.some((option) => option.kind === value);
}

/**
 * Кнопка сообщения. `action` — ОБРАБОТЧИК бота, а не строка платформы:
 * у TG и VK разные строки для одного действия (`find_gp` / `find_gp_start`),
 * и переводит их отправитель (`BUYER_STEP_COMMANDS`).
 */
export type BuyerStepButton =
  | { label: string; url: string }
  | { label: string; action: "nick" | "link" };

/** Строки обработчиков. Должны совпадать с `CB` (TG) и payload VK — тест. */
export const BUYER_STEP_COMMANDS = {
  tg: { nick: "find_gp", link: "send_gp_link" },
  vk: { nick: "find_gp_start", link: "send_gp_link" },
} as const;

export interface BuyerStepOrder {
  wbCode: string;
  amount: number;
  isDirectOrder?: boolean | null;
  robloxUsername?: string | null;
  probableNick?: string | null;
}

const SITE = "https://robloxbank.ru";
/** До этого номинала заказ закрывается одним пассом (см. разбивку от донора). */
const SINGLE_PASS_MAX = 1500;

function isCorridorCode(code: string): boolean {
  return /^[A-Za-z0-9]{7}$/.test(code) && !code.startsWith("DIR-") && !code.startsWith("AV-");
}

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Личная инструкция; `stage` открывает нужную ветку сразу после проверки ника. */
export function buyerGuideUrl(order: BuyerStepOrder, stage?: "key" | "passid"): string {
  const code = order.wbCode?.trim() ?? "";
  if (order.isDirectOrder || !isCorridorCode(code)) return `${SITE}/guide?source=direct`;
  const nick = (order.robloxUsername ?? order.probableNick ?? "").trim();
  let url = `${SITE}/guide?source=wb&skip=1&code=${encodeURIComponent(code)}`;
  if (nick) url += `&username=${encodeURIComponent(nick)}`;
  if (stage) url += `&stage=${stage}`;
  return url;
}

export interface BuyerStepMessage {
  /** Telegram HTML. Для VK — `stripHtml`. */
  html: string;
  buttons: BuyerStepButton[][];
}

export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/**
 * Сообщение покупателю. Код ВБ — единственный идентификатор, который он
 * знает (номера заказов клиенту не показываем). Каждое сообщение говорит
 * «пришли СЮДА, одним сообщением»: ответ принимается и без кнопки.
 */
export function buyerStepMessage(kind: BuyerStepKind, order: BuyerStepOrder, customText?: string): BuyerStepMessage {
  const code = order.wbCode?.trim() ?? "";
  const corridor = !order.isDirectOrder && isCorridorCode(code);
  const head = corridor ? `📦 Заказ по коду ВБ <code>${esc(code)}</code> · <b>${order.amount} R$</b>\n\n` : `📦 Заказ на <b>${order.amount} R$</b>\n\n`;
  const price = order.amount <= SINGLE_PASS_MAX ? Math.ceil(order.amount / 0.7) : null;
  const priceLine = price ? `Нужен геймпасс за <b>${price} R$</b>.` : "Сколько пассов и по какой цене — бот покажет после ника.";
  const guide = { label: "📖 Моя инструкция", url: buyerGuideUrl(order) };

  switch (kind) {
    case "link":
      return {
        html:
          `${head}🔗 <b>Пришли сюда ссылку на свой геймпасс</b> или его <b>Pass ID</b> — одним сообщением, без лишнего текста.\n\n` +
          `${priceLine}\nPass ID — число из колонки <b>Pass ID</b> в Creator Hub → Monetization → Passes.`,
        buttons: [
          [{ label: "🔗 Прислать ссылку", action: "link" }],
          [{ label: "🔢 Где взять Pass ID", url: buyerGuideUrl(order, "passid") }],
        ],
      };
    case "key":
      return {
        html:
          `${head}🔑 <b>Пришли сюда ключ из Roblox</b> — одним сообщением. Геймпасс создадим сами, пароль не нужен.\n\n` +
          `Как получить ключ — по кнопке, там каждое нажатие с картинкой. Скопируй его целиком кнопкой <b>Copy Key To Clipboard</b>.`,
        buttons: [[{ label: "📸 Как получить ключ", url: buyerGuideUrl(order, "key") }]],
      };
    case "nick":
      return {
        html:
          `${head}🔎 <b>Пришли сюда свой ник в Roblox</b> — тот, под которым заходишь в игру.\n\n` +
          `Посмотрим, что у тебя уже выставлено, и соберём заказ из этого. Если есть ссылка на геймпасс — пришли её, этого тоже хватит.`,
        buttons: [[{ label: "🔎 Ввести ник Roblox", action: "nick" }], [guide]],
      };
    case "create":
      return {
        html:
          `${head}📖 <b>Создай геймпасс по своей инструкции</b> — там каждое нажатие с картинкой.\n\n` +
          `${priceLine}\nКогда создашь — пришли сюда ник Roblox или ссылку на геймпасс.`,
        buttons: [[guide], [{ label: "🔎 Пасс готов — ввести ник", action: "nick" }]],
      };
    case "custom": {
      const body = esc((customText ?? "").trim());
      return {
        html: `${head}${body}\n\n<i>Ссылку на геймпасс, Pass ID, ник или ключ можно прислать прямо сюда.</i>`,
        buttons: [[guide], [{ label: "🔗 Прислать ссылку", action: "link" }]],
      };
    }
  }
}

/* ── 3. События заказа ─────────────────────────────────────────────────── */

export const BUYER_STEP_EVENT = {
  /** Админка попросила у покупателя шаг. */
  SENT: "BUYER_STEP_SENT",
  /** Бот не понял покупателя и ответил ошибкой формата. */
  DEAD_END: "BOT_DEAD_END",
} as const;

/** Где бот не понял покупателя. Ключи — то, что видит админ в карточке. */
export const DEAD_END_REASONS = {
  key_format: "прислал не ключ, когда бот ждал ключ",
  nick_format: "ник не похож на ник Roblox",
  link_format: "бот не разобрал ссылку на геймпасс",
  key_no_nick: "прислал ключ, но ника в заказе нет",
} as const;

export type DeadEndReason = keyof typeof DEAD_END_REASONS;

/** Минимум от Prisma-клиента (db в ботах, prisma в Web). */
export type BuyerStepClient = {
  wbOrder: { findFirst: (args: unknown) => Promise<{ id: string } | null> };
  orderEvent: { create: (args: unknown) => Promise<unknown> };
};

/** Заказ, которому бот примет ключ вне шага ключа. */
export interface StrayKeyOrder {
  id: string;
  wbCode: string;
  amount: number;
  robloxUsername: string | null;
  probableNick: string | null;
}

/** Минимум от Prisma-клиента для приёма ключа вне шага (боты). */
export type StrayKeyDb = {
  user: { findUnique: (args: unknown) => Promise<{ id: string; robloxUsername: string | null } | null> };
  wbOrder: { findMany: (args: unknown) => Promise<StrayKeyOrder[]> };
};

/** Статусы, в которых заказ ждёт от покупателя геймпасс. */
export const STRAY_KEY_STATUSES = ["AWAITING_GAMEPASS", "REJECTED"];

/** Текст ошибки без `any`: Roblox и мост бросают что угодно. */
export function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Окно, в котором повтор одного тупика не плодит строк. */
const DEAD_END_BUCKET_MS = 10 * 60 * 1000;

async function orderIdFor(client: BuyerStepClient, ref: { orderId?: string; wbCode?: string }): Promise<string | null> {
  if (ref.orderId) return ref.orderId;
  const code = ref.wbCode?.trim();
  if (!code) return null;
  const order = await client.wbOrder.findFirst({
    where: { wbCode: { equals: code, mode: "insensitive" } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return order?.id ?? null;
}

/**
 * Бот не понял покупателя. Никогда не роняет поток и не хранит то, что
 * могло оказаться ключом: в записи только причина и длина присланного.
 */
export async function recordBuyerDeadEnd(
  client: BuyerStepClient,
  opts: { orderId?: string; wbCode?: string; via: "tg-bot" | "vk-bot"; reason: DeadEndReason; sentLength?: number },
): Promise<void> {
  try {
    const orderId = await orderIdFor(client, opts);
    if (!orderId) return;
    const bucket = Math.floor(Date.now() / DEAD_END_BUCKET_MS);
    await client.orderEvent.create({
      data: {
        orderId,
        type: BUYER_STEP_EVENT.DEAD_END,
        idempotencyKey: `deadend:${orderId}:${opts.via}:${opts.reason}:${bucket}`,
        payload: { reason: opts.reason, via: opts.via, sentLength: opts.sentLength ?? null, at: new Date().toISOString() },
      },
    });
  } catch (err: unknown) {
    if ((err as { code?: string } | null)?.code === "P2002") return;
    console.warn("[buyer-step] тупик не записан:", err instanceof Error ? err.message : err);
  }
}

/** Человеческая строка события для карточки заказа. */
export function buyerStepEventText(type: string, payload: unknown): string | null {
  const p = (payload ?? {}) as Record<string, unknown>;
  if (type === BUYER_STEP_EVENT.SENT) {
    const option = BUYER_STEP_OPTIONS.find((item) => item.kind === p.kind);
    const channel = p.channel === "tg" ? "в Telegram" : p.channel === "vk" ? "во ВКонтакте" : "— не доставлено";
    return `📨 Попросили у покупателя: ${option?.label.toLowerCase() ?? String(p.kind)} ${channel}`;
  }
  if (type === BUYER_STEP_EVENT.DEAD_END) {
    const reason = DEAD_END_REASONS[p.reason as DeadEndReason] ?? String(p.reason);
    return `😵 Бот не понял покупателя: ${reason}`;
  }
  return null;
}
